// FFmpeg (libavformat/libavcodec, the same libraries VLC's avcodec module uses)
// compiled to WebAssembly. One instance feeds playback; another runs probes,
// subtitle extraction and conversions so they never stall the picture.
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { extensionOf } from './formats';

export type StreamKind = 'video' | 'audio' | 'subtitle' | 'attachment' | 'data';
export interface StreamInfo {
  index: number; kind: StreamKind; codec: string; codecLong: string; profile?: string;
  width?: number; height?: number; fps?: number; pixFmt?: string; aspect?: string; fieldOrder?: string;
  sampleRate?: number; channels?: number; layout?: string; sampleFormat?: string; bitrate?: number;
  language?: string; title?: string; isDefault: boolean; attachedPic: boolean; bitmap: boolean;
}
export interface Chapter { start: number; end: number; title: string }
export interface ProbeResult {
  format: string; formatLong: string; duration: number; startTime: number; bitrate: number; size: number;
  tags: Record<string, string>; streams: StreamInfo[]; chapters: Chapter[];
}

const BITMAP_SUBTITLES = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext']);
const rational = (value?: string) => { if (!value) return undefined; const [a, b] = value.split('/').map(Number); return a > 0 && b > 0 ? a / b : undefined; };
const lowerKeys = (tags: Record<string, string> = {}) => Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), String(value)]));

/** Convert ffprobe's JSON into the shape the player uses. */
export function parseProbe(json: any, size: number): ProbeResult {
  const format = json.format ?? {};
  const streams: StreamInfo[] = (json.streams ?? []).map((stream: any) => {
    const tags = lowerKeys(stream.tags);
    const kind: StreamKind = ['video', 'audio', 'subtitle', 'attachment'].includes(stream.codec_type) ? stream.codec_type : 'data';
    return {
      index: stream.index, kind, codec: stream.codec_name ?? 'unknown', codecLong: stream.codec_long_name ?? stream.codec_name ?? 'Unknown codec', profile: stream.profile,
      width: stream.width, height: stream.height, fps: rational(stream.avg_frame_rate) ?? rational(stream.r_frame_rate), pixFmt: stream.pix_fmt,
      aspect: stream.display_aspect_ratio, fieldOrder: stream.field_order,
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined, channels: stream.channels, layout: stream.channel_layout, sampleFormat: stream.sample_fmt,
      bitrate: stream.bit_rate ? Number(stream.bit_rate) : undefined, language: tags.language && tags.language !== 'und' ? tags.language : undefined, title: tags.title,
      isDefault: !!stream.disposition?.default, attachedPic: !!stream.disposition?.attached_pic, bitmap: BITMAP_SUBTITLES.has(stream.codec_name),
    };
  });
  const chapters: Chapter[] = (json.chapters ?? []).map((chapter: any, index: number) => ({ start: Number(chapter.start_time) || 0, end: Number(chapter.end_time) || 0, title: lowerKeys(chapter.tags).title || `Chapter ${index + 1}` }));
  return {
    format: format.format_name ?? extensionOf(format.filename ?? ''), formatLong: format.format_long_name ?? '', duration: Number(format.duration) || 0, startTime: Number(format.start_time) || 0,
    bitrate: Number(format.bit_rate) || 0, size, tags: lowerKeys(format.tags), streams, chapters,
  };
}

/** Codecs every supported browser decodes inside <video>, given a container it understands. */
const NATIVE_AUDIO = new Set(['mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le', 'pcm_s32le', 'alac']);
const supports = (type: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
/** Browsers built without patent-encumbered codecs (e.g. plain Chromium) lack H.264 and AAC. */
export const mp4Supported = () => supports('video/mp4; codecs="avc1.640029, mp4a.40.2"');
export function nativeVideoCodec(codec: string) {
  if (['vp8', 'vp9', 'av1'].includes(codec)) return true;
  if (codec === 'h264') return supports('video/mp4; codecs="avc1.640029"');
  if (codec === 'hevc') return supports('video/mp4; codecs="hvc1.1.6.L93.B0"') || supports('video/mp4; codecs="hev1.1.6.L93.B0"');
  return false;
}
export const nativeAudioCodec = (codec: string) => NATIVE_AUDIO.has(codec) || codec === 'aac' && supports('audio/mp4; codecs="mp4a.40.2"');
export const primaryVideo = (probe: ProbeResult) => probe.streams.find(stream => stream.kind === 'video' && !stream.attachedPic);
export const audioStreams = (probe: ProbeResult) => probe.streams.filter(stream => stream.kind === 'audio');
export const subtitleStreams = (probe: ProbeResult) => probe.streams.filter(stream => stream.kind === 'subtitle');

type Job<T> = (ffmpeg: FFmpeg) => Promise<T>;
class Core {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<FFmpeg> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private mounts = new Map<Blob, string>();
  private counter = 0;
  logs: string[] = [];
  progress: ((ratio: number) => void) | null = null;
  constructor(readonly label: string) {}

  private load() {
    if (this.ffmpeg) return Promise.resolve(this.ffmpeg);
    return this.loading ??= (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => { this.logs.push(message); if (this.logs.length > 400) this.logs.splice(0, 200); });
      ffmpeg.on('progress', ({ progress }) => this.progress?.(progress));
      await ffmpeg.load({ coreURL, wasmURL });
      await ffmpeg.createDir('/in').catch(() => {});
      this.ffmpeg = ffmpeg;
      return ffmpeg;
    })().finally(() => { this.loading = null; });
  }
  /** Run jobs one at a time; FFmpeg is single threaded and shares one file system. */
  run<T>(job: Job<T>): Promise<T> {
    const next = this.tail.then(async () => job(await this.load()));
    this.tail = next.catch(() => {});
    return next;
  }
  /** Expose a Blob to FFmpeg without copying it (Emscripten WORKERFS). */
  async mount(ffmpeg: FFmpeg, blob: Blob, name: string) {
    const existing = this.mounts.get(blob);
    if (existing) return existing;
    const dir = `/in/${++this.counter}`, file = `input.${extensionOf(name) || 'bin'}`;
    await ffmpeg.createDir(dir);
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [new File([blob], file)] }, dir);
    const path = `${dir}/${file}`;
    this.mounts.set(blob, path);
    return path;
  }
  async release(blob: Blob) {
    const path = this.mounts.get(blob); if (!path || !this.ffmpeg) return;
    this.mounts.delete(blob);
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.run(async ffmpeg => { await ffmpeg.unmount(dir).catch(() => {}); await ffmpeg.deleteDir(dir).catch(() => {}); });
  }
  /** Stop the current job immediately. The next job loads a fresh instance. */
  terminate() {
    this.ffmpeg?.terminate(); this.ffmpeg = null; this.mounts.clear();
    this.tail = Promise.resolve();
  }
  async exec(ffmpeg: FFmpeg, args: string[]) {
    this.logs = [];
    const code = await ffmpeg.exec(['-hide_banner', '-nostdin', '-y', ...args]);
    if (code !== 0) throw new Error(this.failure());
  }
  failure() {
    const line = [...this.logs].reverse().find(entry => /error|invalid|not supported|unsupported|could not|no such|failed/i.test(entry) && !/^\s*(?:built with|configuration)/.test(entry));
    return line ? line.replace(/^\[[^\]]+\]\s*/, '').trim() : 'FFmpeg could not process this media.';
  }
  async take(ffmpeg: FFmpeg, path: string) {
    const data = await ffmpeg.readFile(path) as Uint8Array;
    await ffmpeg.deleteFile(path).catch(() => {});
    return data;
  }
}

const playback = new Core('playback');
const tasks = new Core('tasks');
export const engineAvailable = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

export function probe(blob: Blob, name: string): Promise<ProbeResult> {
  return tasks.run(async ffmpeg => {
    const input = await tasks.mount(ffmpeg, blob, name);
    tasks.logs = [];
    await ffmpeg.ffprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', input, '-o', '/probe.json']);
    let text = '';
    try { text = new TextDecoder().decode(await tasks.take(ffmpeg, '/probe.json')); } catch { /* reported below */ }
    const json = text ? JSON.parse(text) : null;
    if (!json?.format) throw new Error(tasks.failure() === 'FFmpeg could not process this media.' ? 'This file is not a recognized media format.' : tasks.failure());
    return parseProbe(json, blob.size);
  });
}

export interface ChunkPlan {
  /** fMP4 with H.264/AAC where available, otherwise WebM with VP8/Vorbis (libopus crashes in this wasm build). */
  container: 'mp4' | 'webm';
  videoIndex?: number; audioIndex?: number; copyVideo: boolean; deinterlace: boolean;
  maxHeight: number; burnSubtitleIndex?: number;
}
/**
 * Produce one fragmented MP4 covering [start, start + duration), with `start`
 * relative to the file's first timestamp. FFmpeg rebases each chunk to zero, so
 * `offset` says where the chunk's zero falls on the playback timeline.
 */
export function chunk(blob: Blob, name: string, start: number, duration: number, plan: ChunkPlan & { fileStart: number }): Promise<{ data: Uint8Array; offset: number; elapsed: number }> {
  return playback.run(async ffmpeg => {
    const begun = performance.now();
    const input = await playback.mount(ffmpeg, blob, name);
    const args = ['-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', input];
    let offset = start;
    if (plan.videoIndex !== undefined) {
      if (plan.copyVideo && plan.burnSubtitleIndex === undefined) {
        // Stream copy starts at the keyframe before `start`; find its decode time.
        await ffmpeg.ffprobe(['-v', 'error', '-select_streams', String(plan.videoIndex), '-read_intervals', `${(start + plan.fileStart).toFixed(3)}%+#1`, '-show_entries', 'packet=dts_time,pts_time', '-of', 'csv=p=0', input, '-o', '/keyframe.txt']);
        const [pts, dts] = new TextDecoder().decode(await playback.take(ffmpeg, '/keyframe.txt').catch(() => new Uint8Array())).split(/[\s,]+/).map(Number);
        const first = Number.isFinite(dts) ? dts : pts;
        if (Number.isFinite(first)) offset = Math.max(0, Math.min(start, first - plan.fileStart));
        args.push('-map', `0:${plan.videoIndex}`, '-c:v', 'copy');
      }
      else {
        const filters = [plan.deinterlace ? 'yadif=0:-1:1' : '', `scale=w=-2:h='min(${plan.maxHeight},ih)':flags=fast_bilinear`, 'format=yuv420p'].filter(Boolean).join(',');
        if (plan.burnSubtitleIndex !== undefined) args.push('-filter_complex', `[0:${plan.videoIndex}][0:${plan.burnSubtitleIndex}]overlay=(W-w)/2:H-h,${filters}[v]`, '-map', '[v]');
        else args.push('-map', `0:${plan.videoIndex}`, '-vf', filters);
        if (plan.container === 'webm') args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-auto-alt-ref', '0', '-g', '9999');
        else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23', '-profile:v', 'high', '-level', '4.1', '-bf', '0');
      }
    }
    if (plan.audioIndex !== undefined) args.push('-map', `0:${plan.audioIndex}`, ...(plan.container === 'webm' ? ['-c:a', 'libvorbis', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k']), '-ac', '2', '-ar', '48000');
    args.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1');
    const output = plan.container === 'webm' ? '/chunk.webm' : '/chunk.mp4';
    if (plan.container === 'webm') args.push('-f', 'webm', output);
    else args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', output);
    await playback.exec(ffmpeg, args);
    return { data: await playback.take(ffmpeg, output), offset, elapsed: (performance.now() - begun) / 1000 };
  });
}
export const cancelPlayback = () => playback.terminate();
export const releasePlayback = (blob: Blob) => playback.release(blob);

/** Extract a text subtitle stream as WebVTT. */
export function extractSubtitles(blob: Blob, name: string, index: number): Promise<string> {
  return tasks.run(async ffmpeg => {
    const input = await tasks.mount(ffmpeg, blob, name);
    await tasks.exec(ffmpeg, ['-i', input, '-map', `0:${index}`, '-c:s', 'webvtt', '-f', 'webvtt', '/subtitle.vtt']);
    return new TextDecoder().decode(await tasks.take(ffmpeg, '/subtitle.vtt'));
  });
}
/** Extract embedded cover art (an attached picture stream). */
export function extractCover(blob: Blob, name: string, stream: StreamInfo): Promise<Blob> {
  return tasks.run(async ffmpeg => {
    const input = await tasks.mount(ffmpeg, blob, name);
    const png = stream.codec === 'png', path = png ? '/cover.png' : '/cover.jpg';
    await tasks.exec(ffmpeg, ['-i', input, '-map', `0:${stream.index}`, '-c', 'copy', '-frames:v', '1', '-f', 'image2', path]);
    return new Blob([await tasks.take(ffmpeg, path) as BlobPart], { type: png ? 'image/png' : 'image/jpeg' });
  });
}

/** VLC's built-in Convert profiles. */
export const PROFILES = [
  { id: 'h264-mp3-mp4', label: 'Video - H.264 + MP3 (MP4)', extension: 'mp4', video: true, args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-b:a', '128k', '-movflags', '+faststart'] },
  { id: 'vp8-vorbis-webm', label: 'Video - VP80 + Vorbis (Webm)', extension: 'webm', video: true, args: ['-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libvorbis', '-b:a', '128k'] },
  { id: 'h265-mp3-mp4', label: 'Video - H.265 + MP3 (MP4)', extension: 'mp4', video: true, args: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '28', '-tag:v', 'hvc1', '-c:a', 'libmp3lame', '-b:a', '128k'] },
  { id: 'theora-vorbis-ogg', label: 'Video - Theora + Vorbis (OGG)', extension: 'ogv', video: true, args: ['-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis', '-q:a', '5'] },
  { id: 'mp4-tv', label: 'Video for MPEG4 720p TV/device', extension: 'mp4', video: true, args: ['-vf', "scale=w=-2:h='min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] },
  { id: 'vorbis-ogg', label: 'Audio - Vorbis (OGG)', extension: 'ogg', video: false, args: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'] },
  { id: 'mp3', label: 'Audio - MP3', extension: 'mp3', video: false, args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'mp3-mp4', label: 'Audio - MP3 (MP4)', extension: 'm4a', video: false, args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  { id: 'flac', label: 'Audio - FLAC', extension: 'flac', video: false, args: ['-vn', '-c:a', 'flac'] },
  { id: 'cd', label: 'Audio - CD', extension: 'wav', video: false, args: ['-vn', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2'] },
] as const;
export type ProfileId = typeof PROFILES[number]['id'];

export function convert(blob: Blob, name: string, profileId: ProfileId, onProgress: (ratio: number) => void): Promise<Uint8Array> {
  const profile = PROFILES.find(item => item.id === profileId)!;
  return tasks.run(async ffmpeg => {
    const input = await tasks.mount(ffmpeg, blob, name);
    const output = `/convert.${profile.extension}`;
    tasks.progress = ratio => onProgress(Math.max(0, Math.min(1, ratio)));
    try { await tasks.exec(ffmpeg, ['-i', input, ...profile.args, output]); }
    finally { tasks.progress = null; }
    return tasks.take(ffmpeg, output);
  });
}
export const cancelTasks = () => tasks.terminate();
export const releaseTasks = (blob: Blob) => tasks.release(blob);
