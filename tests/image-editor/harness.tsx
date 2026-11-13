import React from 'react';
import '../../packages/ui/src/glass.css';
import { createRoot } from 'react-dom/client';
import ImageEditor from '../../apps/web/src/apps/image-editor';
import { AppProvider } from '../../packages/sdk/src';
import { Commands } from '../../apps/web/src/shell/commands';
import { serializeDocument, newDocument, layer, surface, identity, type ImageDocument } from '../../packages/image-engine/src';
import type { AppContext } from '../../packages/contracts/src';
const commands=new Commands();const files=new Map<string,{data:Uint8Array;version:string}>();const listeners=new Set<(path?:string)=>void>();
const settings=new Map<string,unknown>();const settingListeners=new Set<()=>void>();
const state={nextOpen:'/Images/test.lopeimage',nextSave:'/Images/test.lopeimage',notifications:[] as unknown[],title:'',guard:undefined as undefined|(()=>boolean|Promise<boolean>),files,commands};
const conflict=()=>Object.assign(new Error('Version conflict'),{code:'CONFLICT'});
const context:AppContext={windowId:'image-test',launchArgs:{},services:{
  commands,files:{async list(){return[];},async stat(path){const f=files.get(path);if(!f)throw new Error('File not found');return {name:path.split('/').at(-1)!,path,type:'file',size:f.data.length,modified:new Date().toISOString(),version:f.version};},async read(path){const f=files.get(path);if(!f)throw new Error('File not found');return {content:new TextDecoder().decode(f.data),version:f.version};},async write(path,content,expected){const prior=files.get(path);const v=typeof expected==='string'?expected:expected?.version;if(v&&prior?.version!==v)throw conflict();const version=crypto.randomUUID();files.set(path,{data:new TextEncoder().encode(content),version});listeners.forEach(cb=>cb(path));return {content,version};},async readBinary(path){const f=files.get(path);if(!f)throw new Error('File not found');return {data:f.data.slice(),version:f.version};},async writeBinary(path,data,options){const prior=files.get(path);if(options?.createOnly&&prior||options?.version&&prior?.version!==options.version)throw conflict();const version=crypto.randomUUID();files.set(path,{data:data.slice(),version});listeners.forEach(cb=>cb(path));return {version};},async mkdir(){},async rename(){},async remove(path){files.delete(path);},subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);}},
  terminal:{} as any,browser:{} as any,settings:{get<T>(key:string,fallback:T):T{return (settings.get(key)??JSON.parse(localStorage.getItem('ie-test.'+key)||'null')??fallback) as T;},set<T>(key:string,value:T){settings.set(key,value);localStorage.setItem('ie-test.'+key,JSON.stringify(value));settingListeners.forEach(cb=>cb());},subscribe(cb){settingListeners.add(cb);return()=>settingListeners.delete(cb);}},
  dialogs:{async openFile(){return state.nextOpen;},async saveFile(){return state.nextSave;}},notify(n){state.notifications.push(n);},openURL(){},async openFile(){},launch(){},statusItems:{register(){return()=>{};}}
},lifecycle:{setTitle(title){state.title=title;},close(){},onBeforeClose(callback){state.guard=callback;return()=>{state.guard=undefined;};}}};
Object.assign(window,{__imageTest:state,__imageContext:context});
window.addEventListener('keydown',e=>{if(e.defaultPrevented||(e.target as HTMLElement).closest('input,textarea,select'))return;for(const c of commands.list()){if(!c.shortcut)continue;const keys=c.shortcut.toLowerCase().split('+');if(e.key.toLowerCase()===keys.at(-1)&&Boolean(e.ctrlKey||e.metaKey)===keys.includes('mod')&&e.shiftKey===keys.includes('shift')&&e.altKey===keys.includes('alt')){e.preventDefault();void commands.execute(c.id);break;}}});
const root=createRoot(document.getElementById('root')!);const mount=()=>root.render(<AppProvider context={context}><ImageEditor context={context}/></AppProvider>);Object.assign(state,{suspend:()=>root.render(<div>Suspended</div>),mount});mount();
