import { History, uid, type BrushSettings, type ImageDocument, type Layer, type Point } from '../../../../../packages/image-engine/src';
import type { ToolId, ToolOptions } from './tool-model';
import { database } from './recovery';

export type EditorSession={history:History;path?:string;version?:string;external?:boolean;zoom:number;pan:Point;viewInitialized?:boolean;lastSelection?:{width:number;height:number;coverage:Uint8Array}};
export type PendingType={documentId:string;layerId?:string;point:Point;text:NonNullable<Layer['text']>};
export type EditorState={sessions:EditorSession[];activeId:string;tool:ToolId;brush:BrushSettings;foreground:string;background:string;options:ToolOptions;typeDefaults:NonNullable<Layer['text']>;pendingType?:PendingType};
type Asset={id:string;windowId:string;data:Uint8Array|Uint8ClampedArray};
type DocumentRecord={id:string;windowId:string;history:unknown};
type Manifest={id:string;schema:2;updated:string;state:Omit<EditorState,'sessions'>;sessions:(Omit<EditorSession,'history'>&{id:string})[]};
const residents:Map<string,EditorState>=(globalThis as any).__lopeImageSessions ||= new Map();
export const residentSession=(windowId:string)=>residents.get(windowId);
const journals:Map<string,SessionJournal>=(globalThis as any).__lopeImageJournals ||= new Map();
export function sessionJournal(windowId:string){let journal=journals.get(windowId);if(!journal){journal=new SessionJournal(windowId);journals.set(windowId,journal);}return journal;}
const result=<T>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});

/** Persists binary assets once; moving/zooming changes only the small session manifest. */
export class SessionJournal{
  readonly windowId:string;
  private ids=new WeakMap<object,string>();
  private assets=new Set<string>();
  private documents=new Map<string,{version:number;record:DocumentRecord;assets:Set<string>}>();
  private latest?:EditorState;
  private timer?:ReturnType<typeof setTimeout>;
  private flight:Promise<void>=Promise.resolve();
  private closed=false;
  private suspended=false;
  onError?:(message:string)=>void;
  constructor(windowId:string){this.windowId=windowId;}
  async load():Promise<EditorState|undefined>{
    const cached=residents.get(this.windowId);if(cached)return cached;
    const db=await database();const tx=db.transaction(['sessions','documents','assets'],'readonly');
    const [manifest,records,assets]=await Promise.all([result(tx.objectStore('sessions').get(this.windowId)) as Promise<Manifest|undefined>,result(tx.objectStore('documents').index('windowId').getAll(this.windowId)) as Promise<DocumentRecord[]>,result(tx.objectStore('assets').index('windowId').getAll(this.windowId)) as Promise<Asset[]>]);
    if(!manifest||manifest.schema!==2)return undefined;
    const binaries=new Map(assets.map(asset=>{this.assets.add(asset.id);this.ids.set(asset.data,asset.id);return [asset.id,asset.data];}));
    const seen=new WeakMap<object,any>();
    const decode=(value:any):any=>{
      if(!value||typeof value!=='object')return value;if(value.$asset){const data=binaries.get(value.$asset);if(!data)throw new Error('A saved image tile is missing.');return data;}
      if(seen.has(value))return seen.get(value);const out:any=Array.isArray(value)?[]:{};seen.set(value,out);for(const [key,child]of Object.entries(value))out[key]=decode(child);return out;
    };
    const byId=new Map(records.map(record=>[record.id,record]));
    const sessions=manifest.sessions.map(tab=>{const record=byId.get(`${this.windowId}/${tab.id}`);if(!record)throw new Error('An open image could not be restored.');const history=History.restore(decode(record.history));const {id,...rest}=tab;return {...rest,history};});
    const state={...manifest.state,sessions};residents.set(this.windowId,state);return state;
  }
  schedule(state:EditorState){
    if(this.closed)return;residents.set(this.windowId,state);this.latest=state;
    if(this.suspended)return;
    if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(error=>this.onError?.(error instanceof Error?error.message:'Session could not be saved.'));},250);
  }
  flush():Promise<void>{
    if(this.timer){clearTimeout(this.timer);this.timer=undefined;}
    this.flight=this.flight.catch(()=>{}).then(async()=>{const state=this.latest;if(!state||this.closed||this.suspended)return;this.latest=undefined;try{await this.write(state);}catch(error){this.latest ||= state;throw error;}});return this.flight;
  }
  suspend(){this.suspended=true;}
  private async write(state:EditorState){
    const memo=new WeakMap<object,any>();const newAssetIds=new Set<string>();const staged=new Map(this.documents);
    const newAssets:Asset[]=[];const usedAssets=new Set<string>();const records:DocumentRecord[]=[];const ids=new Set<string>();
    const collect=(value:any,output:Set<string>,visited=new Set<object>())=>{if(!value||typeof value!=='object'||visited.has(value))return;visited.add(value);if(value.$asset){output.add(value.$asset);return;}for(const child of Object.values(value))collect(child,output,visited);};
    const encode=(value:any):any=>{
      if(!value||typeof value!=='object')return value;
      if(value instanceof Uint8Array||value instanceof Uint8ClampedArray){let id=this.ids.get(value);if(!id){id=uid();this.ids.set(value,id);}if(!this.assets.has(id)&&!newAssetIds.has(id)){newAssetIds.add(id);newAssets.push({id,windowId:this.windowId,data:value});}return {$asset:id};}
      const cached=memo.get(value);if(cached)return cached;const out:any=Array.isArray(value)?[]:{};memo.set(value,out);for(const [key,child]of Object.entries(value))out[key]=encode(child);return out;
    };
    for(const tab of state.sessions){const id=tab.history.current.id;ids.add(id);let cached=staged.get(id);if(!cached||cached.version!==tab.history.version){const record={id:`${this.windowId}/${id}`,windowId:this.windowId,history:encode(tab.history.exportState())};const assets=new Set<string>();collect(record.history,assets);cached={version:tab.history.version,record,assets};staged.set(id,cached);records.push(record);}cached.assets.forEach(id=>usedAssets.add(id));}
    const manifest:Manifest={id:this.windowId,schema:2,updated:new Date().toISOString(),state:{activeId:state.activeId,tool:state.tool,brush:state.brush,foreground:state.foreground,background:state.background,options:state.options,typeDefaults:state.typeDefaults,pendingType:state.pendingType},sessions:state.sessions.map(({history,...tab})=>({...tab,id:history.current.id}))};
    const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['sessions','documents','assets'],'readwrite');tx.objectStore('sessions').put(manifest);for(const asset of newAssets)if(usedAssets.has(asset.id))tx.objectStore('assets').put(asset);for(const record of records)tx.objectStore('documents').put(record);for(const [id]of staged)if(!ids.has(id)){tx.objectStore('documents').delete(`${this.windowId}/${id}`);staged.delete(id);}for(const id of this.assets)if(!usedAssets.has(id)){tx.objectStore('assets').delete(id);}tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Session storage failed.'));});
    this.documents=staged;this.assets=usedAssets;
    if(this.latest&&!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(error=>this.onError?.(String(error)));},250);
  }
  async clear(){
    if(this.timer)clearTimeout(this.timer);this.latest=undefined;await this.flight.catch(()=>{});this.closed=true;residents.delete(this.windowId);journals.delete(this.windowId);
    const db=await database();const read=db.transaction(['documents','assets'],'readonly');const [documents,assets]=await Promise.all([result(read.objectStore('documents').index('windowId').getAllKeys(this.windowId)),result(read.objectStore('assets').index('windowId').getAllKeys(this.windowId))]);
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['sessions','documents','assets'],'readwrite');tx.objectStore('sessions').delete(this.windowId);documents.forEach(id=>tx.objectStore('documents').delete(id));assets.forEach(id=>tx.objectStore('assets').delete(id));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
}
