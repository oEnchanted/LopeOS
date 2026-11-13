import {AI_ASSETS,AI_CACHE,AI_DOWNLOAD_BYTES,assetKey} from './catalog.ts';
export type DownloadProgress={loaded:number;total:number;file:string;networkReceived?:number};
export async function localAIInstalled(){if(!globalThis.caches)return false;const cache=await caches.open(AI_CACHE);const entries=await Promise.all(AI_ASSETS.map(asset=>cache.match(assetKey(asset.id))));return entries.every((entry,i)=>entry?.headers.get('x-lope-sha256')===AI_ASSETS[i].sha256);}
export async function verifyAsset(data:ArrayBuffer,asset:typeof AI_ASSETS[number]){if(data.byteLength!==asset.bytes)throw new Error(`Incomplete download: ${asset.file}. Try again.`);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256)throw new Error(`Integrity check failed for ${asset.file}. The file was not installed.`);}
export async function installLocalAI(signal:AbortSignal,onProgress:(progress:DownloadProgress)=>void){
  if(!globalThis.caches||!crypto.subtle)throw new Error('Local AI requires HTTPS or localhost and browser storage.');
  const cache=await caches.open(AI_CACHE);let loaded=0,networkReceived=0;
  for(const asset of AI_ASSETS){signal.throwIfAborted();const existing=await cache.match(assetKey(asset.id));if(existing?.headers.get('x-lope-sha256')===asset.sha256){loaded+=asset.bytes;onProgress({loaded,total:AI_DOWNLOAD_BYTES,file:asset.file,networkReceived});continue;}
    const response=await fetch(asset.url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok||!response.body)throw new Error(`Download failed (${response.status}): ${asset.file}`);const reader=response.body.getReader(),chunks:Uint8Array[]=[];let received=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;networkReceived+=value.byteLength;if(received>asset.bytes)throw new Error(`Unexpected download size for ${asset.file}.`);chunks.push(value);onProgress({loaded:loaded+received,total:AI_DOWNLOAD_BYTES,file:asset.file,networkReceived});}}finally{reader.releaseLock();}
    const data=new Uint8Array(received);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}await verifyAsset(data.buffer,asset);signal.throwIfAborted();
    await cache.put(assetKey(asset.id),new Response(data,{headers:{'Content-Type':asset.id==='wasm'?'application/wasm':asset.id==='model'?'application/octet-stream':'text/javascript','x-lope-sha256':asset.sha256}}));loaded+=received;
  }
}
export async function removeLocalAI(){await caches.delete(AI_CACHE);}
export async function cachedAsset(id:string){const response=await(await caches.open(AI_CACHE)).match(assetKey(id));if(!response)throw new Error('Download the local portrait engine before using it.');return response;}
