import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFactoryResetService, parseFactoryResetRequest, requestFactoryReset, RESET_STORAGE_KEY, type FactoryResetEnvironment, type FactoryResetRequest } from '../../packages/sdk/src/reset.ts';
import { PreferenceStore, preferenceDefaults } from '../../packages/sdk/src/preferences.ts';

class MemoryStorage {
  values = new Map<string, string>();
  removed: string[] = [];
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.removed.push(key); this.values.delete(key); }
}

class FakeDatabases {
  names = new Set(['lope.writer.recovery.v1', 'lope.image-editor', 'lope.photo-library.v1', 'lope.photo-ai-models.v1', 'lope.future-app.v1', 'other-app']);
  deleted: string[] = [];
  blocked = new Set<string>();
  pending = new Map<string, IDBOpenDBRequest>();
  databases = async () => [...this.names].map(name => ({ name, version: 1 }));
  deleteDatabase = (name: string) => {
    this.deleted.push(name);
    const request = {} as IDBOpenDBRequest;
    this.pending.set(name, request);
    queueMicrotask(() => {
      if (this.blocked.has(name)) request.onblocked?.call(request, {} as IDBVersionChangeEvent);
      else this.complete(name);
    });
    return request;
  };
  complete(name: string) {
    const request = this.pending.get(name);
    assert.ok(request, `Expected a pending deletion for ${name}`);
    this.names.delete(name);
    this.pending.delete(name);
    request.onsuccess?.call(request, {} as Event);
  }
}

const request: FactoryResetRequest = { version: 1, id: 'reset-test', requestedAt: 123, reduceMotion: false };
function fixture() {
  const localStorage = new MemoryStorage(), sessionStorage = new MemoryStorage(), indexedDB = new FakeDatabases();
  localStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(request));
  const cacheNames = new Set(['lope-image-ai-modnet-ort122-v1', 'lope.cache.thumbnails', 'webllm/model', 'webllm/config', 'webllm/wasm', 'other-app', 'webllm/unrelated']);
  const deletedCaches: string[] = [];
  let memoryResets = 0;
  const dispatched: FactoryResetRequest[] = [];
  const environment: FactoryResetEnvironment = {
    localStorage, sessionStorage, indexedDB,
    caches: {
      keys: async () => [...cacheNames],
      delete: async name => { deletedCaches.push(name); return cacheNames.delete(name); },
    },
    resetMemory: () => { memoryResets++; },
    dispatchRequest: value => { dispatched.push(value); },
  };
  return { environment, localStorage, sessionStorage, indexedDB, cacheNames, deletedCaches, dispatched, get memoryResets() { return memoryResets; } };
}

test('reset removes all owned persistence, preserves unrelated data, and removes its marker last', async () => {
  const state = fixture();
  for (const key of ['lope.accounts.v1', 'lope.preferences.v2', 'lope.preferences.user.alex.v2', 'lope.assets.wallpapers.v1', 'lope.history.apps.v1', 'lope.session.documents.v1', 'lope.theme', 'lope.future-app']) {
    state.localStorage.setItem(key, 'private data');
  }
  state.localStorage.setItem('another-app', 'keep');
  state.sessionStorage.setItem('lope.account.session.v1', 'old-account');
  state.sessionStorage.setItem('lope.terminal.workspace.window', 'terminal-session');
  state.sessionStorage.setItem('another-app', 'keep');
  const progress: number[] = [];
  const resetMemory = state.environment.resetMemory;
  state.environment.resetMemory = () => {
    assert.ok(state.localStorage.getItem(RESET_STORAGE_KEY), 'marker survives until all cleanup succeeds');
    assert.equal(state.indexedDB.pending.size, 0);
    assert.deepEqual([...state.cacheNames], ['other-app', 'webllm/unrelated']);
    return resetMemory();
  };
  await createFactoryResetService(state.environment).perform(request, value => progress.push(value));
  assert.deepEqual(progress, [10, 30, 60, 85, 100]);
  assert.deepEqual([...state.localStorage.values], [['another-app', 'keep']]);
  assert.deepEqual([...state.sessionStorage.values], [['another-app', 'keep']]);
  assert.deepEqual([...state.indexedDB.names], ['other-app']);
  assert.equal(state.localStorage.removed.at(-1), RESET_STORAGE_KEY);
  assert.equal(state.memoryResets, 1);
});

test('reset preserves the remote workspace ownership fence while clearing local account data', async () => {
  const state = fixture();
  state.localStorage.setItem('lope.cloud.workspace-owner.v1', 'previous-account');
  state.localStorage.setItem('lope.cloud.owner.v1', 'previous-account');
  await createFactoryResetService(state.environment).perform(request, () => {});
  assert.equal(state.localStorage.getItem('lope.cloud.workspace-owner.v1'), 'previous-account');
  assert.equal(state.localStorage.getItem('lope.cloud.owner.v1'), null);
  assert.ok(state.indexedDB.deleted.includes('lope.drive.v1'));
  assert.ok(state.indexedDB.deleted.includes('lope.cloud.sync.v1'));
});

test('known databases are erased when database enumeration is unavailable', async () => {
  const state = fixture();
  state.environment.indexedDB = { deleteDatabase: state.indexedDB.deleteDatabase };
  await createFactoryResetService(state.environment).perform(request, () => {});
  assert.deepEqual(state.indexedDB.deleted.sort(), ['lope.writer.recovery.v1', 'lope.image-editor', 'lope.photo-library.v1', 'lope.photo-ai-models.v1', 'lope.drive.v1', 'lope.cloud.sync.v1'].sort());
});

test('concurrent render callers share one operation and each receives progress', async () => {
  const state = fixture(), service = createFactoryResetService(state.environment);
  const firstProgress: number[] = [], secondProgress: number[] = [];
  const first = service.perform(request, value => firstProgress.push(value));
  const second = service.perform(request, value => secondProgress.push(value));
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(state.memoryResets, 1);
  assert.equal(state.indexedDB.deleted.length, new Set(state.indexedDB.deleted).size, 'each database is deleted only once');
  assert.deepEqual(firstProgress, [10, 30, 60, 85, 100]);
  assert.deepEqual(secondProgress, [0, 10, 30, 60, 85, 100]);
});

test('blocked database failure keeps reset recoverable and Retry waits for the original deletion', async () => {
  const state = fixture();
  const blocked = 'lope.writer.recovery.v1';
  state.indexedDB.blocked.add(blocked);
  state.environment.databaseTimeoutMs = 15;
  const service = createFactoryResetService(state.environment), progress: number[] = [];
  await assert.rejects(service.perform(request, value => progress.push(value)), /Close other LopeOS tabs.*try again/);
  assert.ok(state.localStorage.getItem(RESET_STORAGE_KEY));
  assert.equal(state.memoryResets, 0);
  assert.equal(progress.includes(100), false);
  let finished = false;
  const retry = service.perform(request, () => {}).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(finished, false);
  assert.equal(state.indexedDB.deleted.filter(name => name === blocked).length, 1);
  state.indexedDB.complete(blocked);
  await retry;
  assert.equal(state.indexedDB.pending.size, 0, 'no abandoned delete can later erase newly created app data');
  assert.equal(state.localStorage.getItem(RESET_STORAGE_KEY), null);
  assert.equal(state.memoryResets, 1);
});

test('cache failure retains the marker and retries instead of reporting successful setup', async () => {
  const state = fixture();
  const erase = state.environment.caches!.delete;
  let fail = true;
  state.environment.caches!.delete = async name => {
    if (fail && name === 'webllm/model') throw new Error('Cache access failed');
    return erase(name);
  };
  const service = createFactoryResetService(state.environment);
  await assert.rejects(service.perform(request, () => {}), /Cache access failed/);
  assert.ok(state.localStorage.getItem(RESET_STORAGE_KEY));
  assert.equal(state.memoryResets, 0);
  fail = false;
  await service.perform(request, () => {});
  assert.equal(state.localStorage.getItem(RESET_STORAGE_KEY), null);
});

test('a completed reset in another tab only clears this tab, preserving newly created shared data', async () => {
  const state = fixture();
  state.localStorage.removeItem(RESET_STORAGE_KEY);
  state.localStorage.setItem('lope.accounts.v1', 'new account');
  state.sessionStorage.setItem('lope.account.session.v1', 'old account');
  const service = createFactoryResetService(state.environment);
  service.remember(request);
  assert.deepEqual(service.read(), request, 'the session mirror survives a late reload');
  const progress: number[] = [];
  await service.perform(request, value => progress.push(value));
  assert.equal(state.localStorage.getItem('lope.accounts.v1'), 'new account');
  assert.equal(state.sessionStorage.length, 0);
  assert.equal(state.indexedDB.deleted.length, 0);
  assert.equal(state.deletedCaches.length, 0);
  assert.equal(state.memoryResets, 1);
  assert.deepEqual(progress, [100]);
});

test('the pending request is checked after acquiring the cross-tab lock', async () => {
  const state = fixture();
  state.localStorage.setItem('lope.accounts.v1', 'old account');
  state.environment.withLock = async operation => {
    state.localStorage.removeItem(RESET_STORAGE_KEY);
    state.localStorage.setItem('lope.accounts.v1', 'new account created by first tab');
    await operation();
  };
  await createFactoryResetService(state.environment).perform(request, () => {});
  assert.equal(state.localStorage.getItem('lope.accounts.v1'), 'new account created by first tab');
  assert.equal(state.indexedDB.deleted.length, 0);
});

test('a request completed during asynchronous discovery cannot erase newly created shared data', async () => {
  const state = fixture();
  const keys = state.environment.caches!.keys;
  state.environment.caches!.keys = async () => {
    state.localStorage.removeItem(RESET_STORAGE_KEY);
    state.localStorage.setItem('lope.accounts.v1', 'new account created during discovery');
    return keys();
  };
  await createFactoryResetService(state.environment).perform(request, () => {});
  assert.equal(state.localStorage.getItem('lope.accounts.v1'), 'new account created during discovery');
  assert.equal(state.indexedDB.deleted.length, 0);
  assert.equal(state.deletedCaches.length, 0);
  assert.equal(state.memoryResets, 1);
});

test('browser reset requires cross-tab locks before accessing or writing storage', () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let storageAccessed = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { storageAccessed = true; throw new Error('Storage must not be accessed'); } } });
  try {
    assert.throws(() => requestFactoryReset(false), /up-to-date browser over HTTPS or localhost/);
    assert.equal(storageAccessed, false);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('request writes and verifies both markers before dispatch, without erasing account data', () => {
  const state = fixture();
  state.localStorage.removeItem(RESET_STORAGE_KEY);
  state.localStorage.setItem('lope.accounts.v1', 'old account');
  const service = createFactoryResetService(state.environment);
  service.request(true);
  const pending = service.read();
  assert.ok(pending);
  assert.equal(pending.reduceMotion, true);
  assert.equal(state.sessionStorage.getItem(RESET_STORAGE_KEY), JSON.stringify(pending));
  assert.equal(state.localStorage.getItem(RESET_STORAGE_KEY), JSON.stringify(pending));
  assert.deepEqual(state.dispatched, [pending]);
  assert.equal(state.localStorage.getItem('lope.accounts.v1'), 'old account');
  assert.equal(state.indexedDB.deleted.length, 0);
});

test('request rejects failed storage readback and removes its session mirror without dispatching', () => {
  const state = fixture();
  state.localStorage.removeItem(RESET_STORAGE_KEY);
  state.localStorage.setItem = () => {};
  const service = createFactoryResetService(state.environment);
  assert.throws(() => service.request(false), /browser storage is unavailable/);
  assert.equal(state.sessionStorage.getItem(RESET_STORAGE_KEY), null);
  assert.equal(state.dispatched.length, 0);
});

test('request parser rejects malformed or unsupported reset markers', () => {
  for (const value of [null, '', '{broken', '{}', JSON.stringify({ ...request, version: 2 }), JSON.stringify({ ...request, id: '' }), JSON.stringify({ ...request, requestedAt: null }), JSON.stringify({ ...request, reduceMotion: 'yes' })]) {
    assert.equal(parseFactoryResetRequest(value), null);
  }
  assert.deepEqual(parseFactoryResetRequest(JSON.stringify(request)), request);
});

test('resetForSetup clears cached account, system, and app preferences without writing erased data back', () => {
  const backend = new MemoryStorage(), preferences = new PreferenceStore(backend);
  preferences.set('theme', 'dark');
  preferences.set('soundVolume', 0.2);
  preferences.copyToUser('old-account');
  preferences.activateUser('old-account');
  preferences.set('writer.document.old-window', { path: '/Documents/private.docx' });
  preferences.set('personalWallpaper', { asset: 'data:private-image' });
  backend.values.clear();
  let notifications = 0;
  preferences.subscribe(() => { notifications++; });
  preferences.resetForSetup();
  assert.equal(preferences.getActiveUser(), null);
  assert.deepEqual(preferences.getSnapshot(), preferenceDefaults);
  assert.equal(preferences.get('writer.document.old-window', null), null);
  assert.equal(preferences.get('personalWallpaper', null), null);
  assert.deepEqual(preferences.getStatus(), { persistent: true, message: '' });
  assert.equal(notifications, 1);
  assert.equal(backend.length, 0);
  preferences.activateUser(null);
  assert.deepEqual(preferences.getSnapshot(), preferenceDefaults, 'erased system preferences cannot reappear on activation');
  assert.equal(new PreferenceStore().getStatus().persistent, false);
});
