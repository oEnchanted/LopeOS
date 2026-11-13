import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {AI_ASSETS} from '../../packages/image-engine/src/ai/catalog.ts';

// NASA public-domain sample; the photograph and derived images remain in /tmp.
const source='https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/astronaut.png';
const licenseSource='https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut';
const paths={runtime:'/tmp/lope-ai-ort.mjs',loader:'/tmp/lope-ai-wasm.mjs',wasm:'/tmp/lope-ai-runtime.wasm',model:'/tmp/lope-ai-modnet.onnx'};
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const asset of AI_ASSETS){let bytes;try{bytes=await readFile(paths[asset.id]);}catch{bytes=Buffer.from(await(await fetch(asset.url)).arrayBuffer());}await page.route(asset.url,route=>route.fulfill({body:bytes,headers:{'Access-Control-Allow-Origin':'*'}}));}
  let portrait;try{portrait=await readFile('/tmp/lope-ai-portrait-astronaut.png');}catch{portrait=Buffer.from(await(await fetch(source)).arrayBuffer());await writeFile('/tmp/lope-ai-portrait-astronaut.png',portrait);}await page.route('**/__portrait-probe.png',route=>route.fulfill({body:portrait,contentType:'image/png'}));
  await page.goto((process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5176')+'/tests/image-editor/harness.html');
  const result=await page.evaluate(async()=>{
    const cache=await import('/packages/image-engine/src/ai/cache.ts');await cache.installLocalAI(new AbortController().signal,()=>{});
    const e=await import('/packages/image-engine/src/index.ts'),{PortraitEngine}=await import('/apps/web/src/apps/image-editor/ai/client.ts'),bitmap=await createImageBitmap(await(await fetch('/__portrait-probe.png')).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const original=ctx.getImageData(0,0,canvas.width,canvas.height),doc=e.newDocument(canvas.width,canvas.height,'NASA portrait',[0,0,0,0]);doc.layers[0].pixels=e.fromPixels(canvas.width,canvas.height,original.data);doc.layers[0].locked=false;const result=await new PortraitEngine().run(doc,doc.layers[0].id,()=>{}),mask=result.mask;
    const sample=(name,x,y,w=20,h=20)=>{let sum=0;for(let sy=y;sy<y+h;sy++)for(let sx=x;sx<x+w;sx++)sum+=mask[sy*doc.width+sx];return {name,rect:[x,y,w,h],meanAlpha:sum/(w*h)};};
    const summary={dimensions:[doc.width,doc.height],backend:result.backend,inferenceMs:result.ms,foregroundFraction:mask.reduce((n,v)=>n+Number(v>=128),0)/mask.length,meanAlpha:mask.reduce((n,v)=>n+v,0)/mask.length,samples:[sample('face',205,115),sample('suit',90,300),sample('upper-right background',465,35),sample('right background',470,290)]};
    const matte=new OffscreenCanvas(doc.width,doc.height),mctx=matte.getContext('2d'),pixels=mctx.createImageData(doc.width,doc.height),cutout=new OffscreenCanvas(doc.width,doc.height),cctx=cutout.getContext('2d');for(let i=0;i<mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=mask[i];pixels.data[i*4+3]=255;original.data[i*4+3]=mask[i];}mctx.putImageData(pixels,0,0);cctx.putImageData(original,0,0);
    const comparison=globalThis.document.createElement('canvas');comparison.width=1536;comparison.height=548;const out=comparison.getContext('2d');out.fillStyle='#252525';out.fillRect(0,0,1536,548);out.font='18px sans-serif';out.fillStyle='white';for(const [i,label]of ['NASA source (public domain)','Actual MODNet alpha','Actual masked portrait'].entries())out.fillText(label,i*512+12,25);out.drawImage(canvas,0,36);out.drawImage(matte,512,36);for(let y=36;y<548;y+=16)for(let x=1024;x<1536;x+=16){out.fillStyle=(Math.floor(x/16)+Math.floor((y-36)/16))%2?'#a8a8a8':'#e5e5e5';out.fillRect(x,y,16,16);}out.drawImage(cutout,1024,36);bitmap.close();return {summary,comparison:comparison.toDataURL('image/png')};
  });
  expect(result.summary.foregroundFraction).toBeGreaterThan(.15);expect(result.summary.foregroundFraction).toBeLessThan(.85);for(const s of result.summary.samples.slice(0,2))expect(s.meanAlpha).toBeGreaterThan(230);for(const s of result.summary.samples.slice(2))expect(s.meanAlpha).toBeLessThan(20);expect(errors).toEqual([]);
  await writeFile('/tmp/lope-ai-portrait-comparison.png',Buffer.from(result.comparison.split(',')[1],'base64'));
  const report={date:'2026-11-13',sample:'NASA photograph of Eileen Collins, scikit-image astronaut sample',source,license:'Public domain; no known copyright restrictions, as documented by scikit-image',licenseSource,...result.summary,errors,scope:'Single photograph and four coarse sample regions; no ground-truth alpha, population benchmark or Photoshop-equivalence claim.',visualInspection:'Pending visual inspection of /tmp/lope-ai-portrait-comparison.png; photograph is not included in the application.'};await writeFile('/tmp/lope-ai-portrait-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
