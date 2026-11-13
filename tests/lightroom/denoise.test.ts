import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkDenoiseEligibility,denoiseImage,denoiseTiles,extractRegion,previewRegion,validateDenoiseParameters,DENOISE_CORE,DENOISE_HALO,DENOISE_TILE} from '../../packages/photo-engine/src/denoise.ts';
import {srgbToLinear} from '../../packages/photo-engine/src/tiff.ts';
import type {FloatImage} from '../../packages/photo-engine/src/model.ts';
function fixture(width=203,height=197):FloatImage{const data=new Float32Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=srgbToLinear(.1+x/width*.7);data[i+1]=srgbToLinear(.15+y/height*.6);data[i+2]=srgbToLinear(.3+(x>width/2?.3:0));data[i+3]=1;}return {width,height,data};}
test('inference receives normalized planar sRGB and normalized noise level; originals stay unchanged',async()=>{
  const source=fixture(8,7),original=source.data.slice();let calls=0;
  const result=await denoiseImage(source,{sigma:25,amount:100},async(data,sigma)=>{calls++;assert.equal(data.length,3*160*160);assert.equal(sigma,25/255);assert.ok(Math.abs(data[DENOISE_HALO*DENOISE_TILE+DENOISE_HALO]-.1)<1e-6);assert.ok(Math.abs(data[160*160+DENOISE_HALO*160+DENOISE_HALO]-.15)<1e-6);return data;});
  assert.equal(calls,1);assert.deepEqual(source.data,original);for(let i=0;i<original.length;i++)assert.ok(Math.abs(result.data[i]-original[i])<1e-6);
});
test('global tile origins, halo and valid cores reproduce a region from a full render without seams',async()=>{
  const source=fixture(),infer=async(data:Float32Array)=>{const out=data.slice(),plane=DENOISE_TILE*DENOISE_TILE;for(let c=0;c<3;c++)for(let y=1;y<DENOISE_TILE-1;y++)for(let x=1;x<DENOISE_TILE-1;x++){const i=c*plane+y*DENOISE_TILE+x;out[i]=(data[i]*4+data[i-1]+data[i+1]+data[i-DENOISE_TILE]+data[i+DENOISE_TILE])/8;}return out;};
  const full=await denoiseImage(source,{sigma:18,amount:70},infer),region={x:87,y:91,width:110,height:103},preview=await denoiseImage(source,{sigma:18,amount:70},infer,region),expected=extractRegion(full,region);assert.deepEqual(preview.data,expected.data);
  const tiles=denoiseTiles(source,region);assert.ok(tiles.every(t=>t.x%DENOISE_CORE===0&&t.y%DENOISE_CORE===0&&t.x%2===0&&t.y%2===0));
});
test('zero amount is an exact copy and does not run a model',async()=>{const source=fixture(4,3),result=await denoiseImage(source,{sigma:25,amount:0},async()=>{throw new Error('should not execute');});assert.deepEqual(result.data,source.data);assert.notEqual(result.data,source.data);});
test('amount blends in linear precision and preserves alpha',async()=>{const source=fixture(4,3),result=await denoiseImage(source,{sigma:25,amount:25},async data=>data.fill(.5));for(let i=0;i<result.data.length;i++)assert.ok(Math.abs(result.data[i]-(i%4===3?1:source.data[i]+(srgbToLinear(.5)-source.data[i])*.25))<1e-6);});
test('preview regions clamp to original dimensions without rescaling',()=>{assert.deepEqual(previewRegion({width:80,height:60},{x:1,y:0}),{x:0,y:0,width:80,height:60});assert.deepEqual(previewRegion({width:2000,height:1000},{x:.5,y:.5}),{x:904,y:404,width:192,height:192});});
test('HDR, transparency, invalid parameters and invalid model results fail explicitly',async()=>{
  const image=fixture(4,3);image.data[0]=2;assert.throws(()=>checkDenoiseEligibility(image),/SDR/);image.data[0]=.2;image.data[3]=.5;assert.throws(()=>checkDenoiseEligibility(image),/opaque/);image.data[3]=1;
  assert.throws(()=>validateDenoiseParameters({sigma:NaN,amount:80}));assert.throws(()=>validateDenoiseParameters({sigma:25,amount:101}));
  await assert.rejects(denoiseImage(image,{sigma:25,amount:80},async()=>new Float32Array(3)),/unexpected tensor/);
  await assert.rejects(denoiseImage(image,{sigma:25,amount:80},async data=>data.fill(NaN)),/nonfinite/);
  await assert.rejects(denoiseImage(image,{sigma:25,amount:80},async data=>data,{x:-1,y:0,width:1,height:1}),/preview region/);
});
test('progress counts only finished image cores and model errors do not report completion',async()=>{
  const image=fixture(200,100),steps:number[]=[];let calls=0;await assert.rejects(denoiseImage(image,{sigma:20,amount:75},async data=>{if(++calls===3)throw new Error('inference failed');return data;},undefined,(done)=>steps.push(done)),/inference failed/);assert.deepEqual(steps,[1,2]);
});
