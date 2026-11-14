import type { ExportProgress } from '../../../../../packages/video-engine/src/export.ts';
/** Failed jobs reject; the next request gets a fresh worker and storage scope. */
export class VideoWorker {
  private worker?:Worker;
  private next=0;
  private closed=false;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;progress?:(p:ExportProgress)=>void}>();
  constructor(private readonly scope:string){}
  private start(){
    const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    this.worker=worker;
    worker.onmessage=e=>{
      const {id,result,error,progress}=e.data,p=this.pending.get(id);
      if(!p){result?.bitmap?.close();return;}
      if(progress){p.progress?.(progress);return;}
      this.pending.delete(id);
      if(error)p.reject(new Error(error));else p.resolve(result);
    };
    worker.onerror=e=>{
      e.preventDefault();worker.terminate();this.worker=undefined;
      for(const p of this.pending.values())p.reject(new Error(e.message||'Media worker stopped. Retry the operation.'));
      this.pending.clear();
    };
    // The worker serializes messages, so storage scope precedes every job.
    worker.postMessage({id:0,type:'scope',data:this.scope});
  }
  call<T=any>(type:string,data?:unknown,progress?:(p:ExportProgress)=>void):Promise<T>{
    if(this.closed)return Promise.reject(new Error('Media operation closed.'));
    if(!this.worker)this.start();
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,progress});
      try{this.worker!.postMessage({id,type,data});}catch(e){this.pending.delete(id);reject(e);}
    });
  }
  cancel(){this.worker?.postMessage({type:'cancel'});}
  close(){this.closed=true;this.worker?.terminate();this.worker=undefined;for(const p of this.pending.values())p.reject(new Error('Media operation closed.'));this.pending.clear();}
}
