import type { MediaAsset, MovieProject } from '../../movie-maker/src/model';
export type { MediaAsset, MovieProject };
export interface FrameRate { num: number; den: number }
export interface ImportedMedia { asset: MediaAsset; blob: Blob; thumbnail: string; waveform?: number[] }
export interface ExportOptions {
  format?: 'webm' | 'mp4';
  width: number; height: number; fps: FrameRate; bitrate: number; audioBitrate: number;
  includeAudio: boolean; signal?: AbortSignal;
  onProgress?: (progress: { fraction: number; stage: string; remainingSeconds?: number }) => void;
}
export interface ExportResult {
  blob: Blob; extension: 'webm' | 'mp4'; mimeType: 'video/webm' | 'video/mp4';
  validation: { duration: number; width: number; height: number; videoCodec: 'vp8' | 'avc'; audioCodec: 'opus' | 'aac' | null; frameCount: number; framesPerSecond: number; audioPeak: number };
}
export const frameSeconds = (frame: number, fps: FrameRate) => frame * fps.den / fps.num;
export function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Movie export cancelled. Your project is unchanged.', 'AbortError'); }
