// Encodes the selected tab for LopeOS. Chromium's compositor produces a frame only when
// the page changes, so a still page costs nothing. A frame is encoded only when the
// viewer has room for it: under a slow link the next frame waits for the newest
// picture instead of queueing stale ones. A still screen is then refined until its
// text is sharp. The worker reads output through a DevTools binding.
'use strict';

const OUTPUT = 'lopeDisplayOutput';
const CODECS = {
  // Quantizer-controlled codecs can refine a still picture; H.264 is the fallback for
  // viewers that cannot decode them.
  vp9: { string: 'vp09.00.10.08', options: q => ({ vp9: { quantizer: q } }) },
  av1: { string: 'av01.0.08M.08', options: q => ({ av1: { quantizer: q } }) },
  h264: { string: 'avc1.42E033', options: null },
};
// On the 0-63 scale VP9 and AV1 share. Motion trades detail for frame rate.
const MOTION = { best: 24, start: 30, worst: 50 };
const STILL = { fast: 10, slow: 16 };
const MAX_WINDOW = 4;
// Frames whose round trip stands this far past the path's own are queued somewhere.
const QUEUE_MS = 120;
const now = () => performance.now();
const displays = new Map();

function emit(message) {
  try { globalThis[OUTPUT](JSON.stringify(message)); } catch { /* The worker is reattaching. */ }
}
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

class Display {
  constructor(key, { codec, fps, audio, firstId }) {
    this.key = key;
    this.codec = CODECS[codec] ? codec : 'vp9';
    this.fps = clamp(Math.round(fps) || 30, 5, 60);
    this.audioEnabled = audio !== false;
    this.generation = 0;
    // Ids keep rising across restarts, so a viewer's late acknowledgement never matches a new frame.
    this.nextId = Math.max(0, (Number.isInteger(firstId) ? firstId : 1) - 1);
    this.sent = new Map();
    this.minRtt = Infinity; this.minRttAt = 0; this.srtt = 0; this.window = 2;
    this.quantizer = MOTION.start; this.lastImproved = 0; this.bandwidth = 0;
    this.serial = 0; this.encodedSerial = 0; this.refined = true; this.lastFrameAt = 0;
    this.forceKey = true; this.encodingSince = 0; this.timestamp = 0;
    this.stats = { captured: 0, encoded: 0, refinements: 0, keyframes: 0, bytes: 0, encodeMs: 0, dropped: 0 };
  }

  async capture(streamId, width, height) {
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId,
        minWidth: width, maxWidth: width, minHeight: height, maxHeight: height, maxFrameRate: this.fps } },
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    });
    if (generation !== this.generation || this.stopped) { for (const track of stream.getTracks()) track.stop(); return; }
    this.release();
    this.stream = stream; this.width = width; this.height = height;
    const [video] = stream.getVideoTracks(), [audio] = stream.getAudioTracks();
    video.contentHint = 'detail';
    this.videoReader = new MediaStreamTrackProcessor({ track: video, maxBufferSize: 1 }).readable.getReader();
    void this.pumpVideo(this.videoReader, generation);
    if (audio) {
      this.audioReader = new MediaStreamTrackProcessor({ track: audio }).readable.getReader();
      void this.pumpAudio(this.audioReader, generation);
    }
  }

  release() {
    for (const reader of [this.videoReader, this.audioReader]) reader?.cancel().catch(() => {});
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.videoReader = this.audioReader = this.stream = null;
  }

  async pumpVideo(reader, generation) {
    for (;;) {
      let result;
      try { result = await reader.read(); } catch { break; }
      if (result.done || generation !== this.generation) { result.value?.close(); break; }
      this.latest?.close();
      this.latest = result.value; this.serial++; this.stats.captured++;
      this.refined = false; this.lastFrameAt = now();
      this.schedule();
    }
    // A closed tab ends its capture. The worker moves the display to the next tab.
    if (generation === this.generation && !this.stopped) emit({ k: this.key, t: 'ended' });
  }

  configureEncoder(width, height) {
    try { if (this.encoder?.state !== 'closed') this.encoder?.close(); } catch {}
    const spec = CODECS[this.codec];
    this.encoder = new VideoEncoder({ output: (chunk, metadata) => this.output(chunk, metadata), error: error => this.failed(error) });
    this.encoder.configure({
      codec: spec.string, width, height, framerate: this.fps, latencyMode: 'realtime', hardwareAcceleration: 'no-preference',
      contentHint: 'text',
      ...(spec.options ? { bitrateMode: 'quantizer' }
        : { bitrateMode: 'variable', bitrate: clamp(Math.round(width * height * this.fps * 0.1), 1_000_000, 12_000_000), avc: { format: 'annexb' } }),
    });
    this.encoderWidth = width; this.encoderHeight = height;
    this.forceKey = true; this.encodingSince = 0;
  }

  failed(error) {
    this.encodingSince = 0;
    emit({ k: this.key, t: 'error', message: String(error?.message ?? error).slice(0, 200) });
    // A fresh encoder starts with a key frame, which the viewer can always decode.
    try { this.configureEncoder(this.encoderWidth || this.width, this.encoderHeight || this.height); } catch {}
  }

  /** Encodes the newest picture when the viewer has room for it. One frame at a time keeps latency at one encode. */
  schedule() {
    if (this.stopped || !this.latest) return;
    if (this.encodingSince && now() - this.encodingSince < 1000) return;
    if (this.sent.size >= this.window) return;
    if (this.serial !== this.encodedSerial) { this.encode(this.motionQuantizer(), false); return; }
    // A still screen is refined once its last motion frame has crossed the path.
    if (!this.refined && CODECS[this.codec].options && this.sent.size === 0 && now() - this.lastFrameAt >= 150) this.encode(this.stillQuantizer(), true);
  }

  motionQuantizer() { return this.quantizer; }
  stillQuantizer() { return this.bandwidth && this.bandwidth < 6_000_000 ? STILL.slow : STILL.fast; }

  encode(quantizer, refinement) {
    const source = this.latest;
    const width = source.displayWidth & ~1, height = source.displayHeight & ~1;
    if (!this.encoder || this.encoder.state !== 'configured' || width !== this.encoderWidth || height !== this.encoderHeight) this.configureEncoder(width, height);
    this.encodedSerial = this.serial;
    if (refinement) this.refined = true;
    // Timestamps only order the encoder's input; a refinement repeats a picture.
    this.timestamp = Math.max(this.timestamp + 1000, Math.round(now() * 1000));
    const frame = new VideoFrame(source, { timestamp: this.timestamp, visibleRect: { x: 0, y: 0, width, height } });
    const keyFrame = this.forceKey; this.forceKey = false;
    this.pending = { quantizer, refinement, started: now() };
    this.encodingSince = now();
    try {
      const options = CODECS[this.codec].options;
      this.encoder.encode(frame, { keyFrame, ...(options ? options(quantizer) : {}) });
    } catch (error) { this.failed(error); }
    finally { frame.close(); }
  }

  output(chunk) {
    const pending = this.pending ?? { quantizer: 0, refinement: false, started: now() };
    this.encodingSince = 0;
    const id = ++this.nextId;
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    const encodeMs = now() - pending.started;
    this.sent.set(id, { at: now(), bytes: data.byteLength });
    const key = chunk.type === 'key';
    Object.assign(this.stats, { encoded: this.stats.encoded + 1, bytes: this.stats.bytes + data.byteLength,
      encodeMs: this.stats.encodeMs + encodeMs, refinements: this.stats.refinements + (pending.refinement ? 1 : 0), keyframes: this.stats.keyframes + (key ? 1 : 0) });
    emit({ k: this.key, t: 'v', id, key, w: this.encoderWidth, h: this.encoderHeight, q: pending.quantizer,
      r: pending.refinement ? 1 : 0, e: Math.round(encodeMs), d: data.toBase64() });
    queueMicrotask(() => this.schedule());
  }

  /** The viewer has presented frame `id` and every frame before it. */
  ack(id) {
    const entry = this.sent.get(id);
    if (!entry) return;
    for (const sent of this.sent.keys()) { if (sent > id) break; this.sent.delete(sent); }
    const time = now(), rtt = time - entry.at;
    // The path's own round trip, forgetting old minimums so a route change is noticed.
    if (rtt < this.minRtt || time - this.minRttAt > 10000) { this.minRtt = rtt; this.minRttAt = time; }
    this.srtt = this.srtt ? this.srtt * 0.75 + rtt * 0.25 : rtt;
    // A large frame's extra crossing time measures what the path carries.
    const extra = rtt - this.minRtt;
    if (entry.bytes > 24000 && extra > 4) {
      const sample = entry.bytes * 8 / (extra / 1000);
      this.bandwidth = this.bandwidth ? this.bandwidth * 0.7 + sample * 0.3 : sample;
    }
    const interval = 1000 / this.fps;
    if (this.srtt - this.minRtt > QUEUE_MS) {
      // Frames are queueing: send fewer, smaller ones until the queue drains.
      this.window = 1;
      this.quantizer = Math.min(MOTION.worst, this.quantizer + 2);
    } else {
      this.window = clamp(Math.ceil(this.minRtt / interval) + 1, 2, MAX_WINDOW);
      if (this.srtt - this.minRtt < QUEUE_MS / 3 && time - this.lastImproved > 700) {
        this.quantizer = Math.max(MOTION.best, this.quantizer - 1); this.lastImproved = time;
      }
    }
    this.schedule();
  }

  keyframe() {
    // The viewer lost its decoder state; frames still in flight cannot help it.
    this.sent.clear(); this.forceKey = true; this.encodedSerial = -1; this.encodingSince = 0;
    this.schedule();
  }

  refine() { this.schedule(); }

  async pumpAudio(reader, generation) {
    let quietSince = 0, samples = new Float32Array(0);
    for (;;) {
      let result;
      try { result = await reader.read(); } catch { break; }
      if (result.done || generation !== this.generation) { result.value?.close(); break; }
      const data = result.value;
      try {
        if (!this.audioEnabled || this.stopped) continue;
        // Silence is not encoded or sent, so an idle tab costs no audio work.
        let peak = 0;
        for (let channel = 0; channel < data.numberOfChannels && peak < 1e-4; channel++) {
          if (samples.length < data.numberOfFrames) samples = new Float32Array(data.numberOfFrames);
          data.copyTo(samples, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < data.numberOfFrames; index++) { const value = Math.abs(samples[index]); if (value > peak) peak = value; }
        }
        if (peak >= 1e-4) quietSince = 0; else quietSince ||= now();
        if (quietSince && now() - quietSince > 300) continue;
        if (!this.audioEncoder || this.audioEncoder.state === 'closed' || this.audioRate !== data.sampleRate || this.audioChannels !== data.numberOfChannels) {
          this.audioRate = data.sampleRate; this.audioChannels = Math.min(2, data.numberOfChannels);
          this.audioEncoder = new AudioEncoder({ output: chunk => this.audioOutput(chunk), error: () => { this.audioEncoder = null; } });
          this.audioEncoder.configure({ codec: 'opus', sampleRate: this.audioRate, numberOfChannels: this.audioChannels, bitrate: 96000,
            opus: { frameDuration: 20000, complexity: 5 } });
        }
        this.audioEncoder.encode(data);
      } catch { /* A malformed audio chunk is skipped. */ }
      finally { data.close(); }
    }
  }

  audioOutput(chunk) {
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    emit({ k: this.key, t: 'a', ts: chunk.timestamp, sr: this.audioRate, ch: this.audioChannels, d: data.toBase64() });
  }

  stop() {
    this.stopped = true; this.generation++;
    this.release();
    this.latest?.close(); this.latest = null;
    for (const encoder of [this.encoder, this.audioEncoder]) { try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch {} }
  }
}

globalThis.lopeDisplay = {
  /** Codecs this Chromium encodes in real time. */
  async probe() {
    const result = {};
    for (const [name, spec] of Object.entries(CODECS)) {
      try {
        const { supported } = await VideoEncoder.isConfigSupported({ codec: spec.string, width: 1920, height: 1080, framerate: 30,
          latencyMode: 'realtime', hardwareAcceleration: 'no-preference',
          ...(spec.options ? { bitrateMode: 'quantizer' } : { bitrateMode: 'variable', bitrate: 4_000_000, avc: { format: 'annexb' } }) });
        result[name] = !!supported;
      } catch { result[name] = false; }
    }
    try { result.opus = !!(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 })).supported; }
    catch { result.opus = false; }
    return result;
  },
  async start(key, { streamId, width, height, codec, fps, audio, firstId }) {
    displays.get(key)?.stop();
    const display = new Display(key, { codec, fps, audio, firstId });
    displays.set(key, display);
    try { await display.capture(streamId, width, height); }
    catch (error) { display.stop(); displays.delete(key); throw error; }
    return true;
  },
  /** Shows another tab, or the same tab at another size, without restarting the stream. */
  async retarget(key, { streamId, width, height }) {
    const display = displays.get(key);
    if (!display) throw new Error('This display is not running.');
    await display.capture(streamId, width, height);
    return true;
  },
  ack(key, id) { displays.get(key)?.ack(id); },
  keyframe(key) { displays.get(key)?.keyframe(); },
  refine(key) { displays.get(key)?.refine(); },
  audio(key, enabled) { const display = displays.get(key); if (display) display.audioEnabled = !!enabled; },
  stop(key) { displays.get(key)?.stop(); displays.delete(key); },
  stats(key) {
    const display = displays.get(key);
    if (!display) return null;
    const { stats } = display;
    return { ...stats, encodeMs: stats.encoded ? +(stats.encodeMs / stats.encoded).toFixed(1) : 0, quantizer: display.quantizer,
      window: display.window, rtt: Math.round(display.srtt), minRtt: Number.isFinite(display.minRtt) ? Math.round(display.minRtt) : null,
      bandwidth: Math.round(display.bandwidth), width: display.encoderWidth ?? 0, height: display.encoderHeight ?? 0, codec: display.codec };
  },
  /** Chromium's own clipboard, which pages copy to and paste from. */
  clipboard(text) {
    const area = document.createElement('textarea');
    document.body.append(area);
    try {
      if (typeof text === 'string') { area.value = text; area.select(); return document.execCommand('copy'); }
      area.focus(); document.execCommand('paste'); return area.value;
    } finally { area.remove(); }
  },
  wake() { return chrome.runtime.sendMessage('lope-display-wake'); },
};
