import type { MovieProject } from '../../movie-maker/src/model.ts';
import type { ExportOptions, ExportResult } from './types.ts';
import { checkCancelled, frameSeconds } from './types.ts';
import { MediaLibrary } from './media.ts';
import { renderFrame } from './render.ts';
import { mixAudio } from './audio.ts';
import { Output, WebMOutputFormat, Mp4OutputFormat, BufferTarget, CanvasSource, AudioSampleSource, AudioSample, Input, BlobSource, ALL_FORMATS, LocalMediaService, canEncodeVideo, canEncodeAudio } from './shared-codecs.ts';

export interface ExportCapabilities { video: boolean; audio: boolean; supported: boolean; formats: string[]; reason: string; mp4: boolean }
export async function getExportCapabilities(width = 1280, height = 720, frameRate = 30): Promise<ExportCapabilities> {
  try {
    const [video, audio, avc, aac] = await Promise.all([canEncodeVideo('vp8', { width, height, frameRate }), canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 }), canEncodeVideo('avc', { width, height, frameRate }), canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })]);
    return { video: !!video, audio: !!audio, supported: !!video || avc && aac, formats: [...(avc && aac ? ['MP4 (H.264 / AAC)'] : []), ...(video ? ['WebM (VP8 / Opus)'] : [])], reason: video ? audio ? '' : 'This browser can export WebM video, but has no Opus audio encoder. Disable audio or choose a supported format.' : 'WebM encoding is unavailable. Choose MP4 if supported, or open this project in a current Chromium browser.', mp4: avc && aac };
  } catch (error) { return { video: false, audio: false, supported: false, formats: [], reason: error instanceof Error ? error.message : 'Encoder capability probing failed.', mp4: false }; }
}

async function validateOutput(blob: Blob, expected: { width: number; height: number; duration: number; frames: number; fps: number; audio: boolean; peak: number; peakTime: number; videoCodec: 'avc' | 'vp8'; audioCodec: 'aac' | 'opus' }): Promise<ExportResult['validation']> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new Error('The finished movie container could not be independently reopened.');
    const video = await input.getPrimaryVideoTrack(); const audio = await input.getPrimaryAudioTrack();
    if (!video || await video.getCodec() !== expected.videoCodec) throw new Error('Export validation failed: the requested video codec is missing.');
    const width = await video.getDisplayWidth(), height = await video.getDisplayHeight();
    const duration = await input.computeDuration();
    if (width !== expected.width || height !== expected.height || Math.abs(duration - expected.duration) > 2 / expected.fps + .06) throw new Error('Export validation failed: output dimensions or duration differ from the project.');
    if (expected.audio && (!audio || await audio.getCodec() !== expected.audioCodec)) throw new Error('Export validation failed: the requested audio codec is missing.');
    const stats = await video.computePacketStats();
    const actualFps = expected.frames > 1 ? (await video.computeFrameRateMetrics()).bestGuessFrameRate : expected.fps;
    if (stats.packetCount !== expected.frames || Math.abs(actualFps - expected.fps) > .1) throw new Error('Export validation failed: the output frame count or frame rate differs from the requested movie.');
    let audioPeak = 0;
    if (audio) { const decoder = new LocalMediaService(async () => blob); try { const pcm = await decoder.audio('validation', Math.max(0, expected.peakTime - .1), Math.min(duration, expected.peakTime + .1)); for (const channel of pcm.channels) for (const value of channel) audioPeak = Math.max(audioPeak, Math.abs(value)); if (expected.peak > .001 && audioPeak < .0001) throw new Error('Export validation failed: the encoded sound could not be heard after decoding.'); } finally { decoder.release(); } }
    return { duration, width, height, videoCodec: expected.videoCodec, audioCodec: audio ? expected.audioCodec : null, frameCount: stats.packetCount, framesPerSecond: actualFps, audioPeak };
  } finally { input.dispose(); }
}

export async function exportMovie(project: MovieProject, library: MediaLibrary, options: ExportOptions): Promise<ExportResult> {
  const { width, height, bitrate, audioBitrate, includeAudio, signal } = options;
  const format = options.format ?? 'webm', videoCodec = format === 'mp4' ? 'avc' : 'vp8', audioCodec = format === 'mp4' ? 'aac' : 'opus';
  const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
  checkCancelled(signal);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 3840 || height > 3840 || width % 2 || height % 2) throw new Error('Export dimensions must be even numbers between 64 and 3840.');
  const fps = options.fps.num / options.fps.den;
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Choose an export frame rate from 1 to 60 fps.');
  const projectFrames = project.clips.reduce((sum, clip) => sum + clip.duration, 0), duration = frameSeconds(projectFrames, project.fps);
  if (!duration) throw new Error('Add a photo, video, or title before saving a movie.');
  const estimatedBytes = duration * (bitrate + (includeAudio ? audioBitrate : 0)) / 8;
  if (estimatedBytes > 512 * 1024 * 1024) throw new Error('This export would exceed the 512 MB in-browser output buffer. Choose a lower bitrate or a shorter movie.');
  const storage = await navigator.storage?.estimate?.();
  if (storage?.quota && storage.usage !== undefined && storage.quota - storage.usage < estimatedBytes) throw new Error('There is not enough browser storage headroom for this movie. Free space or reduce export quality and try again.');
  options.onProgress?.({ fraction: 0, stage: 'Checking local encoders' });
  const capabilities = await getExportCapabilities(width, height, fps);
  if (format === 'mp4' ? !capabilities.mp4 : !capabilities.video || includeAudio && !capabilities.audio) throw new Error(format === 'mp4' ? 'This browser cannot encode H.264 and AAC. Choose WebM, or open the project in a browser with MP4 encoding support.' : capabilities.reason);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const target = new BufferTarget(); const output = new Output({ format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = includeAudio ? new AudioSampleSource({ codec: audioCodec, bitrate: audioBitrate }) : null;
  if (audio) output.addAudioTrack(audio);
  const started = performance.now(); const frameCount = Math.ceil(projectFrames * project.fps.den * options.fps.num / (project.fps.num * options.fps.den)); let peak = 0, peakTime = 0;
  try {
    let mixed: AudioBuffer | null = null;
    if (audio) { options.onProgress?.({ fraction: .01, stage: 'Mixing source sound, music and narration' }); mixed = await mixAudio(project, library, signal); for (let channel = 0; channel < mixed.numberOfChannels; channel++) { const data = mixed.getChannelData(channel); for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) { peak = Math.abs(data[i]); peakTime = i / mixed.sampleRate; } } }
    checkCancelled(signal); await output.start();
    // Add audio as an offline buffer, never as a real-time recording.
    if (audio && mixed) { for (const sample of AudioSample.fromAudioBuffer(mixed, 0)) { try { checkCancelled(signal); await audio.add(sample); } finally { sample.close(); } } audio.close(); }
    for (let index = 0; index < frameCount; index++) {
      checkCancelled(signal);
      const seconds = index * options.fps.den / options.fps.num;
      const projectFrame = index * options.fps.den * project.fps.num / (options.fps.num * project.fps.den);
      await renderFrame(project, projectFrame, canvas, library); checkCancelled(signal);
      await video.add(seconds, Math.min(options.fps.den / options.fps.num, duration - seconds));
      if (index % 3 === 0 || index === frameCount - 1) {
        const fraction = .05 + .9 * (index + 1) / frameCount;
        options.onProgress?.({ fraction, stage: `Rendering frame ${index + 1} of ${frameCount}`, ...(index > 20 ? { remainingSeconds: (performance.now() - started) / 1000 / (index + 1) * (frameCount - index - 1) } : {}) });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    video.close(); checkCancelled(signal); options.onProgress?.({ fraction: .96, stage: 'Finalizing and checking the movie' }); await output.finalize(); checkCancelled(signal);
    if (!target.buffer) throw new Error('The encoder returned no movie data.');
    const blob = new Blob([target.buffer], { type: mimeType });
    const validation = await validateOutput(blob, { width, height, duration, frames: frameCount, fps, audio: includeAudio, peak, peakTime, videoCodec, audioCodec }); checkCancelled(signal);
    options.onProgress?.({ fraction: 1, stage: 'Movie ready' }); return { blob, extension: format, mimeType, validation };
  } catch (error) { if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {}); throw error; }
}
