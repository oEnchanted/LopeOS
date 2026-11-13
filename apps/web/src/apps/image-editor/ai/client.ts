import type {ImageDocument} from '../../../../../../packages/image-engine/src/model';
import {portraitScene} from '../../../../../../packages/image-engine/src/ai/portrait-scene';
export class PortraitEngine{
  private worker?:Worker;private reject?:((error:Error)=>void);
  run(document:ImageDocument,layerId:string|undefined,onStatus:(message:string)=>void){this.cancel();return new Promise<{mask:Uint8Array;ms:number;input:{width:number;height:number};backend:string}>((resolve,reject)=>{this.reject=reject;try{const {packet,transfer}=portraitScene(document,layerId),worker=new Worker(new URL('./portrait.worker.ts',import.meta.url),{type:'module'});this.worker=worker;worker.onmessage=({data})=>{if(data.status)onStatus(data.status);else if(data.error){this.reject=undefined;worker.terminate();this.worker=undefined;reject(new Error(data.error));}else{this.reject=undefined;worker.terminate();this.worker=undefined;resolve(data);}};worker.onerror=e=>{this.cancel(e.message||'The local engine could not start.');};worker.postMessage({scene:packet},transfer);}catch(error){this.cancel(error instanceof Error?error.message:String(error));}});}
  cancel(message='Local AI operation cancelled.'){this.worker?.terminate();this.worker=undefined;this.reject?.(new Error(message));this.reject=undefined;}
}
