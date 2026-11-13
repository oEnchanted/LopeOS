export const RESET_STORAGE_KEY = 'lope.reset.pending.v1';
export type FactoryResetRequest = { version: 1; id: string; requestedAt: number; reduceMotion: boolean };

const DATABASES = ['lope.writer.recovery.v1', 'lope.image-editor', 'lope.photo-library.v1', 'lope.photo-ai-models.v1', 'lope.drive.v1', 'lope.cloud.sync.v1'];
const WEBLLM_CACHES = new Set(['webllm/model', 'webllm/config', 'webllm/wasm']);
type ResetStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

/** Browser boundaries are injectable so reset tests never touch a real profile. */
export type FactoryResetEnvironment = {
  localStorage: ResetStorage;
  sessionStorage: ResetStorage;
  indexedDB?: Pick<IDBFactory, 'deleteDatabase'> & Partial<Pick<IDBFactory, 'databases'>>;
  caches?: Pick<CacheStorage, 'keys' | 'delete'>;
  withLock?: (operation: () => Promise<void>) => Promise<void>;
  resetMemory: () => void | Promise<void>;
  dispatchRequest: (request: FactoryResetRequest) => void;
  databaseTimeoutMs?: number;
};

export function parseFactoryResetRequest(raw: string | null): FactoryResetRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && value.version === 1 && typeof value.id === 'string' && value.id.length > 0
      && typeof value.requestedAt === 'number' && Number.isFinite(value.requestedAt)
      && typeof value.reduceMotion === 'boolean' ? value : null;
  } catch { return null; }
}

function clearStorage(storage: ResetStorage, preserveMarker = false) {
  // Snapshot keys first: removing a key changes Storage's numeric indices.
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    // Reset leaves the remote runtime workspace in place. Keep its ownership fence
    // so another cloud account cannot silently upload that previous user's files.
    if (key?.startsWith('lope.') && key !== 'lope.cloud.workspace-owner.v1' && !(preserveMarker && key === RESET_STORAGE_KEY)) storage.removeItem(key);
  }
}

export function createFactoryResetService(environment: FactoryResetEnvironment) {
  const jobs = new Map<string, { promise: Promise<void>; progress: number; listeners: Set<(progress: number) => void> }>();
  // An IDB deletion cannot be cancelled. Keep its actual completion promise after
  // a UI timeout, so Retry cannot finish while an older deletion is still queued.
  const deletions = new Map<string, Promise<void>>();
  const authoritativeRequest = () => parseFactoryResetRequest(environment.localStorage.getItem(RESET_STORAGE_KEY));
  const read = () => authoritativeRequest() ?? parseFactoryResetRequest(environment.sessionStorage.getItem(RESET_STORAGE_KEY));
  function remember(value: FactoryResetRequest) {
    environment.sessionStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(value));
    if (parseFactoryResetRequest(environment.sessionStorage.getItem(RESET_STORAGE_KEY))?.id !== value.id) {
      throw new Error('Reset could not save this tab’s session. Allow browser storage and try again.');
    }
  }

  function request(reduceMotion: boolean) {
    const pending = read();
    if (pending) { remember(pending); environment.dispatchRequest(pending); return; }
    const value: FactoryResetRequest = { version: 1, id: crypto.randomUUID(), requestedAt: Date.now(), reduceMotion };
    try {
      remember(value);
      environment.localStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(value));
      if (authoritativeRequest()?.id !== value.id) throw new Error('Reset request was not saved.');
    } catch {
      try { environment.sessionStorage.removeItem(RESET_STORAGE_KEY); } catch { /* Keep the storage error actionable. */ }
      throw new Error('Reset could not be started because browser storage is unavailable. Allow storage for LopeOS and try again.');
    }
    environment.dispatchRequest(value);
  }

  function deleteDatabase(name: string, requestId: string) {
    const key = `${requestId}:${name}`;
    let operation = deletions.get(key);
    if (!operation) {
      operation = new Promise<void>((resolve, reject) => {
        const deletion = environment.indexedDB!.deleteDatabase(name);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(new Error(`Could not erase ${name}. ${deletion.error?.message || 'Try resetting again.'}`));
        // A blocked request stays alive until the other connection closes.
        deletion.onblocked = () => {};
      });
      deletions.set(key, operation);
      void operation.catch(() => { deletions.delete(key); });
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reset is waiting for saved app data to close. Close other LopeOS tabs or windows, then try again.')),
        environment.databaseTimeoutMs ?? 10_000);
      operation.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  function perform(value: FactoryResetRequest, onProgress: (progress: number) => void): Promise<void> {
    const existing = jobs.get(value.id);
    if (existing) {
      existing.listeners.add(onProgress);
      onProgress(existing.progress);
      return existing.promise;
    }
    const job = { promise: Promise.resolve(), progress: 0, listeners: new Set([onProgress]) };
    const progress = (amount: number) => {
      job.progress = amount;
      job.listeners.forEach(listener => listener(amount));
    };
    const finishThisTab = async () => {
      clearStorage(environment.sessionStorage);
      await environment.resetMemory();
      progress(100);
    };
    const erase = async () => {
      // Another tab can finish while this tab waits for the reset lock. Never
      // erase a new account created after that completed reset.
      if (authoritativeRequest()?.id !== value.id) {
        await finishThisTab();
        return;
      }
      progress(10);
      const databaseNames = new Set(DATABASES);
      if (environment.indexedDB?.databases) {
        for (const database of await environment.indexedDB.databases()) {
          if (database.name?.startsWith('lope.')) databaseNames.add(database.name);
        }
      }
      const cacheNames = environment.caches ? (await environment.caches.keys()).filter(name =>
        name.startsWith('lope.') || name.startsWith('lope-') || WEBLLM_CACHES.has(name)) : [];
      // Discovery yields to the browser; recheck before touching shared data.
      if (authoritativeRequest()?.id !== value.id) {
        await finishThisTab();
        return;
      }
      clearStorage(environment.localStorage, true);
      clearStorage(environment.sessionStorage);
      progress(30);
      if (environment.indexedDB) {
        // Await all results before releasing the lock, including failed requests.
        const results = await Promise.allSettled([...databaseNames].map(name => deleteDatabase(name, value.id)));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      progress(60);
      if (environment.caches) {
        const results = await Promise.allSettled(cacheNames.map(name => environment.caches!.delete(name)));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      progress(85);
      await environment.resetMemory();
      // Keep the recovery marker until every data store and in-memory session is
      // cleared. A reload or failure at any earlier stage safely retries reset.
      if (authoritativeRequest()?.id === value.id) environment.localStorage.removeItem(RESET_STORAGE_KEY);
      progress(100);
    };
    // Start on a microtask so StrictMode's second caller sees the same job.
    job.promise = Promise.resolve().then(() => environment.withLock ? environment.withLock(erase) : erase());
    jobs.set(value.id, job);
    void job.promise.catch(() => { jobs.delete(value.id); });
    return job.promise;
  }

  return { read, remember, request, perform };
}

let browserService: ReturnType<typeof createFactoryResetService> | undefined;
function getBrowserService() {
  if (!browserService) {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (typeof locks?.request !== 'function') {
      throw new Error('Reset isn’t supported in this browser connection. Use an up-to-date browser over HTTPS or localhost, then try again.');
    }
    try {
      browserService = createFactoryResetService({
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
        indexedDB: window.indexedDB,
        caches: window.caches,
        withLock: operation => locks.request(RESET_STORAGE_KEY, operation),
        resetMemory: async () => {
          const [{ preferences }, { accounts }] = await Promise.all([import('./preferences'), import('./accounts')]);
          accounts.signOut();
          preferences.resetForSetup();
        },
        dispatchRequest: request => window.dispatchEvent(new CustomEvent('lope:reset-requested', { detail: request })),
      });
    } catch {
      throw new Error('Reset needs access to this browser’s storage. Allow storage for LopeOS and try again.');
    }
  }
  return browserService;
}

export function readFactoryResetRequest(): FactoryResetRequest | null {
  try {
    return parseFactoryResetRequest(window.localStorage.getItem(RESET_STORAGE_KEY))
      ?? parseFactoryResetRequest(window.sessionStorage.getItem(RESET_STORAGE_KEY));
  } catch { return null; }
}

/** Preserve an incoming cross-tab request even if another tab finishes first. */
export function rememberFactoryResetForTab(request: FactoryResetRequest): void {
  getBrowserService().remember(request);
}

/** Request a clean reset boot; the shell supplies the black screen and reload. */
export function requestFactoryReset(reduceMotion: boolean): void {
  getBrowserService().request(reduceMotion);
}

/** Call only from the reset-only boot, after the desktop and its workers reload. */
export function performFactoryReset(request: FactoryResetRequest, onProgress: (progress: number) => void): Promise<void> {
  try { return getBrowserService().perform(request, onProgress); } catch (error) { return Promise.reject(error); }
}
