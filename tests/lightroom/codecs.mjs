import { seedSession } from '../setup/seed-session.mjs';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { syntheticDng } from './fixtures.ts';
const samples=[...syntheticDng()];const results=[];
await mkdir('docs/lightroom/fixtures',{recursive:true});
await writeFile('docs/lightroom/fixtures/synthetic-bayer.dng',new Uint8Array(samples));
for(const [name,type] of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]){
  let browser,profile;
  try{
    let executablePath;
    try{await access(type.executablePath());}catch{
      const cache=join(homedir(),'Library/Caches/ms-playwright'),prefix=name.toLowerCase()+'-';
      const revisions=(await readdir(cache)).filter(n=>n.startsWith(prefix)).sort((a,b)=>Number(b.slice(prefix.length))-Number(a.slice(prefix.length)));
      const installed=revisions[0]?join(cache,revisions[0],name==='Firefox'?'firefox/Nightly.app/Contents/MacOS/firefox':'pw_run.sh'):undefined;
      if(installed){await access(installed);executablePath=installed;}
    }
    let page;if(name==='Firefox'){profile=await mkdtemp('/private/tmp/lope-photo-firefox-');const context=await type.launchPersistentContext(profile,{headless:true,...(executablePath?{executablePath}:{})});browser=context.browser();page=await context.newPage();}else{browser=await type.launch({headless:true,...(executablePath?{executablePath}:{})});page=await browser.newPage();}
    await seedSession(page);await page.goto(process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(async sample=>{
      const {PhotoWorker}=await import('/apps/web/src/apps/lightroom/worker-client.ts');const worker=new PhotoWorker();
      const timer=setTimeout(()=>worker.cancel('Codec check exceeded 30 seconds.'),30000);
      try{
        const blob=new Blob([new Uint8Array(sample)]),inspect=await worker.run('inspect',{blob,name:'synthetic-bayer.dng'});
        const {defaultRecipe}=await import('/packages/photo-engine/src/model.ts');const recipe=defaultRecipe();
        const developed=await worker.run('render',{assetId:'synthetic',blob,name:'synthetic-bayer.dng',recipe,maxEdge:256});
        const originalSum=developed.pixels.reduce((a,b,i)=>i%4===3?a:a+b,0);recipe.values.exposure=1;
        const edited=await worker.run('render',{assetId:'synthetic',blob,name:'synthetic-bayer.dng',recipe,maxEdge:256});
        const editedSum=edited.pixels.reduce((a,b,i)=>i%4===3?a:a+b,0);
        const formats=[];
        for(const format of ['jpeg','png','tiff']){const output=await worker.run('export',{assetId:'synthetic',blob,name:'synthetic-bayer.dng',recipe,format,depth:format==='jpeg'?8:16,quality:.9,longEdge:64});const bytes=new Uint8Array(await output.blob.arrayBuffer());let read;try{const bitmap=await createImageBitmap(output.blob);read={width:bitmap.width,height:bitmap.height};bitmap.close();}catch{read={browserDecode:false};}formats.push({format,mime:output.blob.type,size:bytes.length,signature:[...bytes.slice(0,8)],data:[...bytes],...read});}
        return {metadata:inspect.metadata,width:developed.width,height:developed.height,originalSum,editedSum,formats};
      }finally{clearTimeout(timer);worker.dispose();}
    },samples);
    expect(result.metadata.raw).toBe(true);expect(result.metadata.bitDepth).toBe(16);expect(result.originalSum).toBeGreaterThan(0);expect(result.editedSum).toBeGreaterThan(result.originalSum);
    expect(result.formats[0].signature.slice(0,2)).toEqual([255,216]);expect(result.formats[1].signature).toEqual([137,80,78,71,13,10,26,10]);expect(result.formats[2].signature.slice(0,4)).toEqual([73,73,42,0]);
    for(const output of result.formats){await writeFile(`docs/lightroom/fixtures/${name.toLowerCase()}-export.${output.format==='jpeg'?'jpg':output.format==='tiff'?'tif':'png'}`,new Uint8Array(output.data));delete output.data;}
    results.push({browser:name,version:browser.version(),status:'passed',...result});
  }catch(cause){const error=String(cause);results.push({browser:name,status:/browserType\.launch/.test(error)?'unavailable':'failed',error:error.split('\n').slice(0,9).join('\n')});}
  finally{await browser?.close();if(profile)await rm(profile,{recursive:true,force:true});}
}
await writeFile('docs/lightroom/codec-verification.json',JSON.stringify({date:'2026-11-13',fixture:'Original procedural uncompressed 16-bit Bayer DNG 1.4; 128x96; no embedded preview; LopeOS synthetic camera',results},null,2));
console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
