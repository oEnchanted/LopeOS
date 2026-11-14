import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { png, u16, tiffRgba } from './release-codec-fixtures.ts';

const base=process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5191';
const directory='docs/lightroom/release-audit/evidence/codec-fixtures';
await mkdir(directory,{recursive:true});
const fixtures=[
  {name:'gray16-trns.png',bytes:png(0,[0x1234,0x1235],[{name:'tRNS',data:u16(0x1234)}]),expectedAlpha:[0,255]},
  {name:'rgb16-trns.png',bytes:png(2,[1000,2000,3000,1000,2000,3001],[{name:'tRNS',data:u16(1000,2000,3000)}]),expectedAlpha:[0,255]},
  {name:'associated-alpha16.tif',bytes:tiffRgba(1),expectedAlpha:[128],expectedRgb:[102,51,26]},
  {name:'unassociated-alpha16.tif',bytes:tiffRgba(2),expectedAlpha:[128],expectedRgb:[51,26,13]},
  {name:'unspecified-extra16.tif',bytes:tiffRgba(0),expectedAlpha:[255],expectedRgb:[51,26,13]},
  {name:'pq-transfer16.png',bytes:png(2,[1000,2000,3000],[{name:'cICP',data:new Uint8Array([1,16,0,1])}]),expectError:'color transform'}
];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const fixture of fixtures)await writeFile(`${directory}/${fixture.name}`,fixture.bytes);
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`${base}/tests/lightroom/handoff.html`);
  const results=await page.evaluate(async fixtures=>{
    const {PhotoWorker}=await import('/apps/web/src/apps/lightroom/worker-client.ts');
    const {defaultRecipe}=await import('/packages/photo-engine/src/model.ts');
    const worker=new PhotoWorker(),results=[];
    try{
      for(const fixture of fixtures){
        const blob=new Blob([new Uint8Array(fixture.bytes)]),payload={assetId:fixture.name,name:fixture.name,blob,recipe:defaultRecipe()};
        try{
          const inspection=await worker.run('inspect',payload),render=await worker.run('render',payload),output=await worker.run('export',{...payload,format:'png',depth:16});
          results.push({name:fixture.name,metadata:inspection.metadata,width:render.width,height:render.height,pixels:[...render.pixels],output:[...new Uint8Array(await output.blob.arrayBuffer())]});
        }catch(error){results.push({name:fixture.name,error:String(error)});}
      }
    }finally{worker.dispose();}
    return results;
  },fixtures.map(f=>({name:f.name,bytes:[...f.bytes]})));
  for(let i=0;i<fixtures.length;i++){
    const fixture=fixtures[i],result=results[i];result.sourceSha256=sha256(fixture.bytes);
    if(fixture.expectError){expect(result.error).toContain(fixture.expectError);result.passed=true;continue;}
    expect(result.error).toBeUndefined();expect(result.metadata.bitDepth).toBe(16);
    expect(result.pixels.filter((_,i)=>i%4===3)).toEqual(fixture.expectedAlpha);
    if(fixture.expectedRgb)for(let c=0;c<3;c++)expect(Math.abs(result.pixels[c]-fixture.expectedRgb[c])).toBeLessThanOrEqual(1);
    const output=new Uint8Array(result.output);result.outputSha256=sha256(output);result.outputPath=`${directory}/${fixture.name}.export.png`;await writeFile(result.outputPath,output);delete result.output;result.passed=true;
  }
  expect(errors).toEqual([]);
  const report={date:'2026-11-13',browser:browser.version(),base,fixtures:'Original procedural 16-bit editable PNG/TIFF files. Gray/RGB tRNS uses distinct low bits; TIFF covers associated/unassociated/unspecified extra samples.',results,errors};
  await writeFile('docs/lightroom/release-audit/evidence/data-codec-worker.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
