import { runtimeFileService } from '../../../../packages/runtime-client/src/index';
import { lopeDriveFiles } from '../../../../packages/runtime-client/src/lope-drive';
import { preferences } from '../../../../packages/sdk/src/preferences';
import { validatePreferenceImport } from '../../../../packages/contracts/src/preferences';
import { encodeLocalValue, decodeLocalValue, validateEncodedValue, validateLocalData, isBackupStorageKey, localDatabaseDefinitions } from '../backup/local-data';
import type { FileService } from '../../../../packages/contracts/src';
import type { SyncEntry } from './merge';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_SYNC_RECORD_BYTES = 64 * 1024 * 1024;
export interface LocalItem { entry: SyncEntry; read: () => Promise<Uint8Array> }
export interface Capture { items: Map<string, LocalItem>; unavailable: string[]; warnings: string[] }
const versionCache = new Map<string, { version: string; entry: SyncEntry }>();
const dbs = localDatabaseDefinitions;
const isSafeStorage = (key: string) => isBackupStorageKey(key) && key !== 'lope.accounts.v1' && !key.startsWith('lope.preferences.user.') && !key.startsWith('lope.setup.') && !key.startsWith('lope.migration.');
export async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function missing(error: unknown) { return !!error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND'; }
function safePath(path: string) {
  return path.startsWith('/') && path !== '/' && path.length < 1800 && !/[\u0000-\u001f\u007f\\]/.test(path) && path.slice(1).split('/').every(part => part && part !== '.' && part !== '..' && encoder.encode(part).length <= 255);
}
function parseFile(key: string): { service: FileService; path: string; directory: boolean } | null {
  const match = /^(drive|workspace):(file|directory):(\/.*)$/.exec(key);
  if (!match) return null;
  const [, scope, type, path] = match;
  if (!safePath(path) || scope === 'drive' && !path.startsWith('/LopeDrive/') || scope === 'workspace' && (path === '/LopeDrive' || path.startsWith('/LopeDrive/') || path === '/home/lope' || path.startsWith('/home/lope/'))) throw new Error('An account file path is invalid.');
  return { service: scope === 'drive' ? lopeDriveFiles : runtimeFileService, path, directory: type === 'directory' };
}
function parseDB(key: string): { name: string; store: string; id: string } | null {
  if (!key.startsWith('db:')) return null;
  let parts: unknown;
  try { parts = JSON.parse(key.slice(3)); } catch { throw new Error('An account record key is invalid.'); }
  if (!Array.isArray(parts) || parts.length !== 3 || parts.some(p => typeof p !== 'string') || !Object.hasOwn(dbs, parts[0]) || !Object.hasOwn(dbs[parts[0]].stores, parts[1]) || !parts[2]) throw new Error('The account contains an unsupported application record.');
  return { name: parts[0], store: parts[1], id: parts[2] };
}
export function validateLogicalKey(key: string): void {
  if (key.startsWith('storage:') && isSafeStorage(key.slice(8))) return;
  if (parseFile(key) || parseDB(key)) return;
  throw new Error('The account contains an unsupported data type. Update LopeOS before syncing.');
}
function request<T>(req: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function done(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Application data could not be saved.')); }); }
async function openDB(name: string, create = false): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let absent = false, settled = false;
    const req = create ? indexedDB.open(name, dbs[name].version) : indexedDB.open(name);
    req.onupgradeneeded = () => {
      if (!create) { absent = true; req.transaction!.abort(); return; }
      for (const [storeName, schema] of Object.entries(dbs[name].stores)) {
        const store = req.result.objectStoreNames.contains(storeName) ? req.transaction!.objectStore(storeName) : req.result.createObjectStore(storeName, schema.keyPath ? { keyPath: schema.keyPath } : undefined);
        if (schema.index && !store.indexNames.contains(schema.index)) store.createIndex(schema.index, schema.index);
      }
    };
    req.onsuccess = () => { if (settled) { req.result.close(); return; } settled = true; req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => absent ? resolve(null) : reject(req.error);
    req.onblocked = () => { settled = true; reject(new Error('Close older LopeOS tabs so account data can be opened.')); };
  });
}
async function readDB(name: string, store: string, id: string): Promise<Uint8Array | null> {
  const database = await openDB(name);
  if (!database) return null;
  try {
    if (!database.objectStoreNames.contains(store)) return null;
    const value = await request(database.transaction(store).objectStore(store).get(id));
    return value === undefined ? null : encoder.encode(JSON.stringify(await encodeLocalValue(value)));
  } finally { database.close(); }
}
function preferenceBytes() { return encoder.encode(JSON.stringify({ version: 2, preferences: preferences.getSnapshot() })); }
export async function readLogical(key: string): Promise<Uint8Array | null> {
  validateLogicalKey(key);
  if (key.startsWith('storage:')) {
    const name = key.slice(8);
    if (name === 'lope.preferences.v2') return preferenceBytes();
    const value = localStorage.getItem(name);
    return value === null ? null : encoder.encode(value);
  }
  const record = parseDB(key);
  if (record) return readDB(record.name, record.store, record.id);
  const file = parseFile(key)!;
  try {
    const stat = await file.service.stat(file.path);
    if ((stat.type === 'directory') !== file.directory) return null;
    return file.directory ? new Uint8Array() : (await file.service.readBinary!(file.path)).data;
  } catch (error) { if (missing(error)) return null; throw error; }
}
export async function captureData(progress: (message: string) => void, check: () => void, accountId?: string): Promise<Capture> {
  const items = new Map<string, LocalItem>(), unavailable: string[] = [], warnings: string[] = [];
  const add = async (key: string, bytes: Uint8Array, read: () => Promise<Uint8Array>, version?: string, modifiedAt?: string) => {
    check();
    if (bytes.byteLength > MAX_SYNC_RECORD_BYTES) { unavailable.push(key); warnings.push(`${key} exceeds the 64 MiB account transfer limit and has not synced.`); return; }
    items.set(key, { entry: { key, hash: await digest(bytes), size: bytes.byteLength, modifiedAt: modifiedAt && Number.isFinite(Date.parse(modifiedAt)) ? modifiedAt : new Date().toISOString() }, read });
    if (version) versionCache.set(key, { version, entry: items.get(key)!.entry });
  };
  progress('Checking settings and app preferences…');
  const storageKeys: string[] = ['lope.preferences.v2'];
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key !== 'lope.preferences.v2' && isSafeStorage(key)) storageKeys.push(key); }
  for (const name of storageKeys) {
    const key = 'storage:' + name, bytes = await readLogical(key);
    if (bytes) await add(key, bytes, async () => { const next = await readLogical(key); if (!next) throw new Error('Settings changed during upload; retrying shortly.'); return next; });
  }
  for (const name of Object.keys(dbs)) {
    check(); progress('Checking saved application data…');
    const prefix = 'db:' + JSON.stringify([name]).slice(0, -1) + ',';
    let database: IDBDatabase | null = null;
    try {
      database = await openDB(name);
      if (!database) continue;
      if (database.version > dbs[name].version || Array.from(database.objectStoreNames).some(s => !Object.hasOwn(dbs[name].stores, s))) throw new Error('Update LopeOS to sync newer application data.');
      for (const store of Array.from(database.objectStoreNames)) {
        const keys = await request(database.transaction(store).objectStore(store).getAllKeys());
        for (const id of keys) {
          check();
          if (typeof id !== 'string') throw new Error('An application record has an unsupported identifier.');
          const key = 'db:' + JSON.stringify([name, store, id]);
          try {
            const bytes = await readDB(name, store, id);
            if (bytes) await add(key, bytes, async () => { const next = await readDB(name, store, id); if (!next) throw new Error('Application data changed during upload; retrying shortly.'); return next; });
          } catch (error) {
            check(); unavailable.push(key);
            warnings.push(`${name}: a saved record is waiting to sync. ${error instanceof Error ? error.message : 'The record could not be read.'}`);
          }
        }
      }
    } catch (error) {
      check(); unavailable.push(prefix);
      for (const key of items.keys()) if (key.startsWith(prefix)) items.delete(key);
      warnings.push(`${name} is waiting to sync. ${error instanceof Error ? error.message : 'Application storage is unavailable.'}`);
    } finally { database?.close(); }
  }
  const scan = async (scope: 'drive' | 'workspace', service: FileService, root: string) => {
    const captured = new Set<string>(), folders = [root], seen = new Set<string>();
    try {
      for (let i = 0; i < folders.length; i++) {
        check(); progress('Checking ' + (scope === 'drive' ? 'LopeDrive' : 'workspace files') + '…');
        const children = await service.list(folders[i]);
        for (const child of children) {
          if (scope === 'workspace' && (child.path === '/LopeDrive' || child.path.startsWith('/LopeDrive/'))) continue;
          if (!safePath(child.path) || child.path.slice(0, child.path.lastIndexOf('/')) !== (folders[i] === '/' ? '' : folders[i]) || seen.has(child.path)) throw new Error('A workspace path could not be synced safely.');
          seen.add(child.path);
          if (seen.size > 40_000) throw new Error('This workspace contains too many entries to sync.');
          if (child.type !== 'directory' && child.type !== 'file') { unavailable.push(`${scope}:file:${child.path}`, `${scope}:directory:${child.path}`); warnings.push(`${child.path} is a symbolic link or special file and remains in the workspace.`); continue; }
          const key = `${scope}:${child.type}:${child.path}`;
          captured.add(key);
          if (child.type === 'directory') { folders.push(child.path); await add(key, new Uint8Array(), async () => new Uint8Array(), child.version, child.modified); }
          else {
            if (child.size > (scope === 'workspace' ? 8 * 1024 * 1024 : MAX_SYNC_RECORD_BYTES)) { unavailable.push(key); warnings.push(`${child.path} exceeds the ${scope === 'workspace' ? '8' : '64'} MiB file transfer limit and has not synced.`); continue; }
            const read = async () => (await service.readBinary!(child.path)).data;
            const cached = versionCache.get(key);
            if (child.version && cached?.version === child.version) items.set(key, { entry: cached.entry, read });
            else await add(key, await read(), read, child.version, child.modified);
          }
        }
      }
    } catch (error) {
      check();
      for (const key of captured) items.delete(key);
      unavailable.push(scope + ':');
      warnings.push((scope === 'workspace' ? 'Workspace files' : 'LopeDrive') + ' are waiting to sync: ' + (error instanceof Error ? error.message : 'Storage unavailable.'));
    }
  };
  await scan('drive', lopeDriveFiles, '/LopeDrive');
  // Runtime failures must not block browser preferences, drafts, or LopeDrive.
  try {
    const workspaceOwner = localStorage.getItem('lope.cloud.workspace-owner.v1');
    if (accountId && workspaceOwner && workspaceOwner !== accountId) {
      unavailable.push('workspace:'); warnings.push('This runtime workspace belongs to another account. Only this device’s LopeDrive, settings, and saved app data will sync. Use a separate browser profile for a different runtime workspace.');
      return { items, unavailable, warnings };
    }
    const health = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error('Workspace service unavailable.');
    check(); if (accountId && !workspaceOwner) localStorage.setItem('lope.cloud.workspace-owner.v1', accountId);
    await scan('workspace', runtimeFileService, '/');
  } catch { unavailable.push('workspace:'); warnings.push('Workspace service files are waiting for the runtime connection. LopeDrive, settings, and saved app data can still sync.'); }
  return { items, unavailable, warnings };
}
async function ensureParents(service: FileService, path: string, check: () => void) {
  const parts = path.split('/').slice(1, -1); let parent = '';
  for (const part of parts) {
    parent += '/' + part; check();
    try { const value = await service.stat(parent); if (value.type !== 'directory') throw new Error('A file occupies the required folder ' + parent); }
    catch (error) { if (!missing(error)) throw error; try { check(); await service.mkdir(parent); } catch (cause) { if ((await service.stat(parent)).type !== 'directory') throw cause; } }
  }
}
/** Applies only if this device still has exactly the value captured for this sync. */
export async function applyRecord(key: string, bytes: Uint8Array | null, expectedHash: string | undefined, check: () => void = () => {}): Promise<boolean> {
  const current = await readLogical(key); check();
  if ((current ? await digest(current) : undefined) !== expectedHash) return false;
  if (key.startsWith('storage:')) {
    const name = key.slice(8);
    // No await between the final comparison and this synchronous browser write.
    const latest = name === 'lope.preferences.v2' ? decoder.decode(preferenceBytes()) : localStorage.getItem(name);
    if (latest !== (current ? decoder.decode(current) : null)) return false;
    check();
    if (bytes) validateLocalData({ version: 1, storage: { [name]: decoder.decode(bytes) }, databases: [] });
    if (name === 'lope.preferences.v2') {
      if (bytes) preferences.apply(validatePreferenceImport(JSON.parse(decoder.decode(bytes))).values);
      else preferences.reset();
    } else {
      if (bytes) localStorage.setItem(name, decoder.decode(bytes)); else localStorage.removeItem(name);
      window.dispatchEvent(new StorageEvent('storage', { key: name, newValue: bytes ? decoder.decode(bytes) : null, storageArea: localStorage }));
      preferences.refresh();
    }
    return true;
  }
  const record = parseDB(key);
  if (record) {
    let value: unknown;
    if (bytes) { const encoded: unknown = JSON.parse(decoder.decode(bytes)); validateEncodedValue(encoded); value = decodeLocalValue(encoded); if (dbs[record.name].stores[record.store].keyPath === 'id' && (!value || typeof value !== 'object' || !('id' in value) || value.id !== record.id)) throw new Error('An application record identifier is invalid.'); }
    const database = await openDB(record.name, !!bytes);
    if (!database) return true;
    try {
      const tx = database.transaction(record.store, 'readwrite'), completion = done(tx), store = tx.objectStore(record.store);
      void completion.catch(() => {});
      let prepared = false, matches = false, failure: unknown;
      const first = store.get(record.id);
      first.onsuccess = () => {
        // Keep this readwrite transaction alive while Blob encoding/hash awaits.
        // Other application writers cannot change the record before our CAS.
        void (async () => {
          const raw = first.result === undefined ? null : encoder.encode(JSON.stringify(await encodeLocalValue(first.result)));
          matches = (raw ? await digest(raw) : undefined) === expectedHash;
        })().catch(error => { failure = error; }).finally(() => { prepared = true; });
        const pump = () => {
          const keepAlive = store.get(record.id);
          keepAlive.onsuccess = () => {
            if (!prepared) { pump(); return; }
            try {
              check(); if (failure) throw failure;
              if (!matches) return;
              if (!bytes) store.delete(record.id); else if (store.keyPath === null) store.put(value, record.id); else store.put(value);
            } catch (error) { failure = error; tx.abort(); }
          };
        };
        pump();
      };
      try { await completion; } catch (error) { throw failure || error; }
      if (!matches) return false;
    } finally { database.close(); }
    window.dispatchEvent(new CustomEvent('lope:account-data-updated', { detail: { database: record.name } }));
    return true;
  }
  const file = parseFile(key)!;
  if (!bytes) {
    if (current === null) return true;
    const latest = file.directory ? { data: new Uint8Array(), version: (await file.service.stat(file.path)).version } : await file.service.readBinary!(file.path);
    check(); if (await digest(latest.data) !== expectedHash) return false;
    check(); await file.service.remove(file.path, { recursive: false, ...(latest.version ? { version: latest.version } : {}) });
    return true;
  }
  await ensureParents(file.service, file.path, check); check();
  if (file.directory) { if (current === null) await file.service.mkdir(file.path); }
  else {
    let version: string | undefined;
    if (current !== null) {
      const latest = await file.service.readBinary!(file.path); check();
      if (await digest(latest.data) !== expectedHash) return false;
      version = latest.version;
    }
    check(); await file.service.writeBinary!(file.path, bytes, current === null ? { createOnly: true } : { version });
  }
  return true;
}
export function conflictKey(original: string, hash: string): string {
  const file = parseFile(original);
  const filename = file && !file.directory ? file.path.split('/').pop()! : 'settings-and-app-data.json';
  const safeName = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-100);
  // Stable name makes a retry idempotent; key hash prevents equal-content settings collisions.
  const identity = Array.from(original).reduce((hash, c) => Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
  return `drive:file:/LopeDrive/Conflicts/${identity}-${hash.slice(0, 12)}-${safeName}`;
}
