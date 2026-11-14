import { ACCOUNTS_STORAGE_KEY, validAccount } from '../../../../packages/sdk/src/accounts.ts';
import { preferenceSchema, validatePreferenceImport } from '../../../../packages/contracts/src/preferences.ts';
import { PROFILE_STORAGE_KEY, isProfileData } from '../../../../packages/contracts/src/profile.ts';

/** Portable JSON representation; every non-primitive is tagged to avoid collisions with app data. */
export type EncodedValue = null | boolean | string | number
  | { type: 'undefined' }
  | { type: 'array'; value: EncodedValue[] }
  | { type: 'object'; value: [string, EncodedValue][] }
  | { type: 'date' | 'bigint'; value: string }
  | { type: 'binary'; kind: string; data: string; mime?: string; name?: string; modified?: number };
export interface LocalDatabaseBackup {
  name: string;
  version: number;
  stores: { name: string; records: { key: EncodedValue; value: EncodedValue }[] }[];
}
export interface LocalBackupData {
  version: 1;
  storage: Record<string, string>;
  databases: LocalDatabaseBackup[];
}

type StoreDefinition = { keyPath: 'id' | null; index?: string };
type DatabaseDefinition = { version: number; stores: Record<string, StoreDefinition> };
const databases: Record<string, DatabaseDefinition> = {
  'lope.photo-library.v1': { version: 1, stores: { assets: { keyPath: 'id', index: 'hash' }, originals: { keyPath: null }, albums: { keyPath: 'id' }, jobs: { keyPath: 'id' } } },
  'lope.writer.recovery.v1': { version: 1, stores: { documents: { keyPath: 'id' } } },
  'lope.image-editor': { version: 2, stores: { recovery: { keyPath: 'id' }, sessions: { keyPath: 'id' }, documents: { keyPath: 'id', index: 'windowId' }, assets: { keyPath: 'id', index: 'windowId' } } },
};
/** Shared schema used by automatic account sync as well as legacy backup readers. */
export const localDatabaseDefinitions = databases;
const storageKeys = new Set([
  PROFILE_STORAGE_KEY,
  ACCOUNTS_STORAGE_KEY, 'lope.preferences.v2', 'lope.preferences.apps.v1', 'lope.history.apps.v1',
  'lope.session.documents.v1', 'lope.assets.wallpapers.v1', 'lope.session.layout.v1', 'lope.layout.v1',
  'lope.history.search.v1', 'lope.history.notifications.v1', 'lope.history.diagnostics.v1', 'lope.history.recentApps.v1',
  'lope.migration.perfecthue.v1', 'lope.migration.photo-studio.v1', 'lope.image-ai.endpoint',
  'lope.personalWallpaper', 'lope.reducedTransparency',
  ...Object.keys(preferenceSchema).map(key => 'lope.' + key),
]);
const secretKey = /token|password|secret|credential|authorization|api.?key|access.?key|private.?key|(^|[._-])auth([._-]|$)/i;
const unsafeKey = (key: string) => ['__proto__', 'constructor', 'prototype'].includes(key);
export function isBackupStorageKey(key: string): boolean {
  if (storageKeys.has(key)) return true;
  if (/^lope\.preferences\.user\.[a-zA-Z0-9%_-]{1,512}\.v2$/.test(key)) return true;
  // Preferences predating the namespaced store remain readable by PreferenceStore.
  return /^lope\.(browser|calculator|editor|writer|image-editor|photo|spotlight|setup)\.[a-z0-9._-]{1,160}$/i.test(key) && !secretKey.test(key);
}
const invalid = (detail: string): never => { throw new Error('Invalid LopeOS backup: ' + detail); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const typedArrays = {
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
};
const binaryKinds = new Set(['ArrayBuffer', 'DataView', 'Blob', 'File', ...Object.keys(typedArrays)]);

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(''));
}
function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(data), bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export async function encodeLocalValue(value: unknown, depth = 0): Promise<EncodedValue> {
  if (depth > 100) return invalid('stored data is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) return invalid('non-finite stored number.'); return value; }
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value instanceof Blob) {
    const file = typeof File !== 'undefined' && value instanceof File;
    return { type: 'binary', kind: file ? 'File' : 'Blob', data: toBase64(new Uint8Array(await value.arrayBuffer())), mime: value.type, ...(file ? { name: value.name, modified: value.lastModified } : {}) };
  }
  if (value instanceof ArrayBuffer) return { type: 'binary', kind: 'ArrayBuffer', data: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { type: 'binary', kind: value.constructor.name, data: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return { type: 'array', value: await Promise.all(value.map(entry => encodeLocalValue(entry, depth + 1))) };
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const entries = Object.entries(value);
    if (entries.some(([key]) => unsafeKey(key))) return invalid('unsafe object property.');
    return { type: 'object', value: await Promise.all(entries.map(async ([key, entry]): Promise<[string, EncodedValue]> => [key, await encodeLocalValue(entry, depth + 1)])) };
  }
  return invalid('unsupported local data type.');
}

/** Validates without decoding large blobs, so review cannot allocate their binary payload twice. */
export function validateEncodedValue(value: unknown, depth = 0): asserts value is EncodedValue {
  if (depth > 100) invalid('stored data is nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!object(value)) return invalid('invalid encoded value.');
  switch (value.type) {
    case 'undefined': if (!exactKeys(value, ['type'])) invalid('invalid undefined value.'); return;
    case 'bigint':
    case 'date':
      if (!exactKeys(value, ['type', 'value']) || typeof value.value !== 'string' || (value.type === 'date' ? !Number.isFinite(Date.parse(value.value)) : !/^-?\d+$/.test(value.value))) invalid('invalid ' + value.type + ' value.');
      return;
    case 'array':
      if (!exactKeys(value, ['type', 'value']) || !Array.isArray(value.value)) return invalid('invalid array.');
      value.value.forEach(entry => validateEncodedValue(entry, depth + 1)); return;
    case 'object': {
      if (!exactKeys(value, ['type', 'value']) || !Array.isArray(value.value)) return invalid('invalid object.');
      const keys = new Set<string>();
      for (const entry of value.value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || unsafeKey(entry[0]) || keys.has(entry[0])) return invalid('invalid or duplicate object property.');
        keys.add(entry[0]); validateEncodedValue(entry[1], depth + 1);
      }
      return;
    }
    case 'binary': {
      if (!exactKeys(value, ['type', 'kind', 'data', 'mime', 'name', 'modified']) || typeof value.kind !== 'string' || !binaryKinds.has(value.kind) || typeof value.data !== 'string' || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) return invalid('invalid binary data.');
      if (value.mime !== undefined && typeof value.mime !== 'string') invalid('invalid binary media type.');
      if (value.kind === 'File' && (typeof value.name !== 'string' || typeof value.modified !== 'number' || !Number.isFinite(value.modified))) invalid('invalid file metadata.');
      if (value.data.endsWith('==') && !/[AQgw]==$/.test(value.data) || value.data.endsWith('=') && !value.data.endsWith('==') && !/[AEIMQUYcgkosw048]=$/.test(value.data)) invalid('noncanonical binary padding.');
      const byteLength = value.data.length / 4 * 3 - (value.data.endsWith('==') ? 2 : value.data.endsWith('=') ? 1 : 0);
      const constructor = Object.hasOwn(typedArrays, value.kind) ? typedArrays[value.kind as keyof typeof typedArrays] : undefined;
      if (constructor && byteLength % constructor.BYTES_PER_ELEMENT !== 0) invalid('invalid typed array length.');
      return;
    }
    default: return invalid('unknown encoded value type.');
  }
}

export function decodeLocalValue(value: EncodedValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  switch (value.type) {
    case 'undefined': return undefined;
    case 'date': return new Date(value.value);
    case 'bigint': return BigInt(value.value);
    case 'array': return value.value.map(decodeLocalValue);
    case 'object': return Object.fromEntries(value.value.map(([key, entry]) => [key, decodeLocalValue(entry)]));
    case 'binary': {
      const bytes = fromBase64(value.data);
      if (value.kind === 'ArrayBuffer') return bytes.buffer;
      if (value.kind === 'DataView') return new DataView(bytes.buffer);
      if (value.kind === 'Blob') return new Blob([bytes], { type: value.mime });
      if (value.kind === 'File') return new File([bytes], value.name!, { type: value.mime, lastModified: value.modified });
      const constructor = typedArrays[value.kind as keyof typeof typedArrays];
      return new constructor(bytes.buffer);
    }
  }
}

function validateStorage(key: string, value: unknown): void {
  if (!isBackupStorageKey(key) || typeof value !== 'string') return invalid('unsupported browser storage entry: ' + key);
  if (key === PROFILE_STORAGE_KEY) {
    let profile: unknown; try { profile = JSON.parse(value); } catch { return invalid('unreadable account profile.'); }
    if (!isProfileData(profile)) return invalid('invalid account profile picture.');
  } else if (key === ACCOUNTS_STORAGE_KEY) {
    let document: unknown; try { document = JSON.parse(value); } catch { return invalid('unreadable accounts.'); }
    if (!object(document) || document.version !== 1 || !Array.isArray(document.accounts) || !document.accounts.every(validAccount)) return invalid('invalid user accounts.');
    if (new Set(document.accounts.map(account => account.id)).size !== document.accounts.length || new Set(document.accounts.map(account => account.accountName)).size !== document.accounts.length) invalid('duplicate user accounts.');
  } else if (key === 'lope.preferences.v2' || key.startsWith('lope.preferences.user.')) {
    try { validatePreferenceImport(JSON.parse(value)); } catch { invalid('invalid preferences in ' + key + '.'); }
  } else if (['lope.preferences.apps.v1', 'lope.history.apps.v1', 'lope.session.documents.v1', 'lope.assets.wallpapers.v1'].includes(key)) {
    let document: unknown; try { document = JSON.parse(value); } catch { return invalid('unreadable app data.'); }
    if (!object(document) || Object.keys(document).some(unsafeKey)) invalid('invalid app data.');
  } else if (key === 'lope.session.layout.v1' || key === 'lope.layout.v1' || key.startsWith('lope.history.')) {
    let document: unknown; try { document = JSON.parse(value); } catch { return invalid('unreadable layout or history.'); }
    if (!Array.isArray(document)) invalid('invalid layout or history.');
  }
}

export function validateLocalData(input: unknown): LocalBackupData {
  if (!object(input) || !exactKeys(input, ['version', 'storage', 'databases']) || input.version !== 1 || !object(input.storage) || !Array.isArray(input.databases)) return invalid('unsupported local data format.');
  for (const [key, value] of Object.entries(input.storage)) validateStorage(key, value);
  const seen = new Set<string>();
  for (const database of input.databases) {
    if (!object(database) || !exactKeys(database, ['name', 'version', 'stores']) || typeof database.name !== 'string' || !Object.hasOwn(databases, database.name) || seen.has(database.name) || !Array.isArray(database.stores)) return invalid('unsupported or duplicate database.');
    seen.add(database.name);
    const definition = databases[database.name];
    if (typeof database.version !== 'number' || !Number.isInteger(database.version) || database.version < 1 || database.version > definition.version) return invalid('unsupported database version.');
    const storeNames = new Set<string>();
    for (const store of database.stores) {
      if (!object(store) || !exactKeys(store, ['name', 'records']) || typeof store.name !== 'string' || !Object.hasOwn(definition.stores, store.name) || storeNames.has(store.name) || !Array.isArray(store.records)) return invalid('unsupported or duplicate database store.');
      storeNames.add(store.name);
      const keys = new Set<string>();
      for (const record of store.records) {
        if (!object(record) || !exactKeys(record, ['key', 'value']) || typeof record.key !== 'string' || !record.key || keys.has(record.key)) return invalid('invalid or duplicate database record key.');
        keys.add(record.key); validateEncodedValue(record.value);
        if (definition.stores[store.name].keyPath === 'id') {
          if (!object(record.value) || record.value.type !== 'object' || !Array.isArray(record.value.value) || !record.value.value.some(entry => Array.isArray(entry) && entry[0] === 'id' && entry[1] === record.key)) invalid('database record ID does not match its key.');
        }
      }
    }
    const required = database.name === 'lope.image-editor' && database.version === 1 ? ['recovery'] : Object.keys(definition.stores);
    if (required.some(name => !storeNames.has(name))) invalid('missing database store.');
  }
  return input as unknown as LocalBackupData;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('Browser data could not be read.')); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Browser storage could not be updated. Check available storage space.'));
  });
}
function openDatabase(name: string, create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let missing = false, settled = false;
    const definition = databases[name], request = create ? indexedDB.open(name, definition.version) : indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (!create || settled) { missing = true; request.transaction!.abort(); return; }
      const database = request.result;
      for (const [storeName, storeDefinition] of Object.entries(definition.stores)) {
        const store = database.objectStoreNames.contains(storeName) ? request.transaction!.objectStore(storeName) : database.createObjectStore(storeName, storeDefinition.keyPath ? { keyPath: storeDefinition.keyPath } : undefined);
        if (storeDefinition.index && !store.indexNames.contains(storeDefinition.index)) store.createIndex(storeDefinition.index, storeDefinition.index);
      }
    };
    request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; resolve(request.result); };
    request.onerror = () => { if (settled) return; settled = true; if (missing) resolve(null); else reject(request.error || new Error('Browser data storage is unavailable.')); };
    request.onblocked = () => { settled = true; reject(new Error('Close other LopeOS tabs and try importing again.')); };
  });
}

function captureStorage(): Record<string, string> {
  const storage: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && isBackupStorageKey(key)) { const value = localStorage.getItem(key); if (value !== null) storage[key] = value; }
  }
  return storage;
}
export async function captureLocalData(): Promise<LocalBackupData> {
  const storage = captureStorage(), captured: LocalDatabaseBackup[] = [];
  if (!globalThis.indexedDB) throw new Error('Browser database storage is unavailable; a complete backup cannot be created.');
  for (const name of Object.keys(databases)) {
    const database = await openDatabase(name, false);
    if (!database) continue;
    try {
      const names = Array.from(database.objectStoreNames), transaction = database.transaction(names, 'readonly'), done = transactionDone(transaction);
      // A request can fail before the transaction's abort event; handle both promises.
      void done.catch(() => {});
      const raw = await Promise.all(names.map(async storeName => {
        const store = transaction.objectStore(storeName);
        const [keys, values] = await Promise.all([requestValue(store.getAllKeys()), requestValue(store.getAll())]);
        return { name: storeName, keys, values };
      }));
      await done;
      const stores = await Promise.all(raw.map(async store => ({ name: store.name, records: await Promise.all(store.values.map(async (value, index) => ({ key: await encodeLocalValue(store.keys[index]), value: await encodeLocalValue(value) }))) })));
      captured.push({ name, version: database.version, stores });
    } finally { database.close(); }
  }
  return validateLocalData({ version: 1, storage, databases: captured });
}

async function writeDatabase(name: string, snapshot?: LocalDatabaseBackup): Promise<void> {
  const database = await openDatabase(name, !!snapshot);
  if (!database) return;
  try {
    const names = Array.from(database.objectStoreNames);
    if (names.some(name => !Object.hasOwn(databases[database.name].stores, name))) throw new Error('This browser has a newer database schema. Import with the matching LopeOS version.');
    const transaction = database.transaction(names, 'readwrite'), done = transactionDone(transaction);
    try {
      for (const name of names) transaction.objectStore(name).clear();
      for (const store of snapshot?.stores ?? []) for (const record of store.records) {
        const destination = transaction.objectStore(store.name), value = decodeLocalValue(record.value);
        if (destination.keyPath === null) destination.put(value, record.key as IDBValidKey);
        else destination.put(value);
      }
    } catch (error) { transaction.abort(); await done.catch(() => {}); throw error; }
    await done;
  } finally { database.close(); }
}
function writeStorage(storage: Record<string, string>): void {
  const keys = Object.keys(captureStorage());
  for (const key of keys) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
}

/** Caller must stop application writes before restoring, then reload after success. */
export async function restoreLocalData(input: LocalBackupData): Promise<void> {
  const data = validateLocalData(input), previous = await captureLocalData();
  const changed: string[] = [];
  let storageChanged = false;
  try {
    // Transactions are atomic within each database; retain every earlier database for rollback.
    for (const name of Object.keys(databases)) {
      changed.push(name);
      await writeDatabase(name, data.databases.find(database => database.name === name));
    }
    storageChanged = true;
    writeStorage(data.storage);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const name of changed.reverse()) try { await writeDatabase(name, previous.databases.find(database => database.name === name)); } catch (cause) { rollbackErrors.push(cause); }
    if (storageChanged) try { writeStorage(previous.storage); } catch (cause) { rollbackErrors.push(cause); }
    if (rollbackErrors.length) throw new Error('Import failed, and some previous browser data could not be restored. Keep both backup files and free browser storage before trying again.', { cause: error });
    throw new Error('Import failed. Previous browser data has been restored. ' + (error instanceof Error ? error.message : String(error)), { cause: error });
  }
}

export function summarizeLocalData(data: LocalBackupData): { accounts: number; settings: number; records: number } {
  const accounts = data.storage[ACCOUNTS_STORAGE_KEY];
  return { accounts: accounts ? JSON.parse(accounts).accounts.length : 0, settings: Object.keys(data.storage).length, records: data.databases.reduce((count, database) => count + database.stores.reduce((count, store) => count + store.records.length, 0), 0) };
}
