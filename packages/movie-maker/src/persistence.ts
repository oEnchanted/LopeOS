import { referencedAssetIds, validateProject, type MovieProject } from './model.ts';

export interface StoredMovie { project: MovieProject; blobs: Map<string, Blob>; missing: string[] }
const DB_NAME = 'lope-movie-maker-v1';
const CURRENT = 'current';
const PORTABLE_LIMIT = 256 * 1024 * 1024;
let connection: Promise<IDBDatabase> | undefined;
// Serialize mutations so a slower earlier save cannot replace a newer project. A failed save does not poison the queue.
let writes: Promise<void> = Promise.resolve();
function enqueue(write: () => Promise<void>): Promise<void> { const result = writes.then(write); writes = result.catch(() => {}); return result; }
function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Local project storage is unavailable in this browser. Download a project or portable bundle to keep your work.'));
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects'); if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets'); };
    request.onerror = () => { connection = undefined; reject(storageError(request.error)); };
    request.onblocked = () => { connection = undefined; reject(new Error('Close another Movie Maker tab to finish opening local project storage.')); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
  });
}
function storageError(error: unknown): Error {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError') return new Error('Local storage is full. Your current edits remain open. Download a portable bundle, then free browser storage and try again.');
  return new Error(`The project could not be stored locally. Download a portable bundle to keep your work.${error instanceof Error ? ` ${error.message}` : ''}`);
}
function completed(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(storageError(transaction.error)); transaction.onabort = () => reject(storageError(transaction.error)); }); }
function requested<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(storageError(request.error)); }); }
/** One IndexedDB transaction commits media and its edit decisions together, or commits neither. */
export async function saveAutosave(project: MovieProject, blobs: Map<string, Blob> = new Map()): Promise<void> {
  const snapshot = validateProject(project), media = new Map(blobs);
  return enqueue(async () => {
    const db = await database(); const transaction = db.transaction(['projects', 'assets'], 'readwrite'); const done = completed(transaction);
    try { const store = transaction.objectStore('assets'); for (const [id, blob] of media) if (snapshot.assets[id]) store.put(blob, id); transaction.objectStore('projects').put({ project: snapshot, savedAt: Date.now() }, CURRENT); }
    catch (error) { transaction.abort(); await done.catch(() => {}); throw storageError(error); }
    await done;
  });
}
export async function putAssets(blobs: Map<string, Blob>): Promise<void> {
  const media = new Map(blobs);
  return enqueue(async () => { const db = await database(); const transaction = db.transaction('assets', 'readwrite'); const done = completed(transaction);
    try { for (const [id, blob] of media) transaction.objectStore('assets').put(blob, id); } catch (error) { transaction.abort(); await done.catch(() => {}); throw storageError(error); }
    await done;
  });
}
export async function loadAsset(id: string): Promise<Blob | undefined> { await writes; const db = await database(); const transaction = db.transaction('assets', 'readonly'); return requested(transaction.objectStore('assets').get(id)); }
async function readAssets(transaction: IDBTransaction, project: MovieProject): Promise<{ blobs: Map<string, Blob>; missing: string[] }> {
  const store = transaction.objectStore('assets'); const entries = await Promise.all(Object.keys(project.assets).map(async id => [id, await requested<Blob | undefined>(store.get(id))] as const));
  const blobs = new Map<string, Blob>(); const missing: string[] = []; for (const [id, blob] of entries) { if (blob instanceof Blob) blobs.set(id, blob); else missing.push(id); } return { blobs, missing };
}
export async function loadAssets(project: MovieProject): Promise<{ blobs: Map<string, Blob>; missing: string[] }> { await writes; const db = await database(); return readAssets(db.transaction('assets', 'readonly'), project); }
export async function loadAutosave(): Promise<StoredMovie | null> {
  await writes; const db = await database(); const transaction = db.transaction(['projects', 'assets'], 'readonly'); const record = await requested<{ project: unknown } | undefined>(transaction.objectStore('projects').get(CURRENT)); if (!record) return null;
  const project = validateProject(record.project); return { project, ...await readAssets(transaction, project) };
}
export async function clearAutosave(): Promise<void> { return enqueue(async () => { const db = await database(); const transaction = db.transaction('projects', 'readwrite'); const done = completed(transaction); transaction.objectStore('projects').delete(CURRENT); await done; }); }
/** Space check is advisory: the atomic transaction is the definitive quota check. */
export async function storageAvailable(requiredBytes: number): Promise<boolean> { if (!globalThis.navigator?.storage?.estimate) return true; const estimate = await navigator.storage.estimate(); return !estimate.quota || estimate.quota - (estimate.usage ?? 0) > requiredBytes; }
async function digest(bytes: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''); }
function base64(bytes: Uint8Array): string { const chunks: string[] = []; for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768))); return btoa(chunks.join('')); }
function decode64(encoded: string): Uint8Array<ArrayBuffer> { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('A portable media attachment is corrupt.'); const raw = atob(encoded); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; }
/** Self-contained LopeOS JSON bundle, never presented as .wlmp or as a rendered movie. */
export async function encodePortable(project: MovieProject, blobs: Map<string, Blob>): Promise<Blob> {
  const snapshot = validateProject(project); const needed = referencedAssetIds(snapshot); snapshot.assets = Object.fromEntries(Object.entries(snapshot.assets).filter(([id]) => needed.has(id))); const attachments: { id: string; mime: string; size: number; sha256: string; data: string }[] = []; let size = 0;
  for (const asset of Object.values(snapshot.assets)) { const blob = blobs.get(asset.id) ?? await loadAsset(asset.id); if (!blob) throw new Error(`“${asset.name}” is missing. Relink it before creating a portable bundle.`); size += blob.size; if (size > PORTABLE_LIMIT) throw new Error('Portable bundles currently support up to 256 MB of original media. Save the project and retain the original files for a larger movie.'); const bytes = new Uint8Array(await blob.arrayBuffer()); attachments.push({ id: asset.id, mime: blob.type || asset.mime, size: blob.size, sha256: await digest(bytes), data: base64(bytes) }); }
  return new Blob([JSON.stringify({ format: 'lope-movie-bundle', version: 1, project: snapshot, attachments })], { type: 'application/x-lope-movie-bundle+json' });
}
export async function decodePortable(input: Blob | string): Promise<StoredMovie> {
  if (typeof input !== 'string' && input.size > PORTABLE_LIMIT * 1.5) throw new Error('This portable bundle exceeds the 256 MB media limit.'); const json = typeof input === 'string' ? input : await input.text(); if (json.length > PORTABLE_LIMIT * 1.5) throw new Error('This portable bundle exceeds the 256 MB media limit.'); let data: Record<string, unknown>;
  try { data = JSON.parse(json); } catch { throw new Error('This portable bundle is not valid JSON.'); }
  if (!data || data.format !== 'lope-movie-bundle' || data.version !== 1 || !Array.isArray(data.attachments) || data.attachments.length > 5000) throw new Error('This is not a supported LopeOS portable movie bundle.');
  const project = validateProject(data.project); const blobs = new Map<string, Blob>(); let total = 0;
  for (const value of data.attachments) { if (!value || typeof value !== 'object') throw new Error('Invalid portable media attachment.'); const item = value as Record<string, unknown>; if (typeof item.id !== 'string' || !project.assets[item.id] || blobs.has(item.id) || typeof item.data !== 'string' || typeof item.sha256 !== 'string' || typeof item.mime !== 'string' || item.mime.length > 200 || typeof item.size !== 'number' || !Number.isInteger(item.size) || item.size < 0) throw new Error('Invalid portable media attachment.'); total += item.size; if (total > PORTABLE_LIMIT || item.data.length > Math.ceil(item.size / 3) * 4) throw new Error('Portable attachment exceeds its declared size or the bundle limit.'); const bytes = decode64(item.data); if (bytes.length !== item.size || await digest(bytes) !== item.sha256) throw new Error(`“${project.assets[item.id].name}” failed its integrity check. Obtain a fresh copy of this bundle.`); blobs.set(item.id, new Blob([bytes], { type: item.mime })); }
  const missing = Object.keys(project.assets).filter(id => !blobs.has(id)); if (missing.length) throw new Error('This portable bundle is incomplete. One or more referenced files are missing.'); return { project, blobs, missing: [] };
}
