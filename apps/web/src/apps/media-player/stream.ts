// Feeds FFmpeg output into a MediaSource so playback starts after the first
// chunk, the way VLC starts decoding before it has read the whole file.
import { cancelPlayback, chunk, releasePlayback, type ChunkPlan } from './engine';
import { videoCodecString, webmStartTime } from './formats';

const AHEAD = 30, BEHIND = 30, OVERLAP = 0.25;
const HEIGHTS = [720, 480, 360, 240];

export interface StreamOptions extends ChunkPlan { duration: number; startTime: number }
export type StreamStatus = { buffering: boolean; quality?: number; error?: string };

export class TranscodeStream {
  readonly url: string;
  private source = new MediaSource();
  private buffer: SourceBuffer | null = null;
  private generation = 0;
  private cursor = 0;
  private closed = false;
  private pumping = false;
  private quality: number;
  private inflight: [number, number] | null = null;
  /** Chunks produced since the last start or seek; early ones are short so the picture appears fast. */
  private run = 0;
  constructor(private blob: Blob, private name: string, private video: HTMLVideoElement, private options: StreamOptions, private onStatus: (status: StreamStatus) => void, startAt = 0) {
    this.url = URL.createObjectURL(this.source);
    this.cursor = startAt;
    this.quality = Math.max(0, HEIGHTS.indexOf(options.maxHeight));
    this.source.addEventListener('sourceopen', () => { if (Number.isFinite(options.duration) && options.duration > 0) this.source.duration = options.duration; void this.pump(); }, { once: true });
    video.addEventListener('seeking', this.seeking);
    video.addEventListener('timeupdate', this.wake);
    video.addEventListener('waiting', this.skipGap);
    this.gapTimer = setInterval(this.skipGap, 500);
  }
  private gapTimer: ReturnType<typeof setInterval>;
  /** Step over small holes between chunks (encoder delay, odd source timestamps) instead of stalling. */
  private skipGap = () => {
    const ranges = this.buffer?.buffered, time = this.video.currentTime;
    if (!ranges || this.video.paused && this.video.readyState >= 3) return;
    for (let index = 0; index < ranges.length; index++) if (ranges.start(index) <= time + 0.1 && ranges.end(index) > time + 0.1) return;
    for (let index = 0; index < ranges.length; index++) {
      const start = ranges.start(index);
      if (start > time && start - time < 3) { this.video.currentTime = start + 0.02; return; }
    }
  };
  private wake = () => { if (!this.pumping) void this.pump(); };
  private seeking = () => {
    const time = this.video.currentTime;
    if (this.covered(time) || this.inflight && time >= this.inflight[0] - 0.1 && time < this.inflight[1]) return;
    this.generation++;
    // Only an in-flight chunk needs FFmpeg stopped; an idle instance is reused (no core reload).
    if (this.inflight) cancelPlayback();
    this.inflight = null;
    this.cursor = time; this.run = 0;
    this.pumping = false;
    void this.pump();
  };
  private covered(time: number) {
    const ranges = this.buffer?.buffered;
    if (!ranges) return false;
    for (let index = 0; index < ranges.length; index++) if (ranges.start(index) - 0.25 <= time && ranges.end(index) > time + 0.5) return true;
    return false;
  }
  private bufferedAhead() {
    const ranges = this.buffer?.buffered, time = this.video.currentTime;
    if (!ranges) return 0;
    for (let index = 0; index < ranges.length; index++) if (ranges.start(index) - 0.25 <= time && ranges.end(index) >= time) return ranges.end(index) - time;
    return 0;
  }
  private async append(data: Uint8Array, offset: number, generation: number) {
    if (!this.buffer) {
      const webm = this.options.container === 'webm';
      const video = this.options.videoIndex === undefined ? null : webm ? 'vp8' : this.copy ? videoCodecString(data) : 'avc1.640029';
      if (this.options.videoIndex !== undefined && !video) throw new Error('This video codec cannot be streamed.');
      const codecs = [video, this.options.audioIndex !== undefined ? (webm ? 'vorbis' : 'mp4a.40.2') : null].filter(Boolean).join(', ');
      const type = `${video ? 'video' : 'audio'}/${webm ? 'webm' : 'mp4'}; codecs="${codecs}"`;
      if (!MediaSource.isTypeSupported(type)) throw new Error(`This browser cannot play ${codecs}.`);
      this.buffer = this.source.addSourceBuffer(type);
      this.buffer.mode = 'segments';
    }
    const buffer = this.buffer;
    const settle = () => new Promise<void>((resolve, reject) => {
      const done = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', fail); resolve(); };
      const fail = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', fail); reject(new Error('The decoder rejected this stream.')); };
      buffer.addEventListener('updateend', done); buffer.addEventListener('error', fail);
    });
    if (buffer.updating) await settle();
    const time = this.video.currentTime;
    if (buffer.buffered.length && buffer.buffered.start(0) < time - BEHIND) { buffer.remove(0, time - BEHIND); await settle(); }
    if (generation !== this.generation || this.closed) return;
    // WebM chunks may carry their own start time; MP4 chunks are rebased to zero.
    buffer.timestampOffset = offset - (this.options.container === 'webm' ? webmStartTime(data) ?? 0 : 0);
    try { buffer.appendBuffer(data as BufferSource); await settle(); }
    catch (error) {
      if ((error as DOMException).name !== 'QuotaExceededError') throw error;
      buffer.remove(0, Math.max(0, time - 2)); await settle();
      buffer.appendBuffer(data as BufferSource); await settle();
    }
  }
  private async pump() {
    if (this.pumping || this.closed || this.source.readyState !== 'open') return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (!this.closed && generation === this.generation && this.cursor < this.options.duration - 0.05) {
        if (this.bufferedAhead() > AHEAD) { this.pumping = false; return; }
        this.onStatus({ buffering: this.bufferedAhead() < 1, quality: this.scaled ? HEIGHTS[this.quality] : undefined });
        const length = this.copy ? (this.run === 0 ? 6 : 20) : [2, 4][this.run] ?? 8;
        const span = Math.min(length, this.options.duration - this.cursor);
        this.inflight = [this.cursor, this.cursor + span + OVERLAP];
        // Overlap the next chunk slightly: encoder padding would otherwise leave gaps that stall playback.
        const { data, offset, elapsed } = await chunk(this.blob, this.name, this.cursor, span + OVERLAP, { ...this.options, fileStart: this.options.startTime, maxHeight: HEIGHTS[this.quality] });
        this.inflight = null;
        if (generation !== this.generation || this.closed) return;
        await this.append(data, offset, generation);
        this.cursor += span; this.run++;
        // Slower than real time: step down the picture size, as VLC drops frames.
        if (this.scaled && elapsed > span * this.video.playbackRate * 0.9 && this.quality < HEIGHTS.length - 1) this.quality++;
      }
      if (generation === this.generation && !this.closed && this.cursor >= this.options.duration - 0.05 && this.source.readyState === 'open' && !this.buffer?.updating) this.source.endOfStream();
      this.onStatus({ buffering: false, quality: this.scaled ? HEIGHTS[this.quality] : undefined });
    } catch (error) {
      if (generation === this.generation && !this.closed) this.onStatus({ buffering: false, error: (error as { message?: string })?.message || String(error) || 'Playback failed.' });
    } finally { if (generation === this.generation) this.pumping = false; }
  }
  /** True when FFmpeg re-encodes the picture, so its size can be lowered to keep up. */
  private get scaled() { return this.options.videoIndex !== undefined && !this.copy; }
  private get copy() { return this.options.copyVideo && this.options.container === 'mp4' && this.options.burnSubtitleIndex === undefined && this.options.videoIndex !== undefined; }
  destroy() {
    this.closed = true; this.generation++;
    this.video.removeEventListener('seeking', this.seeking);
    this.video.removeEventListener('timeupdate', this.wake);
    this.video.removeEventListener('waiting', this.skipGap);
    clearInterval(this.gapTimer);
    cancelPlayback();
    void releasePlayback(this.blob);
    URL.revokeObjectURL(this.url);
  }
}
