import type {FileService} from '../../../../packages/contracts/src';
import {preferences} from '../../../../packages/sdk/src/preferences';
/** A shared-service policy, not a sandbox for code running on the same origin. */
export function scopedFiles(service:FileService, appId:string):FileService {
 const allowed=()=>preferences.getSnapshot().fileAccess[appId]!==false;
 return new Proxy(service,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key==='subscribe')return(callback:(path?:string)=>void)=>{let release:(()=>void)|undefined;let previous:boolean|undefined;const update=()=>{const next=allowed();if(next===previous)return;previous=next;release?.();release=next?target.subscribe(callback):undefined;};update();const remove=preferences.subscribe(update);return()=>{release?.();remove();};};return (...args:unknown[])=>{if(!allowed())return Promise.reject(new Error('Workspace file access is disabled for this application in Settings.'));return value.apply(target,args);};}});
}
