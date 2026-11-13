import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRecipe, commitRecipe, undoRecipe, newMask, validateRecipe, type Asset, type FloatImage } from '../../packages/photo-engine/src/model.ts';
import { analyzePhoto, autoValues, histogram, maskValue, outputToSource, renderPhoto, sourceToOutput } from '../../packages/photo-engine/src/render.ts';
import { decodeTiff, encodeTiff, linearToSrgb, srgbToLinear, tiffTags } from '../../packages/photo-engine/src/tiff.ts';
import { decodePng16, encodePng } from '../../packages/photo-engine/src/png.ts';
import { identifyFormat } from '../../packages/photo-engine/src/formats.ts';
import { visibleAssets } from '../../apps/web/src/apps/lightroom/library.ts';
const image=():FloatImage=>{const width=32,height=24,data=new Float32Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=x/31;data[i+1]=y/23;data[i+2]=(x+y)/54;data[i+3]=1;}return {width,height,data};};
const asset=():Asset=>({id:'one',name:'photo.jpg',hash:'same-hash',imported:'2026-11-12T12:00:00Z',size:100,metadata:{width:32,height:24,bitDepth:8,format:'jpeg',decoder:'test',colorSpace:'sRGB',orientation:1,raw:false,warnings:[]},thumbnail:new Blob(),recipe:defaultRecipe(),history:[],future:[],versions:[],rating:0,flag:'none',label:'',keywords:[],albumIds:[],order:0,storage:'managed'});
test('linear development preserves immutable source and highlight headroom',()=>{
  const source=image(),before=source.data.slice(),r=defaultRecipe();r.values.exposure=2;const out=renderPhoto(source,r);assert.ok(out.data.some((v,i)=>i%4!==3&&v>1));assert.deepEqual(source.data,before);const second=renderPhoto(source,r);assert.deepEqual(out.data,second.data);assert.notDeepEqual(out.data,renderPhoto(source,defaultRecipe()).data);
});
test('one edit transaction, undo and redo preserve exact recipe state',()=>{
  const a=asset(),r=defaultRecipe();r.values.exposure=1.25;const next=commitRecipe(a,r,'Exposure');assert.equal(next.history.length,1);assert.equal(a.recipe.values.exposure,0);const undo=undoRecipe(next);assert.equal(undo.recipe.values.exposure,0);assert.equal(undo.future.length,1);assert.deepEqual(undoRecipe(undo,true).recipe,r);assert.equal(commitRecipe(next,r,'unchanged'),next);
});
test('source-relative masks survive crop, rotation, flip, perspective and straightening',()=>{
  const r=defaultRecipe();r.crop={x:.1,y:.2,width:.6,height:.5};r.rotation=90;r.flipX=true;r.values.straighten=4;r.values.vertical=15;r.values.distortion=8;
  for(const p of [{x:.1,y:.2},{x:.5,y:.5},{x:.9,y:.8}]){const source=outputToSource(p,r),restored=sourceToOutput(source,r);assert.ok(Math.abs(restored.x-p.x)<.00001);assert.ok(Math.abs(restored.y-p.y)<.00001);}
  const m=newMask('radial');m.components[0].start={x:.4,y:.4};m.components[0].end={x:.7,y:.7};assert.equal(maskValue(m,{x:.4,y:.4},[.2,.2,.2]),1);assert.equal(maskValue(m,{x:.99,y:.99},[.2,.2,.2]),0);m.inverted=true;assert.equal(maskValue(m,{x:.4,y:.4},[.2,.2,.2]),0);
});
test('clone and heal produce distinct, reversible source-preserving pixels',()=>{
  const source=image(),before=source.data.slice(),clone=defaultRecipe();clone.retouch=[{id:'c',type:'clone',source:{x:.2,y:.2},target:{x:.7,y:.7},radius:.2,feather:.5}];const heal=structuredClone(clone);heal.retouch[0].type='heal';assert.notDeepEqual(renderPhoto(source,clone).data,renderPhoto(source,heal).data);assert.deepEqual(source.data,before);
});
for(const depth of [8,16,32] as const)test(`TIFF ${depth}-bit has valid tags, dimensions, profile and bounded round-trip error`,()=>{
  const source=image();if(depth===32)source.data[0]=3.5;const encoded=encodeTiff(source,depth),tags=tiffTags(encoded);assert.deepEqual(tags.get(258),[depth,depth,depth]);assert.deepEqual(tags.get(339),[depth===32?3:1,depth===32?3:1,depth===32?3:1]);assert.ok((tags.get(34675) as number[]).length>300);const result=decodeTiff(encoded);assert.equal(result.image.width,32);assert.equal(result.image.height,24);let error=0;for(let i=0;i<source.data.length;i++)error=Math.max(error,Math.abs(result.image.data[i]-source.data[i]));assert.ok(error<(depth===8?.009:depth===16?.00004:1e-7),String(error));
});
test('16-bit PNG retains >8-bit precision, real signature and source pixels',async()=>{
  const source=image(),bytes=await encodePng(source,16);assert.equal(bytes[24],16);assert.equal(identifyFormat(bytes,'not-an-image.txt'),'png');const decoded=await decodePng16(bytes);let error=0;for(let i=0;i<source.data.length;i++)error=Math.max(error,Math.abs(source.data[i]-decoded.data[i]));assert.ok(error<.00004,String(error));const bad=bytes.slice();bad[55]^=1;await assert.rejects(decodePng16(bad),/checksum/);
});
test('original comparison comes from source, not progressively rendered pixels',()=>{
  const source=image(),r=defaultRecipe();r.values.contrast=20;r.values.exposure=1;r.crop={x:.1,y:.1,width:.8,height:.8};const untouched=renderPhoto(source,defaultRecipe());renderPhoto(source,r);assert.deepEqual(renderPhoto(source,defaultRecipe()),untouched);
});
test('histogram and auto changes respond to real image luminance',()=>{
  const dark=image();for(let i=0;i<dark.data.length;i++)if(i%4!==3)dark.data[i]*=.02;const h=histogram(dark);assert.equal(h[0].reduce((a,b)=>a+b),32*24);assert.ok(autoValues(dark).exposure>0);const score=analyzePhoto(dark);assert.ok(score.exposure<100);assert.equal(score.method,'edge-energy-and-luminance-v1');
});
test('recipe validation rejects nonfinite controls and malformed masks',()=>{
  const r=defaultRecipe();r.values.exposure=Infinity;assert.throws(()=>validateRecipe(r));const m=defaultRecipe();m.masks=[newMask('brush')];m.masks[0].components[0].points=[{x:Infinity,y:0}];assert.throws(()=>validateRecipe(m));
});
test('album removal is distinct from originals, smart filters combine with search and stacks',()=>{
  const a=asset(),b={...asset(),id:'two',rating:4,keywords:['forest'],albumIds:['album'],stackId:'stack'},c={...b,id:'three'};const filters={query:'forest',rating:3,flag:'',label:'',sort:'rating',stacked:true};assert.deepEqual(visibleAssets([a,b,c],{id:'album',name:'Album',type:'album'},'album',filters).map(a=>a.id),['two']);assert.equal(visibleAssets([{...b,trashed:'2026-11-12'}],undefined,'all',{...filters,stacked:false}).length,0);
});
test('sRGB transfer functions are inverse for known midtones and headroom',()=>{for(const n of [0,.001,.02,.18,.5,1,2])assert.ok(Math.abs(srgbToLinear(linearToSrgb(n))-n)<1e-8);});
