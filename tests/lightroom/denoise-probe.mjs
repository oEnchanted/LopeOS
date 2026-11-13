import { chromium, webkit, expect } from '@playwright/test';
import { access, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const name=process.env.LOPE_PHOTO_BROWSER||'chromium',type=name==='webkit'?webkit:chromium;
let executablePath;
if(name==='webkit')try{await access(type.executablePath());}catch{const cache=join(homedir(),'Library/Caches/ms-playwright'),revisions=(await readdir(cache)).filter(n=>n.startsWith('webkit-')).sort((a,b)=>Number(b.slice(7))-Number(a.slice(7)));if(revisions[0])executablePath=join(cache,revisions[0],'pw_run.sh');}
const browser=await type.launch({headless:true,...(executablePath?{executablePath}:{})});
try{
  const page=await browser.newPage();await page.goto(process.env.LOPE_PHOTO_BASE||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {installDenoise}=await import('/packages/photo-engine/src/denoise-cache.ts'),{DenoiseClient}=await import('/apps/web/src/apps/lightroom/denoise-client.ts'),{encodePng}=await import('/packages/photo-engine/src/png.ts'),{srgbToLinear}=await import('/packages/photo-engine/src/tiff.ts');
    const installation=await installDenoise(new AbortController().signal,()=>{}),width=192,height=144,data=new Float32Array(width*height*4),clean=new Float32Array(width*height*3);let seed=121;
    const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return ((seed>>>0)+1)/4294967297;};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){const i=(y*width+x)*4+c;if(c===3){data[i]=1;continue;}const value=.15+c*.12+x/width*.2+(x>width/2?.22:0)+(y>height*.6?.06:0),noise=Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random())*25/255;clean[(y*width+x)*3+c]=value;data[i]=srgbToLinear(Math.max(0,Math.min(1,value+noise)));}
    const blob=new Blob([await encodePng({width,height,data},16)],{type:'image/png'}),worker=new DenoiseClient(),progress=[];const started=performance.now();
    try{const preview=await worker.run('preview',{installation,assetId:'quality',name:'noisy.png',blob,parameters:{sigma:25,amount:100},focus:{x:.5,y:.5}},p=>progress.push(p));let before=0,after=0,n=0;for(let i=0;i<clean.length;i++){const p=Math.floor(i/3)*4+i%3;before+=(preview.before[p]/255-clean[i])**2;after+=(preview.after[p]/255-clean[i])**2;n++;}return {width:preview.width,height:preview.height,beforeMse:before/n,afterMse:after/n,psnrGainDb:10*Math.log10(before/after),durationMs:performance.now()-started,progress,installedBytes:installation.totalBytes};}
    finally{worker.dispose();}
  });
  expect(result.psnrGainDb).toBeGreaterThan(3);expect(result.progress.some(p=>p.phase==='processing'&&p.completed===p.total)).toBe(true);result.browser={name,version:browser.version()};await writeFile(`docs/lightroom/${name==='chromium'?'denoise-probe':'denoise-'+name+'-probe'}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
