import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {AppContext} from '../../packages/contracts/src';
import {AppProvider} from '../../packages/sdk/src';
import {Commands} from '../../apps/web/src/shell/commands';
import PhotoStudio from '../../apps/web/src/apps/lightroom';
import ImageEditor from '../../apps/web/src/apps/image-editor';
import '../../packages/ui/src/styles.css';
const files=new Map<string,{data:Uint8Array;version:string}>(),listeners=new Set<(path?:string)=>void>(),settings=new Map<string,unknown>(),commands=new Commands();
let launch=(id:string,args?:Record<string,unknown>)=>{};
const write=(path:string,data:Uint8Array,options?:{createOnly?:boolean;version?:string})=>{const prior=files.get(path);if(options?.createOnly&&prior||options?.version&&prior?.version!==options.version)throw new Error('Workspace conflict');const version=crypto.randomUUID();files.set(path,{data:data.slice(),version});listeners.forEach(f=>f(path));return {version};};
const context:AppContext={windowId:'photo-handoff',launchArgs:{},lifecycle:{setTitle(){},close(){},onBeforeClose(){return()=>{};}},services:{commands,
  files:{async list(){return[];},async stat(path){const f=files.get(path);if(!f)throw new Error('Missing file');return {path,name:path.split('/').at(-1)!,type:'file',size:f.data.length,modified:new Date().toISOString(),version:f.version};},async read(path){const f=files.get(path);if(!f)throw new Error('Missing file');return {content:new TextDecoder().decode(f.data),version:f.version};},async readBinary(path){const f=files.get(path);if(!f)throw new Error('Missing file');return {data:f.data.slice(),version:f.version};},async write(path,content,expected){const options=typeof expected==='string'?{version:expected}:expected;return {...write(path,new TextEncoder().encode(content),options),content};},async writeBinary(path,data,options){return write(path,data,options);},async mkdir(){},async rename(){},async remove(){},subscribe(f){listeners.add(f);return()=>listeners.delete(f);}},
  terminal:{} as any,browser:{} as any,settings:{get<T>(key:string,fallback:T){return (settings.get(key)??fallback) as T;},set(key,value){settings.set(key,value);},subscribe(){return()=>{};}},dialogs:{async openFile(){return null;},async saveFile(options){return '/Images/'+(options?.defaultName||'edit.lopeimage');}},notify(){},openURL(){},async openFile(){},launch:(id,args)=>launch(id,args),statusItems:{register(){return()=>{};}}
}};
Object.assign(window,{__handoff:{files,commands}});
function Harness(){const [image,setImage]=useState<AppContext|null>(null);launch=(id,args)=>{if(id==='lope.image-editor')setImage({...context,windowId:'returned-image',launchArgs:args||{}});};return <><main hidden={!!image}><AppProvider context={context}><PhotoStudio context={context}/></AppProvider></main>{image&&<main><button id="return-to-photo" onClick={()=>setImage(null)}>Return to Lightroom</button><AppProvider context={image}><ImageEditor context={image}/></AppProvider></main>}</>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
