import { DENOISE_PACKAGE } from './denoise-manifest.ts';
export type DenoiseFileId=(typeof DENOISE_PACKAGE.files)[number]['id'];
export type DenoiseInstallation={id:string;fingerprint:string;installedAt:string;totalBytes:number;files:Record<DenoiseFileId,Blob>};
export type DownloadProgress={file:string;received:number;total:number};
const DATABASE='lope.photo-ai-models.v1',STORE='packages';
const fingerprint=()=>DENOISE_PACKAGE.files.map(f=>f.sha256).join(':');
const mime=(id:DenoiseFileId)=>id==='model'?'application/octet-stream':id==='wasm'?'application/wasm':'text/javascript';
let opened:Promise<IDBDatabase>|undefined;
function database(){return opened??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opened=undefined;};resolve(r.result);};r.onerror=()=>{opened=undefined;reject(r.error||new Error('Local model storage is unavailable.'));};r.onblocked=()=>reject(new Error('Close other Lightroom tabs to update local model storage.'));});}
const value=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const complete=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=event=>reject(tx.error||(event.target as IDBRequest)?.error||new Error('Local model could not be saved.'));tx.onabort=()=>reject(tx.error||new Error('Local model save was cancelled.'));});
export async function installedDenoise():Promise<DenoiseInstallation|null>{const db=await database(),record=await value(db.transaction(STORE).objectStore(STORE).get(DENOISE_PACKAGE.id));if(!record||record.fingerprint!==fingerprint())return null;const files={} as Record<DenoiseFileId,Blob>;for(const file of DENOISE_PACKAGE.files){const stored=record.files?.[file.id],blob=stored instanceof ArrayBuffer?new Blob([stored],{type:mime(file.id)}):stored;if(!(blob instanceof Blob)||blob.size!==file.bytes)return null;files[file.id]=blob;}return {...record,files};}
export async function verifyDenoiseFile(blob:Blob,id:DenoiseFileId):Promise<ArrayBuffer>{
  const file=DENOISE_PACKAGE.files.find(f=>f.id===id)!;if(!(blob instanceof Blob)||blob.size!==file.bytes)throw new Error(`The local ${id} file has an invalid size. Remove and download the AI package again.`);
  const bytes=await blob.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==file.sha256)throw new Error(`The local ${id} file failed its integrity check. Remove and download the AI package again.`);return bytes;
}
export async function installDenoise(signal:AbortSignal,progress:(value:DownloadProgress)=>void):Promise<DenoiseInstallation>{
  const files={} as Record<DenoiseFileId,Blob>;let received=0;
  for(const file of DENOISE_PACKAGE.files){
    signal.throwIfAborted();const response=await fetch(file.path,{signal,cache:'no-cache',redirect:'error'});if(!response.ok||!response.body)throw new Error(`Could not download ${file.name} (${response.status}). No photos have been uploaded.`);
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>file.bytes)throw new Error(`Unexpected download size for ${file.name}.`);parts.push(part.value);received+=part.value.length;progress({file:file.name,received,total:DENOISE_PACKAGE.totalBytes});}}
    finally{reader.releaseLock();}
    const blob=new Blob(parts as BlobPart[],{type:mime(file.id)});await verifyDenoiseFile(blob,file.id);files[file.id]=blob;
  }
  signal.throwIfAborted();const record:DenoiseInstallation={id:DENOISE_PACKAGE.id,fingerprint:fingerprint(),installedAt:new Date().toISOString(),totalBytes:DENOISE_PACKAGE.totalBytes,files};
  // Byte buffers avoid WebKit's filesystem-backed Blob serialization failures.
  const storedFiles=Object.fromEntries(await Promise.all(DENOISE_PACKAGE.files.map(async f=>[f.id,await files[f.id].arrayBuffer()])));
  const db=await database();signal.throwIfAborted();const tx=db.transaction(STORE,'readwrite'),done=complete(tx);const abort=()=>{try{tx.abort();}catch{/* Already committed. */}};signal.addEventListener('abort',abort,{once:true});
  try{try{tx.objectStore(STORE).put({...record,files:storedFiles});}catch(cause){abort();await done.catch(()=>{});throw cause;}await done;}finally{signal.removeEventListener('abort',abort);}return record;
}
export async function removeDenoise(){const db=await database(),tx=db.transaction(STORE,'readwrite'),done=complete(tx);tx.objectStore(STORE).delete(DENOISE_PACKAGE.id);await done;}
