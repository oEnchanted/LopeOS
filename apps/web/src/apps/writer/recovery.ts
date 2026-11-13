export interface RecoveryRecord {
  id: string; bytes: Uint8Array; path: string | null; version: string | null;
  title: string; savedAt: string; launchPath: string; preserveOriginal: boolean;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lope.writer.recovery.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readRecovery(id: string): Promise<RecoveryRecord | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(id);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
async function persistRecovery(record: RecoveryRecord | string): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    if (typeof record === 'string') tx.objectStore('documents').delete(record);
    else tx.objectStore('documents').put(record);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}

// Serialize recovery writes and deletes, so a late export cannot overtake a completed save.
let pending: Promise<void> = Promise.resolve();
export function writeRecovery(record: RecoveryRecord | string): Promise<void> {
  const next = pending.catch(() => {}).then(() => persistRecovery(record));
  pending = next; return next;
}
