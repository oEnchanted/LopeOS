/** Keeps an unlocked vault available across reloads on this device.
 *
 * The vault master key is sealed with a per-device AES-GCM key that is generated
 * non-extractable, so the browser can use it but script cannot read its bytes. Both live
 * in IndexedDB, which is local browser storage: anyone with access to this browser profile
 * can unlock, just as they can already read the local copies of synced files. Sign-out,
 * device reset, account changes and an expired server session wipe the record. */
const DB = 'lope.cloud.device-key.v1', STORE = 'keys';
export const DEVICE_KEY_MS = 90 * 24 * 60 * 60 * 1000;
export interface DeviceKeyRecord { accountId: string; vaultId: string; key: CryptoKey; sealed: ArrayBuffer; expiresAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'accountId' });
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Account key storage is in use by another LopeOS tab.'));
  });
}
async function run<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), req = task(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result); tx.onabort = tx.onerror = () => reject(tx.error ?? req.error);
    });
  } finally { db.close(); }
}
export const deviceKeySupported = () => typeof indexedDB !== 'undefined' && typeof crypto?.subtle !== 'undefined';
export const newDeviceKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;

export async function readDeviceKey(accountId: string): Promise<DeviceKeyRecord | null> {
  if (!deviceKeySupported()) return null;
  const record = await run('readonly', store => store.get(accountId)) as DeviceKeyRecord | undefined;
  if (!record) return null;
  if (!(record.key instanceof CryptoKey) || !(record.sealed instanceof ArrayBuffer) || typeof record.vaultId !== 'string' || !(record.expiresAt > Date.now())) { await forgetDeviceKeys(); return null; }
  return record;
}
export async function writeDeviceKey(record: DeviceKeyRecord): Promise<void> {
  if (!deviceKeySupported()) return;
  // One account per device: never leave another account's key behind.
  await run('readwrite', store => { store.clear(); return store.put(record); });
}
export async function forgetDeviceKeys(): Promise<void> {
  if (!deviceKeySupported()) return;
  await run('readwrite', store => store.clear()).catch(() => {});
}
