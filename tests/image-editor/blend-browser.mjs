import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto((process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5176')+'/tests/image-editor/harness.html');await page.getByTestId('image-editor-app').waitFor();
  const result=await page.evaluate(async()=>{
    const e=await import('/packages/image-engine/src/index.ts'),{ImageWorker}=await import('/apps/web/src/apps/image-editor/worker-client.ts'),canvas=new e.CanvasRenderer(),gpu=new e.CanvasRenderer({gpu:true}),worker=new ImageWorker(),encoder=new e.SceneEncoder(),records=[];
    const compare=(fixture,path,actual,expected,tolerance=3)=>{let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));records.push({fixture,path,max,tolerance,actual:[...actual.slice(0,4)],expected:[...expected.slice(0,4)]});};
    const data=(renderer,doc)=>e.context2d(renderer.render(doc)).getImageData(0,0,doc.width,doc.height).data;
    const fixture=(mode,ba,sa,opacity)=>{const d=e.newDocument(8,6,'Blend',[51,128,204,ba]);d.layers.push({...e.layer('Front'),pixels:e.surface(8,6,[204,64,153,sa]),blend:mode,opacity});return d;};
    for(const mode of e.BLEND_MODES){for(const [ba,sa,opacity]of [[255,255,1],[128,177,.7],[0,177,.7]]){const doc=fixture(mode,ba,sa,opacity),expected=e.compositePixels(doc);compare(`${mode} ${ba}/${sa}/${opacity}`,'Canvas',data(canvas,doc),expected);compare(`${mode} ${ba}/${sa}/${opacity}`,'WebGL',data(gpu,doc),expected);}}
    for(const mode of e.BLEND_MODES.slice(16)){
      const doc=fixture(mode,128,177,.7);doc.layers[1].mask={pixels:e.surface(8,6,[160,160,160,255]),enabled:true,linked:true,transform:e.identity()};doc.layers[1].fill=.6;compare(mode+' mask/fill','Canvas',data(canvas,doc),e.compositePixels(doc));compare(mode+' mask/fill','WebGL',data(gpu,doc),e.compositePixels(doc));
      const clipped=fixture(mode,128,177,.7);clipped.layers[1].clipping=true;const expected=e.compositePixels(clipped);compare(mode+' clipping','Canvas',data(canvas,clipped),expected,4);compare(mode+' repeated clipping','Canvas',data(canvas,clipped),expected,4);
      const isolated=fixture('normal',255,255,1);isolated.layers[1]={...e.layer('Group','group'),blend:mode,opacity:.7,children:[{...e.layer('Child'),pixels:e.surface(8,6,[204,64,153,177])}]};compare(mode+' isolated group','Canvas',data(canvas,isolated),e.compositePixels(isolated));
      const view={x:2,y:1,width:4,height:3,scale:1},full=canvas.render(doc),crop=e.context2d(full).getImageData(2,1,4,3).data,packed=encoder.pack(doc,view),rendered=await worker.run('render-scene',packed.packet,packed.transfer),out=e.makeCanvas(4,3);e.context2d(out).drawImage(rendered.bitmap,0,0);rendered.bitmap.close();compare(mode+' viewport','worker',e.context2d(out).getImageData(0,0,4,3).data,crop);out.width=out.height=0;
    }
    const edge=e.newDocument(256,1,'Hard Mix boundary',[0,0,0,0]),back=new Uint8ClampedArray(256*4),front=new Uint8ClampedArray(256*4);for(let i=0;i<256;i++){back.set([i,i,i,255],i*4);front.set([255-i,255-i,255-i,255],i*4);}edge.layers=[{...e.layer('Base'),pixels:e.fromPixels(256,1,back)},{...e.layer('Front'),pixels:e.fromPixels(256,1,front),blend:'hard mix'}];const white=new Uint8ClampedArray(256*4).fill(255);compare('Hard Mix 256 threshold boundaries','Canvas',data(canvas,edge),white);compare('Hard Mix 256 threshold boundaries','WebGL',data(gpu,edge),white);
    for(const mode of ['darker color','lighter color']){for(let i=0;i<256;i++){back.set([i,255-i,0,255],i*4);front.set([0,i,255-i,255],i*4);}edge.layers=[{...e.layer('Base'),pixels:e.fromPixels(256,1,back)},{...e.layer('Front'),pixels:e.fromPixels(256,1,front),blend:mode}];compare(mode+' 256 equal totals','Canvas',data(canvas,edge),back);compare(mode+' 256 equal totals','WebGL',data(gpu,edge),back);}
    const backend=gpu.backend;worker.dispose();canvas.dispose();gpu.dispose();return {records,backend};
  });
  // Clipped translucent pixels cross Canvas premultiplication boundaries; allow four RGB/8 levels.
  if(result.records.some(r=>r.max>r.tolerance))console.error(JSON.stringify(result.records.filter(r=>r.max>r.tolerance)));
  for(const record of result.records)expect(record.max,`${record.fixture}, ${record.path}`).toBeLessThanOrEqual(record.tolerance);expect(result.backend).toBe('WebGL2');expect(errors).toEqual([]);await writeFile('docs/image-editor/blend-regressions.json',JSON.stringify({date:'2026-11-13',checks:result.records.length,maxChannelError:Math.max(...result.records.map(r=>r.max)),...result,errors},null,2)+'\n');console.log(JSON.stringify({checks:result.records.length,maxChannelError:Math.max(...result.records.map(r=>r.max)),backend:result.backend,errors},null,2));
}finally{await browser.close();}
