export type PreviewResult={width:number;height:number;pixels:Uint8ClampedArray;histogram:number[][];duration:number};
export class PhotoWorker {
  private worker?:Worker;private sequence=0;private waiting=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  run<T>(action:string,payload:unknown):Promise<T>{
    if(!this.worker){this.worker=new Worker(new URL('../../../../../packages/photo-engine/src/worker.ts',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>{const p=this.waiting.get(data.id);this.waiting.delete(data.id);data.error?p?.reject(new Error(data.error)):p?.resolve(data.result);};this.worker.onerror=e=>this.cancel(e.message||'The photo worker stopped.');}
    return new Promise<T>((resolve,reject)=>{const id=++this.sequence;this.waiting.set(id,{resolve,reject});try{this.worker!.postMessage({id,action,payload});}catch(cause){this.waiting.delete(id);reject(cause);}});
  }
  cancel(message='Operation cancelled.'){this.worker?.terminate();this.worker=undefined;for(const p of this.waiting.values())p.reject(new Error(message));this.waiting.clear();}
  dispose(){this.cancel('Lightroom closed.');}
}
