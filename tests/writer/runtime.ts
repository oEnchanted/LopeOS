/** Test-only binary filesystem contract. Uses the production runtime-client transport. */
import type { Page, WebSocketRoute } from '@playwright/test';
import { readFile } from 'node:fs/promises';
export async function writerFilesystem(page: Page) {
  const sockets = new Set<WebSocketRoute>();
  const files = new Map<string,{data:Buffer;version:string}>();
  let revision=0, offline=false, loseNextWrite=false, writeDelay=0, readDelay=0;
  let readGate: Promise<void> | null = null;
  const put=(path:string,data:Buffer)=>files.set(path,{data,version:String(++revision)});
  put('/Documents/Review.docx',await readFile('tests/writer/fixtures/multipage.docx'));
  put('/Documents/Unsafe.docx',await readFile('tests/writer/fixtures/embedded-object.docx'));
  put('/Documents/Fonts.docx',await readFile('tests/writer/fixtures/missing-font.docx'));
  const entry=(path:string)=>({path,name:path.split('/').at(-1),version:files.get(path)?.version,type:'file',size:files.get(path)?.data.length||0,modifiedAt:'2026-11-12T18:00:00Z'});
  const changed=()=>{for(const socket of sockets)socket.send(JSON.stringify({type:'files.changed'}));};
  await page.routeWebSocket('**/api/ws',socket=>{sockets.add(socket);socket.onMessage(()=>socket.send(JSON.stringify({type:'files.ready'})));socket.onClose(()=>sockets.delete(socket));});
  await page.route('**/api/fs/**',async route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postDataJSON()||{},path=url.searchParams.get('path')||body.path;
    const reply=(status:number,data:unknown)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    const fail=(code:string,message:string,status=400)=>reply(status,{error:{code,message}});
    if(offline)return fail('UNAVAILABLE','Workspace disconnected.',503);
    if(url.pathname.endsWith('/read')){const gate=readGate;readGate=null;if(gate)await gate;const delay=readDelay;readDelay=0;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return files.has(path)?reply(200,{data:files.get(path)!.data.toString('base64'),version:files.get(path)!.version}):fail('NOT_FOUND','File not found.',404);}
    if(url.pathname.endsWith('/stat'))return files.has(path)?reply(200,entry(path)):fail('NOT_FOUND','File not found.',404);
    if(url.pathname.endsWith('/write')){
      const old=files.get(path);
      if((body.createOnly&&old)||(body.version!==undefined&&body.version!==old?.version))return fail('CONFLICT','Version conflict.',409);
      put(path,Buffer.from(body.data,'base64'));changed();
      const delay=writeDelay;writeDelay=0;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(loseNextWrite){loseNextWrite=false;return route.abort('connectionclosed');}
      return reply(200,entry(path));
    }
    if(url.pathname.endsWith('/list'))return reply(200,{entries:[...files.keys()].map(entry)});
    return fail('NOT_FOUND','Unknown fixture endpoint.',404);
  });
  return {files,holdNextRead:()=>{let release!:()=>void;readGate=new Promise<void>(resolve=>{release=resolve;});return release;},delayNextRead:(ms:number)=>{readDelay=ms;},externalWrite:(path:string,data:Buffer)=>{put(path,data);changed();},setOffline:(v:boolean)=>{offline=v;},interruptNextWrite:()=>{loseNextWrite=true;},delayNextWrite:(ms:number)=>{writeDelay=ms;}};
}
