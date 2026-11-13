export type RecoveryRecord = { id: string; content: string; path?: string; version?: string; savedRevision: string; updated: string };
let connection: Promise<IDBDatabase> | undefined;
export function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('lope.image-editor', 2);
    request.onupgradeneeded = () => {for(const name of ['recovery','sessions','documents','assets'])if(!request.result.objectStoreNames.contains(name)){const store=request.result.createObjectStore(name,{keyPath:'id'});if(name==='assets'||name==='documents')store.createIndex('windowId','windowId');}};
    request.onsuccess = () => {request.result.onversionchange=()=>{request.result.close();connection=undefined;};resolve(request.result);}; request.onerror = () => { connection = undefined; reject(request.error); };
  });
  return connection;
}
export async function recoveryRecords(): Promise<RecoveryRecord[]> {
  const db = await database(); return new Promise((resolve, reject) => { const request = db.transaction('recovery').objectStore('recovery').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function saveRecovery(record: RecoveryRecord) {
  const db = await database(); return new Promise<void>((resolve, reject) => { const transaction = db.transaction('recovery', 'readwrite'); transaction.objectStore('recovery').put(record); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
}
export async function removeRecovery(id: string) {
  const db = await database(); return new Promise<void>((resolve, reject) => { const transaction = db.transaction('recovery', 'readwrite'); transaction.objectStore('recovery').delete(id); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
}
