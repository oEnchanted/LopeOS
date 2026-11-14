import { LEGACY_MODEL_IDS, MODEL_DOWNLOAD_LABEL, MODEL_IDS, MODEL_NAME } from '../shell/spotlight-ai/core.ts';
import { deleteCachedModels } from '../shell/spotlight-ai/cache.ts';
import { DENOISE_PACKAGE } from '../../../../packages/photo-engine/src/denoise-manifest.ts';
import { installedDenoise, installDenoise } from '../../../../packages/photo-engine/src/denoise-cache.ts';
import { AI_MODEL, AI_DOWNLOAD_BYTES } from '../../../../packages/image-engine/src/ai/catalog.ts';
import { localAIInstalled, installLocalAI } from '../../../../packages/image-engine/src/ai/cache.ts';
import { cachedSpotlightModel, downloadSpotlightModel, type SpotlightModelRecord, type ByteProgress } from './local-model-download.ts';

export type ModelId = 'spotlight' | 'denoise' | 'portrait';
export type ModelStatus = 'checking' | 'available' | 'queued' | 'downloading' | 'verifying' | 'installed' | 'cancelled' | 'unsupported' | 'error';
export interface LocalModelState {
  id: ModelId; title: string; modelName: string; description: string; purpose: string;
  sizeBytes: number | null; sizeLabel: string; status: ModelStatus;
  received: number; total: number | null; bytesPerSecond: number;
  error: string; message: string; file: string;
}
export interface LocalModelsSnapshot { checking: boolean; busy: boolean; activeId: ModelId | null; models: LocalModelState[] }
export interface LocalModelDependencies {
  support(): Promise<{ supported: true; shaderF16: boolean } | { supported: false; reason: string }>;
  supportTimeoutMs?: number;
  spotlightRecord(modelId: string): Promise<SpotlightModelRecord>;
  inspectSpotlight(record: SpotlightModelRecord): Promise<{ installed: boolean; sizeBytes: number | null }>;
  downloadSpotlight(record: SpotlightModelRecord, signal: AbortSignal, progress: (value: ByteProgress) => void): Promise<number>;
  inspectDenoise(): Promise<boolean>;
  downloadDenoise(signal: AbortSignal, progress: (value: ByteProgress) => void): Promise<void>;
  inspectPortrait(): Promise<boolean>;
  downloadPortrait(signal: AbortSignal, progress: (value: ByteProgress) => void): Promise<void>;
  now(): number;
}
const definitions = [
  { id: 'spotlight', title: 'Spotlight AI', modelName: MODEL_NAME, purpose: 'Chat in Spotlight', description: 'Answer questions and draft text using a local model. Requires WebGPU. It has no live web access and can give incorrect answers.', sizeBytes: null, sizeLabel: MODEL_DOWNLOAD_LABEL },
  { id: 'denoise', title: 'Photo denoise', modelName: DENOISE_PACKAGE.name, purpose: 'Reduce noise in Luma photos', description: 'Reduce grain and color noise. Saves the result as a separate copy and keeps the original photo.', sizeBytes: DENOISE_PACKAGE.totalBytes, sizeLabel: '18.4 MB' },
  { id: 'portrait', title: 'Portrait cutouts', modelName: AI_MODEL.name, purpose: 'Remove portrait backgrounds in Prism', description: 'Select people or remove portrait backgrounds. The model is trained for people; other subjects need manual selection.', sizeBytes: AI_DOWNLOAD_BYTES, sizeLabel: '37.2 MB' },
] as const;
const emptyState = (): LocalModelsSnapshot => ({ checking: false, busy: false, activeId: null, models: definitions.map(model => ({ ...model, status: 'checking', received: 0, total: model.sizeBytes, bytesPerSecond: 0, error: '', message: 'Checking saved downloads…', file: '' })) });
const asMessage = (error: unknown) => error instanceof Error ? error.message : 'The model could not be downloaded. Check your connection and available browser storage, then try again.';

/** Recent, actual response-body bytes only; cached bytes never inflate download speed. */
export class DownloadRate {
  private samples: { time: number; bytes: number }[] = [];
  private now: () => number;
  constructor(now: () => number) { this.now = now; }
  update(bytes: number): number {
    const time = this.now();
    if (!this.samples.length) this.samples.push({ time, bytes });
    this.samples.push({ time, bytes });
    while (this.samples.length > 2 && this.samples[1].time < time - 2000) this.samples.shift();
    const first = this.samples[0], elapsed = (time - first.time) / 1000;
    return elapsed >= .1 ? Math.max(0, (bytes - first.bytes) / elapsed) : 0;
  }
}

/** Download jobs belong to the session, not a wizard step, so Continue is safe. */
export class LocalModelService {
  private snapshot = emptyState();
  private listeners = new Set<() => void>();
  private inspection: Promise<void> | null = null;
  private inspected = false;
  private record: SpotlightModelRecord | null = null;
  private queue: ModelId[] = [];
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private dependencies: LocalModelDependencies;
  constructor(dependencies: LocalModelDependencies) { this.dependencies = dependencies; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(change: Partial<LocalModelsSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...change }; this.listeners.forEach(listener => listener()); }
  private row(id: ModelId, change: Partial<LocalModelState>) { this.publish({ models: this.snapshot.models.map(model => model.id === id ? { ...model, ...change } : model) }); }
  private async probeSupport() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.dependencies.support(),
        new Promise<{ supported: false; reason: string }>(resolve => {
          timer = setTimeout(() => resolve({ supported: false, reason: 'Checking graphics support took too long. You can still download the photo models.' }), this.dependencies.supportTimeoutMs ?? 10000);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  inspect(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.inspection) return this.inspection;
    this.publish({ checking: true });
    this.inspection = this.check().finally(() => { this.inspection = null; this.inspected = true; this.publish({ checking: false }); });
    return this.inspection;
  }
  private async check() {
    await Promise.all([
      (async () => {
        try {
          const support = await this.probeSupport();
          if (!support.supported) { this.record = null; this.row('spotlight', { status: 'unsupported', error: '', message: support.reason }); return; }
          const record = await this.dependencies.spotlightRecord(MODEL_IDS[support.shaderF16 ? 0 : 1]);
          this.record = record;
          const cached = await this.dependencies.inspectSpotlight(record);
          this.row('spotlight', { status: cached.installed ? 'installed' : 'available', sizeBytes: cached.sizeBytes, total: cached.sizeBytes, received: cached.installed ? cached.sizeBytes ?? 0 : 0, bytesPerSecond: 0, error: '', message: cached.installed ? 'Saved in this browser. Ready for Spotlight.' : 'One compatible model variant will be downloaded.' });
        } catch (error) { this.row('spotlight', { status: 'error', message: 'Could not check the assistant download.', error: asMessage(error), bytesPerSecond: 0 }); }
      })(),
      ...(['denoise', 'portrait'] as const).map(async id => {
        try {
          const installed = await (id === 'denoise' ? this.dependencies.inspectDenoise() : this.dependencies.inspectPortrait());
          const size = this.snapshot.models.find(model => model.id === id)!.sizeBytes!;
          this.row(id, { status: installed ? 'installed' : 'available', received: installed ? size : 0, total: size, bytesPerSecond: 0, error: '', message: installed ? 'Saved in this browser. Ready to use.' : 'Model and processing engine included.' });
        } catch (error) { this.row(id, { status: 'error', message: 'Could not check local model storage.', error: asMessage(error), bytesPerSecond: 0 }); }
      }),
    ]);
  }
  install(id: ModelId): Promise<void> { return this.enqueue([id]); }
  installAll(): Promise<void> { return this.enqueue(definitions.map(model => model.id)); }
  private async enqueue(ids: ModelId[]) {
    if (!this.inspected || this.inspection) await this.inspect();
    for (const id of ids) {
      const state = this.snapshot.models.find(model => model.id === id);
      if (!state || state.status === 'installed' || state.status === 'unsupported' || this.snapshot.activeId === id || this.queue.includes(id)) continue;
      this.queue.push(id); this.row(id, { status: 'queued', bytesPerSecond: 0, error: '', message: 'Waiting to download…' });
    }
    if (!this.running && this.queue.length) this.running = this.drain();
    await this.running;
  }
  cancel() {
    this.controller?.abort();
    for (const id of this.queue) this.row(id, { status: 'cancelled', bytesPerSecond: 0, message: 'Download cancelled. You can try again any time.' });
    this.queue = [];
    if (this.snapshot.activeId) this.row(this.snapshot.activeId, { status: 'cancelled', bytesPerSecond: 0, error: '', message: 'Download cancelled. Complete cached files can be reused.' });
  }
  private async drain() {
    this.publish({ busy: true });
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const controller = new AbortController(); this.controller = controller;
        const rate = new DownloadRate(this.dependencies.now); rate.update(0);
        let transferred = 0;
        this.publish({ activeId: id });
        this.row(id, { status: 'downloading', received: 0, bytesPerSecond: 0, error: '', message: 'Preparing download…', file: '' });
        const heartbeat = setInterval(() => { if (!controller.signal.aborted && this.controller === controller) this.row(id, { bytesPerSecond: this.snapshot.models.find(model => model.id === id)?.status === 'downloading' ? rate.update(transferred) : 0 }); }, 500);
        const progress = (value: ByteProgress) => {
          if (controller.signal.aborted || this.controller !== controller) return;
          transferred = value.transferred;
          this.row(id, { status: value.verifying ? 'verifying' : 'downloading', received: value.received, total: value.total, ...(value.total !== null ? { sizeBytes: value.total } : {}), bytesPerSecond: value.verifying ? 0 : rate.update(transferred), file: value.file, message: value.verifying ? 'Checking and saving downloaded files…' : 'Downloading to this browser…' });
        };
        try {
          let size: number;
          if (id === 'spotlight') {
            if (!this.record) {
              const support = await this.probeSupport();
              if (!support.supported) { this.row(id, { status: 'unsupported', message: support.reason }); continue; }
              this.record = await this.dependencies.spotlightRecord(MODEL_IDS[support.shaderF16 ? 0 : 1]);
            }
            size = await this.dependencies.downloadSpotlight(this.record, controller.signal, progress);
          } else if (id === 'denoise') { await this.dependencies.downloadDenoise(controller.signal, progress); size = DENOISE_PACKAGE.totalBytes; }
          else { await this.dependencies.downloadPortrait(controller.signal, progress); size = AI_DOWNLOAD_BYTES; }
          controller.signal.throwIfAborted();
          this.row(id, { status: 'installed', received: size, total: size, sizeBytes: size, bytesPerSecond: 0, error: '', file: '', message: 'Saved in this browser. Ready to use.' });
        } catch (error) {
          this.row(id, { status: controller.signal.aborted ? 'cancelled' : 'error', bytesPerSecond: 0, error: controller.signal.aborted ? '' : asMessage(error), message: controller.signal.aborted ? 'Download cancelled. Complete cached files can be reused.' : 'Download interrupted. Your completed downloads are kept.' });
        } finally { clearInterval(heartbeat); this.controller = null; }
      }
    } finally { this.running = null; this.publish({ busy: false, activeId: null }); }
  }
}

type GPUAccess = { requestAdapter(options?: { powerPreference: string }): Promise<{ features: { has(name: string): boolean } } | null> };
const dependencies: LocalModelDependencies = {
  async support() {
    if (!globalThis.isSecureContext) return { supported: false, reason: 'Spotlight AI requires HTTPS or localhost.' };
    if (typeof Worker === 'undefined') return { supported: false, reason: 'This browser does not support the background worker needed for Spotlight AI.' };
    const gpu = (navigator as Navigator & { gpu?: GPUAccess }).gpu;
    if (!gpu) return { supported: false, reason: 'Spotlight AI requires WebGPU and hardware acceleration. You can still download the photo models.' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    return adapter ? { supported: true, shaderF16: adapter.features.has('shader-f16') } : { supported: false, reason: 'No compatible graphics device is available for Spotlight AI. You can still download the photo models.' };
  },
  async spotlightRecord(modelId) {
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    if (prebuiltAppConfig.cacheBackend && prebuiltAppConfig.cacheBackend !== 'cache') throw new Error('The assistant cache format changed. Update the setup downloader before installing.');
    const record = prebuiltAppConfig.model_list.find(model => model.model_id === modelId);
    if (!record?.model_lib) throw new Error('The compatible Spotlight AI model could not be found.');
    return { model: record.model, model_id: record.model_id, model_lib: record.model_lib, model_manifest: record.model_manifest };
  },
  inspectSpotlight: record => typeof caches === 'undefined' ? Promise.reject(new Error('Browser model storage is unavailable.')) : cachedSpotlightModel(record, caches),
  async downloadSpotlight(record, signal, progress) {
    signal.throwIfAborted();
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    signal.throwIfAborted();
    const outdated = prebuiltAppConfig.model_list.filter(model => LEGACY_MODEL_IDS.includes(model.model_id) && !(MODEL_IDS as readonly string[]).includes(model.model_id));
    await deleteCachedModels(outdated);
    signal.throwIfAborted();
    return downloadSpotlightModel(record, signal, progress);
  },
  inspectDenoise: async () => Boolean(await installedDenoise()),
  async downloadDenoise(signal, progress) { await installDenoise(signal, value => progress({ received: value.received, transferred: value.received, total: value.total, file: value.file, verifying: value.received === value.total })); },
  inspectPortrait: localAIInstalled,
  async downloadPortrait(signal, progress) { await installLocalAI(signal, value => progress({ received: value.loaded, transferred: value.networkReceived ?? 0, total: value.total, file: value.file, verifying: value.loaded === value.total })); },
  now: () => performance.now(),
};
export const localModels = new LocalModelService(dependencies);
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => localModels.cancel());
