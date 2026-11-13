import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceNoise } from '../../packages/photo-engine/src/noise.ts';
import { defaultRecipe, type FloatImage } from '../../packages/photo-engine/src/model.ts';
import { renderPhoto } from '../../packages/photo-engine/src/render.ts';

const luma=(r:number,g:number,b:number)=>.2126*r+.7152*g+.0722*b;
function fixture(chroma=false):FloatImage{
  const width=80,height=48,data=new Float32Array(width*height*4);let seed=331;
  const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return (seed>>>0)/4294967295-.5;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,value=x<width/2?.22:.72;
    if(chroma){const r=random()*.14,b=random()*.14;data[i]=value+r;data[i+2]=value+b;data[i+1]=value-(.2126*r+.0722*b)/.7152;}
    else data[i]=data[i+1]=data[i+2]=value+random()*.14;
    data[i+3]=1;
  }
  return {width,height,data};
}
function mse(image:FloatImage,chroma=false){let sum=0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,lum=luma(image.data[i],image.data[i+1],image.data[i+2]),target=x<image.width/2?.22:.72;sum+=chroma?(image.data[i]-lum)**2+(image.data[i+2]-lum)**2:(lum-target)**2;}return sum/(image.width*image.height);}

test('standard luminance reduction lowers measured noise while preserving a sharp edge',()=>{
  const source=fixture(),before=source.data.slice(),out=reduceNoise(source,100,0);
  assert.ok(mse(out)<mse(source)*.35);
  for(let y=3;y<source.height-3;y++){const a=(y*source.width+39)*4,b=a+4;assert.ok(out.data[b]-out.data[a]>.35);}
  assert.deepEqual(source.data,before);assert.deepEqual(out,reduceNoise(source,100,0));
});
test('standard color reduction lowers chroma noise independently of luminance',()=>{
  const source=fixture(true),out=reduceNoise(source,0,100);assert.ok(mse(out,true)<mse(source,true)*.35);
  for(let i=0;i<source.data.length;i+=4)assert.ok(Math.abs(luma(...source.data.slice(i,i+3) as unknown as [number,number,number])-luma(...out.data.slice(i,i+3) as unknown as [number,number,number]))<1e-7);
});
test('zero settings are exact; alpha and HDR headroom remain intact without transparent color bleed',()=>{
  const source=fixture();assert.equal(reduceNoise(source,0,0),source);
  source.data.fill(2.5);for(let i=3;i<source.data.length;i+=4)source.data[i]=1;
  source.data[0]=100;source.data[1]=-100;source.data[2]=20;source.data[3]=0;source.data[7]=.5;
  const out=reduceNoise(source,100,100);for(let i=4;i<out.data.length;i+=4){assert.ok(Math.abs(out.data[i]-2.5)<1e-6);assert.equal(out.data[i+3],source.data[i+3]);}assert.deepEqual(out.data.slice(0,4),source.data.slice(0,4));
});
test('standard sliders feed the regular development and export rendering graph',()=>{
  const source=fixture(),recipe=defaultRecipe();recipe.values.noise=80;recipe.values.colorNoise=60;
  assert.deepEqual(renderPhoto(source,recipe,65535).data,reduceNoise(source,80,60).data);
  assert.notDeepEqual(renderPhoto(source,recipe).data,renderPhoto(source,defaultRecipe()).data);
});
