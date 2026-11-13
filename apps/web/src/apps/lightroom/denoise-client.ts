import type { DenoiseProgress } from '../../../../../packages/photo-engine/src/denoise';
export class DenoiseClient{
  private worker?:Worker;private sequence=0;private resources=new Set<string>();private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;progress?:(value:DenoiseProgress)=>void}>();
  run<T>(action:'initialize'|'preview'|'denoise',payload:unknown,progress?:(value:DenoiseProgress)=>void):Promise<T>{
    if(!this.worker){const worker=new Worker(new URL('../../../../../packages/photo-engine/src/denoise-worker.ts',import.meta.url),{type:'module'});this.worker=worker;worker.onmessage=({data})=>{if(this.worker!==worker){if(data.resourceUrl)URL.revokeObjectURL(data.resourceUrl);return;}if(data.resourceUrl){this.resources.add(data.resourceUrl);return;}const request=this.pending.get(data.id);if(data.progress){request?.progress?.(data.progress);return;}this.pending.delete(data.id);data.error?request?.reject(new Error(data.error)):request?.resolve(data.result);};worker.onerror=event=>{if(this.worker===worker)this.cancel(event.message||'The local AI worker stopped.');};}
    return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject,progress});try{this.worker!.postMessage({id,action,payload});}catch(cause){this.pending.delete(id);reject(cause);}});
  }
  cancel(reason='AI denoise cancelled.'){this.worker?.terminate();this.worker=undefined;for(const resource of this.resources)URL.revokeObjectURL(resource);this.resources.clear();for(const p of this.pending.values())p.reject(new Error(reason));this.pending.clear();}
  dispose(){this.cancel('AI denoise dialog closed.');}
}
