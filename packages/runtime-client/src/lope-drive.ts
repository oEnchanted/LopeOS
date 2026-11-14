import type { FileEntry, FileService, WriteOptions } from '../../contracts/src/index.ts';

export const LOPE_DRIVE = '/LopeDrive';
export const DRIVE_DATABASE = 'lope.drive.v1';
export const MAX_DRIVE_FILE_BYTES = 64 * 1024 * 1024;
type RecordEntry = FileEntry & { data?: Blob; version: string };
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));
export function isLopeDrivePath(path: string) { return path === LOPE_DRIVE || path.startsWith(LOPE_DRIVE + '/'); }
export function drivePath(path: string) {
  if (!isLopeDrivePath(path) || path.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(path) || path.split('/').slice(1).some(part => !part || part === '.' || part === '..' || new TextEncoder().encode(part).length > 255)) throw failure('INVALID', 'Choose a valid LopeDrive path.');
  return path;
}
const root = (): RecordEntry => ({ path: LOPE_DRIVE, name: 'LopeDrive', type: 'directory', size: 0, modified: '2026-01-01T00:00:00.000Z', version: 'root' });
const publicEntry = ({ data: _data, ...entry }: RecordEntry): FileEntry & { version: string } => entry;

/** Durable offline files. Every mutation is a single IDB transaction across tabs. */
export function createLopeDriveService(databaseName = DRIVE_DATABASE) {
  const listeners = new Set<(path?: string) => void>();
  let channel: BroadcastChannel | undefined;
  const emit = (path?: string) => {
    listeners.forEach(listener => listener(path));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lope:files-changed', { detail: { path } }));
  };
  const watch = () => {
    if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(databaseName);
      channel.onmessage = event => emit(typeof event.data === 'string' ? event.data : undefined);
    }
  };
  const changed = (path: string) => { emit(path); channel?.postMessage(path); };
  async function open() {
    if (typeof indexedDB === 'undefined') throw failure('UNAVAILABLE', 'Allow browser storage to use LopeDrive.');
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'path' });
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(failure('UNAVAILABLE', 'Close other LopeOS tabs to open LopeDrive.'));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (entries: Map<string, RecordEntry>, store: IDBObjectStore) => T): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('entries', mode), store = tx.objectStore('entries');
        let result: T, cause: unknown;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(cause ?? tx.error ?? failure('STORAGE', 'LopeDrive could not save this change. Check available browser storage.'));
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const entries = new Map<string, RecordEntry>((request.result as RecordEntry[]).map(entry => [entry.path, entry]));
            entries.set(LOPE_DRIVE, root());
            result = operation(entries, store);
          } catch (error) { cause = error; tx.abort(); }
        };
      });
    } finally { db.close(); }
  }
  function get(entries: Map<string, RecordEntry>, path: string) {
    const entry = entries.get(drivePath(path));
    if (!entry) throw failure('NOT_FOUND', 'This LopeDrive item no longer exists.');
    return entry;
  }
  function writable(path: string) { drivePath(path); if (path === LOPE_DRIVE) throw failure('FORBIDDEN', 'The LopeDrive root cannot be changed.'); }
  function requireParent(entries: Map<string, RecordEntry>, path: string) {
    if (get(entries, parent(path)).type !== 'directory') throw failure('NOT_DIRECTORY', 'The destination is not a folder.');
  }
  async function writeBinary(path: string, data: Uint8Array, options: WriteOptions = {}) {
    options.assertCurrent?.();
    writable(path);
    if (data.byteLength > MAX_DRIVE_FILE_BYTES) throw failure('LIMIT', 'LopeDrive currently supports files up to 64 MiB each.');
    const entry = await transaction('readwrite', (entries, store) => {
      requireParent(entries, path);
      const existing = entries.get(path);
      if (existing?.type === 'directory' || options.createOnly && existing || options.version !== undefined && existing?.version !== options.version) throw failure('CONFLICT', 'This file changed or already exists. Save a separate copy.');
      const value: RecordEntry = { path, name: path.split('/').at(-1)!, type: 'file', size: data.byteLength, modified: new Date().toISOString(), version: crypto.randomUUID(), data: new Blob([new Uint8Array(data)]) };
      options.assertCurrent?.();
      store.put(value); return publicEntry(value);
    });
    changed(path); return entry;
  }
  async function readBinary(path: string) {
    const result = await transaction('readonly', entries => {
      const value = get(entries, path);
      if (value.type !== 'file') throw failure('IS_DIRECTORY', 'Choose a file.');
      return { data: value.data ?? new Blob(), version: value.version };
    });
    return { data: new Uint8Array(await result.data.arrayBuffer()), version: result.version };
  }
  async function transfer(path: string, destination: string, move: boolean) {
    writable(path); writable(destination);
    if (destination === path || destination.startsWith(path + '/')) throw failure('INVALID', 'A folder cannot be placed inside itself.');
    await transaction('readwrite', (entries, store) => {
      get(entries, path); requireParent(entries, destination);
      if (entries.has(destination)) throw failure('CONFLICT', 'An item already exists at the destination.');
      for (const entry of entries.values()) if (entry.path === path || entry.path.startsWith(path + '/')) {
        const next = destination + entry.path.slice(path.length);
        store.put({ ...entry, path: next, name: next.split('/').at(-1)!, modified: new Date().toISOString(), version: crypto.randomUUID() });
        if (move) store.delete(entry.path);
      }
    });
    changed(destination);
  }
  return {
    async list(path: string) { return transaction('readonly', entries => { if (get(entries, path).type !== 'directory') throw failure('NOT_DIRECTORY', 'Choose a folder.'); return [...entries.values()].filter(entry => parent(entry.path) === path).map(publicEntry); }); },
    async stat(path: string) { return transaction('readonly', entries => publicEntry(get(entries, path))); },
    readBinary, writeBinary,
    async read(path: string) { const result = await readBinary(path); let content: string; try { content = new TextDecoder('utf-8', { fatal: true }).decode(result.data); } catch { throw failure('BINARY', 'Open this file in an appropriate application.'); } return { content, version: result.version }; },
    async write(path: string, content: string, options?: string | WriteOptions) { const result = await writeBinary(path, new TextEncoder().encode(content), typeof options === 'string' ? { version: options } : options); return { content, version: result.version }; },
    async create(path: string, content: string) { const result = await writeBinary(path, new TextEncoder().encode(content), { createOnly: true }); return { content, version: result.version }; },
    async mkdir(path: string) {
      writable(path);
      await transaction('readwrite', (entries, store) => {
        requireParent(entries, path); if (entries.has(path)) throw failure('CONFLICT', 'This folder already exists.');
        store.put({ path, name: path.split('/').at(-1)!, type: 'directory', size: 0, modified: new Date().toISOString(), version: crypto.randomUUID() });
      }); changed(path);
    },
    rename: (path: string, destination: string) => transfer(path, destination, true),
    move: (path: string, destination: string) => transfer(path, destination, true),
    copy: (path: string, destination: string) => transfer(path, destination, false),
    async remove(path: string, options: { recursive?: boolean; version?: string } = { recursive: true }) {
      writable(path);
      await transaction('readwrite', (entries, store) => {
        const current = get(entries, path);
        if (options.version !== undefined && current.version !== options.version) throw failure('CONFLICT', 'This file changed before deletion. Your local changes were kept.');
        const children = [...entries.keys()].filter(key => key.startsWith(path + '/'));
        if (children.length && !options.recursive) throw failure('NOT_EMPTY', 'This folder is not empty.');
        for (const key of [path, ...children]) store.delete(key);
      }); changed(path);
    },
    subscribe(callback: (path?: string) => void) { watch(); listeners.add(callback); return () => { listeners.delete(callback); if (!listeners.size) { channel?.close(); channel = undefined; } }; },
  } satisfies FileService;
}
export const lopeDriveFiles = createLopeDriveService();
