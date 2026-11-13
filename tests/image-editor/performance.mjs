import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
try{
  await page.goto((process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5176')+'/tests/image-editor/harness.html');await expect(page.getByTestId('image-editor-app')).toHaveAttribute('data-session-ready','true');
  const result=await page.evaluate(async()=>{
    const e=await import('/packages/image-engine/src/index.ts');const {ImageWorker}=await import('/apps/web/src/apps/image-editor/worker-client.ts');const {SessionJournal}=await import('/apps/web/src/apps/image-editor/session.ts');
    let doc=e.newDocument(4096,4096,'Dense 4K preview',[0,0,0,0]);doc.layers=[];
    for(let index=0;index<8;index++){
      const data=new Uint8ClampedArray(1024*1024*4);for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const p=(y*1024+x)*4;data[p]=(x+y+index*17)%256;data[p+1]=(y/4+index*23)%256;data[p+2]=(x/4+index*31)%256;data[p+3]=index?40+((x+y)%40):255;}
      doc.layers.push({...e.layer('Dense '+index),pixels:e.fromPixels(1024,1024,data),transform:{...e.identity(),scaleX:4,scaleY:4},blend:index%3===1?'multiply':'normal'});
    }
    doc.activeIds=[doc.layers.at(-1).id];const encoder=new e.SceneEncoder(),worker=new ImageWorker();const view={x:0,y:640,width:4096,height:2560,scale:.25};const frames=[];let beats=0,maxHeartbeatGap=0,last=performance.now();const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGap=Math.max(maxHeartbeatGap,now-last);last=now;beats++;},8);
    const frame=async label=>{const start=performance.now(),packed=encoder.pack(doc,view),packedAt=performance.now();const rendered=await worker.run('render-scene',packed.packet,packed.transfer);frames.push({label,packMs:packedAt-start,totalMs:performance.now()-start,workerMs:rendered.ms,transferBytes:rendered.bytes,width:rendered.bitmap.width,height:rendered.bitmap.height});rendered.bitmap.close();};
    await frame('cold');await frame('unchanged');
    const brushMs=[];for(let i=0;i<8;i++){const start=performance.now(),stroke=new e.BrushStroke(doc,{size:45,hardness:.75,opacity:.8,flow:.4,spacing:.15,color:'#f08030',pressure:false});stroke.add({x:1200+i*35,y:1400});stroke.add({x:1450+i*35,y:1500});doc=stroke.finish();brushMs.push(performance.now()-start);await frame('stroke '+i);}
    clearInterval(heartbeat);worker.dispose();
    const h=new e.History(doc),journal=new SessionJournal('performance-test');const state={sessions:[{history:h,zoom:.25,pan:{x:0,y:0}}],activeId:doc.id,tool:'brush',brush:{size:45,hardness:.75,opacity:.8,flow:.4,spacing:.15,color:'#f08030',pressure:false},foreground:'#f08030',background:'#ffffff',options:{autoSelect:true,showTransform:false,tolerance:32,contiguous:true,feather:0,selectionMode:'replace'},typeDefaults:{content:'',font:'Arial',size:24,color:'#000000',bold:false,italic:false,align:'left',leading:1.2,tracking:0}};
    let start=performance.now();journal.schedule(state);await journal.flush();const initialJournalMs=performance.now()-start;start=performance.now();journal.schedule({...state,sessions:[{history:h,zoom:.5,pan:{x:24,y:12}}]});await journal.flush();const metadataJournalMs=performance.now()-start;await journal.clear();
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],warm=frames.filter(f=>f.label.startsWith('stroke'));
    return {dimensions:[4096,4096],layers:8,sourceResolution:[1024,1024],sourceScale:4,tileBytes:e.documentMemory([doc]),viewport:view,output:[frames[0].width,frames[0].height],frames,brushMs,medianBrushMs:median(brushMs),medianWarmFrameMs:median(warm.map(f=>f.totalMs)),medianWorkerMs:median(warm.map(f=>f.workerMs)),heartbeat:{beats,maxGapMs:maxHeartbeatGap},journal:{initialMs:initialJournalMs,metadataOnlyMs:metadataJournalMs},heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null,hardwareConcurrency:navigator.hardwareConcurrency,userAgent:navigator.userAgent};
  });
  expect(result.frames[1].transferBytes).toBe(0);expect(result.frames[0].transferBytes).toBeGreaterThan(16*1024*1024);for(const frame of result.frames.slice(2))expect(frame.transferBytes).toBeLessThan(2*1024*1024);expect(result.heartbeat.beats).toBeGreaterThan(1);expect(result.output).toEqual([1024,640]);
  await writeFile('docs/image-editor/performance.json',JSON.stringify({date:'2026-11-13',host:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,memory:os.totalmem()},...result},null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
