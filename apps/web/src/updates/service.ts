import { useSyncExternalStore } from 'react';
import { checkModelUpdates, parseModelReleases, type ModelRelease } from './model-updates.ts';
import { checkUpdateStorage, optionalUpdateCheck, waitForUpdate } from './preflight.ts';

export interface ReleaseManifest {
  format: 1;
  version: string;
  build: string;
  releasedAt: string;
  totalBytes: number;
  assets: { url: string; size: number; sha256: string }[];
  models?: ModelRelease[];
}
export interface UpdateState {
  status: 'starting' | 'unsupported' | 'idle' | 'checking' | 'available' | 'preparing' | 'checking-release' | 'checking-storage' | 'checking-models' | 'downloading' | 'verifying' | 'installing' | 'restarting' | 'error';
  current: { version: string; build: string };
  available: ReleaseManifest | null;
  cached: boolean;
  caching: boolean;
  receivedBytes: number;
  totalBytes: number;
  downloadedBytes: number;
  downloadBytes: number;
  completedFiles: number;
  totalFiles: number;
  error: string | null;
  lastChecked: number | null;
  promptVisible: boolean;
  foreground: boolean;
  offline: boolean;
  modelCheck: string | null;
  progress: number;
}

const current = { version: import.meta.env.VITE_APP_VERSION || '0.1.0', build: import.meta.env.VITE_BUILD_ID || 'development' };
let state: UpdateState = {
  status: 'starting', current, available: null, cached: false, caching: false,
  receivedBytes: 0, totalBytes: 0, downloadedBytes: 0, downloadBytes: 0, completedFiles: 0, totalFiles: 0,
  error: null, lastChecked: null, promptVisible: false, foreground: false, offline: !navigator.onLine,
  modelCheck: null, progress: 0,
};
const listeners = new Set<() => void>();
const publish = (change: Partial<UpdateState>) => { state = { ...state, ...change }; listeners.forEach(listener => listener()); };
export const useSoftwareUpdate = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
export const formatUpdateBytes = (bytes: number) => {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  const power = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][power]}`;
};
export const formatReleaseDate = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString();

type PreparedWorkspace = { resume: () => void; retire: () => void };
type Preparation = () => Promise<PreparedWorkspace | null>;
let prepare: Preparation | undefined;
/** Keep application save/discard prompts visible before showing the boot screen. */
export function registerUpdatePreparation(handler: Preparation) {
  prepare = handler;
  return () => { if (prepare === handler) prepare = undefined; };
}

let registration: ServiceWorkerRegistration | undefined;
let startup: Promise<void> | undefined;
let checking: Promise<void> | undefined;
let installing = false;
let installController: AbortController | undefined;
let epoch = 0;
let checkEpoch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = true;
let releasePreparation: (() => void) | undefined;
let dismissedBuild: string | null = null;
try { dismissedBuild = sessionStorage.getItem('lope.update.dismissed.v1'); } catch { /* Session-only dismissal still works. */ }

type WorkerMessage = {
  type: 'STATUS' | 'PROGRESS' | 'COMPLETE' | 'ERROR';
  release?: ReleaseManifest | null;
  currentCached?: boolean;
  phase?: 'downloading' | 'verifying' | 'installing';
  receivedBytes?: number;
  totalBytes?: number;
  downloadedBytes?: number;
  downloadBytes?: number;
  completedFiles?: number;
  totalFiles?: number;
  message?: string;
};
function command(message: Record<string, unknown>, onProgress?: (message: WorkerMessage) => void): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const worker = registration?.active;
    if (!worker) { reject(new Error('The offline cache is not ready. Try checking for updates again.')); return; }
    const channel = new MessageChannel();
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, response?: WorkerMessage) => {
      clearTimeout(timeout); channel.port1.close();
      if (error) reject(error); else resolve(response!);
    };
    const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => finish(new Error('The update stopped responding. Your installed release is still available. Try again.')), 120_000); };
    channel.port1.onmessage = event => {
      const response = event.data as WorkerMessage;
      resetTimeout();
      if (response.type === 'PROGRESS') onProgress?.(response);
      else if (response.type === 'ERROR') finish(new Error(response.message || 'The update could not finish.'));
      else if (response.type === 'STATUS' || response.type === 'COMPLETE') finish(undefined, response);
    };
    channel.port1.onmessageerror = () => finish(new Error('The update response could not be read. Try again.'));
    resetTimeout();
    try { worker.postMessage(message, [channel.port2]); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

function parseRelease(value: unknown): ReleaseManifest {
  const release = value as ReleaseManifest | null;
  if (!release || release.format !== 1 || typeof release.version !== 'string' || !release.version
    || typeof release.build !== 'string' || !release.build || typeof release.releasedAt !== 'string'
    || !Number.isFinite(Date.parse(release.releasedAt)) || !Number.isSafeInteger(release.totalBytes) || release.totalBytes <= 0
    || !Array.isArray(release.assets) || !release.assets.length || release.assets.length > 20_000) {
    throw new Error('This deployment does not publish a complete software update. Try again after the release finishes publishing.');
  }
  const paths = new Set<string>();
  for (const asset of release.assets) {
    if (!asset || typeof asset.url !== 'string' || !asset.url.startsWith('/') || asset.url.startsWith('//')
      || asset.url.includes('\\') || asset.url.includes('?') || asset.url.includes('#')
      || !Number.isSafeInteger(asset.size) || asset.size < 0 || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || paths.has(asset.url)) throw new Error('The published update manifest is invalid. Your installed release has been kept.');
    paths.add(asset.url);
  }
  if (!paths.has('/index.html') || release.assets.reduce((sum, asset) => sum + asset.size, 0) !== release.totalBytes) {
    throw new Error('The published update is incomplete. Your installed release has been kept.');
  }
  return { ...release, models: parseModelReleases(release.models) };
}
async function fetchRelease(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch('/__lope/version.json', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error('Update information is unavailable. Try again when the server is reachable.');
  return parseRelease(await response.json());
}
const failureMessage = (cause: unknown) => !navigator.onLine
  ? 'You’re offline. Reconnect to check for and download updates. Your cached release is still available.'
  : cause instanceof Error ? cause.message : 'The update could not finish. Try again.';

async function connect() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  // An installed worker can operate offline, without fetching its script again.
  registration = existing?.active ? existing : await navigator.serviceWorker.register('/lope-sw.js', { scope: '/', updateViaCache: 'none' });
  // A changed worker waits for old tabs to close; its v1 release protocol stays
  // compatible with app updates without taking control during a download.
  if (existing?.active && navigator.onLine) void registration.update().catch(() => {});
  if (!registration.active) {
    const waiting = registration.installing || registration.waiting;
    if (!waiting) throw new Error('LopeOS could not start its offline cache. Try again.');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { waiting.removeEventListener('statechange', change); reject(new Error('The offline cache took too long to start. Try again.')); }, 20_000);
      function change() {
        if (waiting!.state === 'activated' || waiting!.state === 'redundant') {
          clearTimeout(timeout); waiting!.removeEventListener('statechange', change);
          if (waiting!.state === 'activated') resolve(); else reject(new Error('The offline cache could not be installed.'));
        }
      }
      waiting.addEventListener('statechange', change); change();
    });
  }
}

async function performCheck(silent = false) {
  if (installing || state.foreground || paused || import.meta.env.DEV || state.status === 'unsupported') return;
  const run = epoch;
  const token = checkEpoch;
  const relevant = () => run === epoch && token === checkEpoch && !installing && !state.foreground;
  if (!silent) publish({ status: 'checking', error: null });
  try {
    if (!registration?.active) await connect();
    const status = await command({ type: 'LOPE_STATUS', build: current.build });
    if (!relevant()) return;
    publish({ cached: status.currentCached ?? status.release?.build === current.build });
    if (state.cached) await command({ type: 'LOPE_PIN', build: current.build });
    const release = await fetchRelease();
    if (!relevant()) return;
    publish({ lastChecked: Date.now(), offline: false, error: null });
    if (release.build !== current.build) {
      publish({ available: release, status: 'available', promptVisible: dismissedBuild !== release.build });
    } else {
      publish({ available: null, status: 'idle', promptVisible: false });
      // First visit saves exactly the release currently running. A deployment
      // arriving during this download fails integrity checks instead of mixing builds.
      if (!state.cached && (!status.release || status.release.build === current.build)) {
        publish({ caching: true });
        await command({ type: 'LOPE_CACHE_RELEASE', release, activate: true });
        if (!relevant()) return;
        await command({ type: 'LOPE_PIN', build: current.build });
        publish({ cached: true, caching: false });
      }
    }
  } catch (cause) {
    if (!relevant()) return;
    publish({ caching: false, offline: !navigator.onLine,
      status: silent && state.available ? 'available' : 'error', error: failureMessage(cause) });
  }
}
function check(silent = false) {
  if (!checking) {
    const operation = performCheck(silent).finally(() => { if (checking === operation) checking = undefined; });
    checking = operation;
  }
  return checking;
}
const reconnect = () => { publish({ offline: !navigator.onLine }); if (navigator.onLine) void check(true); };
const focus = () => { if (!document.hidden && Date.now() - (state.lastChecked || 0) > 60_000) void check(true); };

async function start() {
  if (startup) return startup;
  paused = false;
  const run = ++epoch;
  if (import.meta.env.DEV || !window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
    publish({ status: 'unsupported', error: import.meta.env.DEV
      ? 'Software updates are available in production builds. Development mode always uses the current source.'
      : 'Cached software updates need a browser with service worker support over HTTPS or localhost.' });
    return;
  }
  startup = (async () => {
    publish({ status: 'starting' });
    try { await connect(); if (run === epoch) await check(true); }
    catch (cause) { if (run === epoch) publish({ status: 'error', error: failureMessage(cause) }); }
    if (run !== epoch) return;
    timer = setInterval(() => { if (!document.hidden && navigator.onLine) void check(true); }, 5 * 60_000);
    window.addEventListener('online', reconnect); window.addEventListener('offline', reconnect);
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
  })();
  return startup;
}
function pauseForReset() {
  if (paused) return;
  paused = true; epoch++; checkEpoch++; clearInterval(timer);
  installController?.abort();
  window.removeEventListener('online', reconnect); window.removeEventListener('offline', reconnect);
  window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
  if (registration?.active) void command({ type: 'LOPE_CANCEL' }).catch(() => {});
  startup = undefined; checking = undefined;
  publish({ cached: false, caching: false, available: null, promptVisible: false, foreground: false, error: null });
}

async function cancelForReset() {
  if (!('serviceWorker' in navigator)) return;
  // Reset-only boots do not start Software Update. Locate an existing worker
  // and wait until all cache writers stop before factory reset erases storage.
  registration = await navigator.serviceWorker.getRegistration('/');
  if (registration?.active) await command({ type: 'LOPE_CANCEL' });
}

async function requestInstall() {
  if (installing || state.caching || !state.available || paused) return;
  installing = true;
  checkEpoch++;
  const release = state.available;
  const run = epoch;
  const controller = new AbortController();
  installController = controller;
  const { signal } = controller;
  const ensureCurrent = () => { signal.throwIfAborted(); if (run !== epoch) throw new DOMException('Update cancelled.', 'AbortError'); };
  const step = async (status: UpdateState['status'], progress: number, operation: () => Promise<void>, minimumMs = 1000) => {
    ensureCurrent();
    publish({ status, progress });
    const started = performance.now();
    await operation();
    await waitForUpdate(minimumMs - (performance.now() - started), signal);
    ensureCurrent();
  };
  publish({ status: 'preparing', promptVisible: false, foreground: false, error: null, modelCheck: null, progress: 0 });
  try {
    if (!prepare) throw new Error('Open your desktop before installing an update.');
    const workspace = await prepare();
    if (!workspace) { if (run === epoch) publish({ status: 'available' }); return; }
    releasePreparation = workspace.resume;
    if (run !== epoch) { workspace.resume(); releasePreparation = undefined; return; }
    publish({ status: 'checking-release', foreground: true, receivedBytes: 0, totalBytes: release.totalBytes,
      downloadedBytes: 0, downloadBytes: release.totalBytes, completedFiles: 0, totalFiles: release.assets.length });
    // Allow the black boot surface to paint before work starts.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await step('checking-release', 2, async () => {
      const latest = await fetchRelease(signal);
      ensureCurrent();
      if (latest.build !== release.build) {
        publish({ available: latest });
        throw new Error('The published release changed while you were preparing. Try again to install the latest update.');
      }
      // Revalidate the exact release the user approved, including model metadata.
      const approvedAssets = new Map(release.assets.map(asset => [asset.url, asset]));
      const sameAssets = latest.assets.length === release.assets.length && latest.assets.every(asset => {
        const saved = approvedAssets.get(asset.url);
        return saved?.size === asset.size && saved.sha256 === asset.sha256;
      });
      if (!sameAssets || JSON.stringify(latest.models) !== JSON.stringify(release.models)) throw new Error('This release changed after it was published. Check for updates again when the deployment has finished.');
      if (!registration?.active) await connect();
    });
    await step('checking-storage', 8, async () => {
      const [saved, estimate, cacheNames] = await Promise.all([
        command({ type: 'LOPE_STATUS', build: release.build }),
        navigator.storage?.estimate?.().catch(() => undefined),
        caches.keys(),
      ]);
      ensureCurrent();
      // A fully staged retry needs no second release-sized allocation.
      const keep = new Set([current.build, release.build, saved.release?.build].filter((build): build is string => Boolean(build))
        .map(build => 'lope.os.release.v1:' + encodeURIComponent(build)));
      const mayReclaimSpace = cacheNames.some(name => name.startsWith('lope.os.release.v1:') && !keep.has(name));
      checkUpdateStorage(estimate, saved.currentCached ? 0 : release.totalBytes, mayReclaimSpace);
    });
    await step('checking-models', 14, async () => {
      const modelCheck = await optionalUpdateCheck(checkModelUpdates(release.models), signal);
      ensureCurrent();
      publish({ modelCheck });
    });
    ensureCurrent();
    publish({ status: 'downloading', progress: 20 });
    let verificationStarted: number | undefined;
    await command({ type: 'LOPE_CACHE_RELEASE', release, activate: false }, progress => {
      if (run !== epoch) return;
      if (progress.phase === 'verifying' && verificationStarted === undefined) verificationStarted = performance.now();
      publish({ status: progress.phase || 'downloading',
        progress: progress.phase === 'verifying' ? 88 : 20 + Math.min(68, Math.floor((progress.receivedBytes ?? 0) / release.totalBytes * 68)),
        receivedBytes: progress.receivedBytes ?? 0, totalBytes: progress.totalBytes ?? release.totalBytes,
        downloadedBytes: progress.downloadedBytes ?? progress.receivedBytes ?? 0,
        downloadBytes: progress.downloadBytes ?? release.totalBytes,
        completedFiles: progress.completedFiles ?? 0, totalFiles: progress.totalFiles ?? release.assets.length });
    });
    ensureCurrent();
    publish({ status: 'verifying', progress: 88 });
    await waitForUpdate(1000 - (performance.now() - (verificationStarted ?? performance.now())), signal);
    await step('installing', 96, async () => {
      // Keep the short installation stage visible before committing the release.
      await waitForUpdate(1000, signal);
      ensureCurrent();
      await command({ type: 'LOPE_ACTIVATE', build: release.build });
    });
    // Retire the approved app instances only after the update commits. This
    // removes their native unload guards after an explicit discard decision.
    workspace.retire();
    releasePreparation = undefined;
    publish({ status: 'restarting', progress: 100, receivedBytes: release.totalBytes, completedFiles: release.assets.length });
    await waitForUpdate(750, signal);
    ensureCurrent();
    // Only this tab restarts. Other tabs keep their pinned release and unsaved work.
    window.location.reload();
  } catch (cause) {
    if (run === epoch) publish({ status: 'error', error: failureMessage(cause), promptVisible: !state.foreground });
    releasePreparation?.(); releasePreparation = undefined;
  } finally { installing = false; if (installController === controller) installController = undefined; }
}

export const softwareUpdates = {
  start, pauseForReset, cancelForReset, check: () => check(), requestInstall,
  dismissPrompt() {
    dismissedBuild = state.available?.build ?? null;
    try { if (dismissedBuild) sessionStorage.setItem('lope.update.dismissed.v1', dismissedBuild); } catch { /* Optional persistence. */ }
    publish({ promptVisible: false });
  },
  showPrompt() { if (state.available) publish({ promptVisible: true }); },
  returnToDesktop() {
    if (state.status !== 'error') return;
    releasePreparation?.(); releasePreparation = undefined;
    publish({ foreground: false, status: state.available ? 'available' : 'idle' });
  },
};
