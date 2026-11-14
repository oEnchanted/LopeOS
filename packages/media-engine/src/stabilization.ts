import type { MovieProject, StabilizationData } from '../../movie-maker/src/model.ts';
import type { MediaLibrary } from './media.ts';
import { estimateTranslation, smoothMotionPath, type GrayFrame, type MotionEstimate, type MotionPoint } from './stabilization-math.ts';

export interface StabilizationOptions { signal?: AbortSignal; strength?: 'gentle' | 'strong'; onProgress?: (progress: { fraction: number; stage: string }) => void }
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Stabilization cancelled. Your clip is unchanged.', 'AbortError'); };

/** Only one pair of copied, downsampled frames is in flight. Originals never leave the shared media cache. */
export class MotionEstimator {
  private worker: Worker | null = typeof Worker === 'undefined' ? null : new Worker(new URL('./stabilization.worker.ts', import.meta.url), { type: 'module', name: 'LopeOS camera motion analysis' });
  private pending: ((error: Error) => void) | null = null;
  private disposed = false;
  estimate(previous: GrayFrame, current: GrayFrame, signal?: AbortSignal): Promise<MotionEstimate> {
    cancelled(signal); if (this.disposed) return Promise.reject(new DOMException('Motion analysis stopped.', 'AbortError'));
    if (!this.worker) return Promise.resolve(estimateTranslation(previous, current));
    if (this.pending) return Promise.reject(new Error('A motion-analysis pair is already in progress.'));
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending = null; signal?.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => { fail(new DOMException('Stabilization cancelled. Your clip is unchanged.', 'AbortError')); this.dispose(); };
      this.pending = fail; signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => { if (event.data.error) fail(new Error(event.data.error)); else { cleanup(); resolve(event.data.result); } };
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Motion analysis stopped unexpectedly. Try again.')); this.dispose(); };
      const a = { ...previous, data: previous.data.slice() }, b = { ...current, data: current.data.slice() };
      try { worker.postMessage({ previous: a, current: b }, [a.data.buffer, b.data.buffer]); } catch (error) { fail(error instanceof Error ? error : new Error('Motion analysis could not start.')); }
    });
  }
  dispose() { this.disposed = true; this.pending?.(new DOMException('Motion analysis stopped.', 'AbortError')); this.worker?.terminate(); this.worker = null; }
}

/** Interpolate an analysis in ORIGINAL source-frame time; trimming, splitting and speed edits do not invalidate it. */
export function stabilizationAt(data: StabilizationData | undefined, sourceFrame: number): { x: number; y: number; scale: number } {
  if (!data || !data.samples.length || sourceFrame < data.sourceIn || sourceFrame >= data.sourceOut) return { x: 0, y: 0, scale: 1 };
  const samples = data.samples; let low = 0, high = samples.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (samples[middle].frame <= sourceFrame) low = middle; else high = middle - 1; }
  const a = samples[low], b = samples[Math.min(samples.length - 1, low + 1)];
  const factor = b.frame === a.frame ? 0 : Math.max(0, Math.min(1, (sourceFrame - a.frame) / (b.frame - a.frame)));
  return { x: a.x + (b.x - a.x) * factor, y: a.y + (b.y - a.y) * factor, scale: data.cropScale };
}

/** Measure image translation, smooth the measured camera path, and derive the crop required to hide exposed borders. */
export async function analyzeStabilization(project: MovieProject, clipId: string, library: MediaLibrary, options: StabilizationOptions = {}): Promise<StabilizationData> {
  cancelled(options.signal);
  const clip = project.clips.find(item => item.id === clipId); if (!clip || clip.kind !== 'video' || !clip.assetId) throw new Error('Select a video clip to stabilize.');
  const asset = project.assets[clip.assetId]; if (!asset || !library.has(asset.id)) throw new Error('Relink the original video before analyzing camera motion.');
  if (asset.width < 1 || asset.height < 1) throw new Error('This project has no readable video dimensions. Relink the original clip before analyzing it.');
  const fps = project.fps.num / project.fps.den, duration = (clip.sourceOut - clip.sourceIn) / fps;
  if (duration < .2) throw new Error('Choose a clip at least 0.2 seconds long for camera-motion analysis.');
  if (duration > 600) throw new Error('Analyze clips up to ten minutes at a time. Split this clip into shorter sections first.');
  const sampleRate = Math.min(30, fps), count = Math.max(2, Math.ceil(duration * sampleRate));
  const width = Math.min(240, Math.max(96, Math.round(asset.width))), height = Math.max(72, Math.round(width * asset.height / asset.width));
  // Portrait input is capped by its long edge too, while keeping square analysis pixels.
  const factor = Math.min(1, 320 / height), analysisWidth = Math.max(32, Math.round(width * factor)), analysisHeight = Math.max(32, Math.round(height * factor));
  const canvas = document.createElement('canvas'); canvas.width = analysisWidth; canvas.height = analysisHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Video analysis needs a readable canvas on this device.');
  const estimator = new MotionEstimator(); const path: MotionPoint[] = [];
  let previous: GrayFrame | null = null, x = 0, y = 0, segment = 0;
  const smoothingSeconds = options.strength === 'strong' ? .75 : .35;
  try {
    for (let index = 0; index < count; index++) {
      cancelled(options.signal);
      const sourceFrame = clip.sourceIn + Math.min(clip.sourceOut - clip.sourceIn - .001, index / sampleRate * fps);
      // WebM's millisecond timestamps can round a nominal frame boundary forward by 0.5 ms.
      const sampleTime = Math.min((clip.sourceOut - .001) / fps, sourceFrame / fps + .00051);
      const source = await library.frame(asset.id, sampleTime, analysisWidth); cancelled(options.signal);
      context.drawImage(source, 0, 0, analysisWidth, analysisHeight);
      const rgba = context.getImageData(0, 0, analysisWidth, analysisHeight).data, gray = new Uint8Array(analysisWidth * analysisHeight);
      for (let at = 0; at < gray.length; at++) gray[at] = (rgba[at * 4] * 77 + rgba[at * 4 + 1] * 150 + rgba[at * 4 + 2] * 29) >> 8;
      const current = { width: analysisWidth, height: analysisHeight, data: gray };
      const motion = previous ? await estimator.estimate(previous, current, options.signal) : { x: 0, y: 0, confidence: 1, matches: 0, candidates: 0 };
      if (previous && motion.confidence < .2) { segment++; x = 0; y = 0; } else { x += motion.x; y += motion.y; }
      path.push({ frame: sourceFrame, x, y, confidence: motion.confidence, segment }); previous = current;
      options.onProgress?.({ fraction: (index + 1) / count * .95, stage: `Analyzing camera motion ${index + 1} of ${count}` });
      if (index % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    cancelled(options.signal); options.onProgress?.({ fraction: .97, stage: 'Smoothing measured motion and calculating the crop' });
    const result = smoothMotionPath(path, smoothingSeconds * sampleRate, analysisWidth, analysisHeight);
    if (result.confidence < .2) throw new Error('Not enough consistent background detail to stabilize this clip reliably. Try a shorter section with less blur or fewer moving foreground objects.');
    cancelled(options.signal); options.onProgress?.({ fraction: 1, stage: 'Motion analysis complete' });
    return { version: 1, method: 'translation', sourceAssetId: asset.id, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut, sampleRate, smoothingSeconds, ...result };
  } finally { estimator.dispose(); canvas.width = 1; canvas.height = 1; }
}
