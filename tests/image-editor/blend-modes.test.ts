import test from 'node:test';
import assert from 'node:assert/strict';
import {BLEND_MODES,BrushStroke,blendBuffers,blendPixel,blendRGB,deserializeDocument,findLayer,newDocument,pixel,serializeDocument,surface,type BlendMode} from '../../packages/image-engine/src/index.ts';
import {exportPsd,importPsd} from '../../packages/image-engine/src/psd.ts';
const modes:BlendMode[]=['linear burn','linear dodge','darker color','lighter color','vivid light','linear light','pin light','hard mix','subtract','divide'];
test('ten additional blend equations match hand-calculated RGB fixtures',()=>{
  const expected=[[0,0,.4],[1,.75,1],[.2,.5,.8],[.8,.25,.6],[.5,0,1],[.8,0,1],[.6,.5,.8],[1,0,1],[0,.25,.2],[.25,1,1]];
  modes.forEach((mode,i)=>blendRGB([.2,.5,.8],[.8,.25,.6],mode).forEach((value,c)=>assert.ok(Math.abs(value-expected[i][c])<1e-10,`${mode}, channel ${c}: ${value}`)));
  for(const mode of modes)for(const b of [0,.5,1])for(const s of [0,.5,1])assert.ok(blendRGB([b,b,b],[s,s,s],mode).every(v=>Number.isFinite(v)&&v>=0&&v<=1),mode);
  assert.deepEqual(blendRGB([0,.2,1],[0,0,0],'divide'),[1,1,1]);
});
test('Hard Mix threshold and whole-color ties remain stable at every RGB/8 boundary',()=>{
  for(let i=0;i<256;i++){assert.deepEqual(blendRGB([i/255,i/255,i/255],[(255-i)/255,(255-i)/255,(255-i)/255],'hard mix'),[1,1,1]);for(const mode of ['darker color','lighter color'] as const)assert.deepEqual(blendRGB([i/255,(255-i)/255,0],[0,i/255,(255-i)/255],mode),[i/255,(255-i)/255,0]);}
});
test('Canvas buffer fallback agrees with scalar alpha compositing without mutating the source',()=>{
  for(const mode of modes)for(const alpha of [0,32,128,255])for(const opacity of [0,.3,1]){
    const back=new Uint8ClampedArray([51,128,204,alpha]),front=new Uint8ClampedArray([204,64,153,177]),original=front.slice(),expected=new Uint8ClampedArray(blendPixel([...back] as [number,number,number,number],[...front] as [number,number,number,number],opacity,mode));
    blendBuffers(back,front,opacity,mode);assert.deepEqual(back,expected,`${mode}, alpha ${alpha}, opacity ${opacity}`);assert.deepEqual(front,original);
  }
});
test('brushes share all new blend equations and preserve prior source pixels',()=>{
  for(const mode of modes){const doc=newDocument(8,8,'Brush blend',[51,128,204,128]);doc.layers[0].locked=false;const stroke=new BrushStroke(doc,{size:1,hardness:1,opacity:.4,flow:1,spacing:.1,color:'#cc4099',pressure:false,blend:mode});stroke.add({x:4,y:4});const actual=pixel(findLayer(stroke.finish())!.pixels!,4,4),expected=blendPixel([51,128,204,128],[204,64,153,255],.4,mode);actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<=1,`${mode}, channel ${i}`));assert.deepEqual(pixel(doc.layers[0].pixels!,4,4),[51,128,204,128]);}
});
test('all 26 blend names round trip through native and PSD layer records',()=>{
  assert.equal(BLEND_MODES.length,26);assert.equal(BLEND_MODES.indexOf('exclusion'),15);
  for(const mode of BLEND_MODES){const doc=newDocument(2,2,mode,[51,128,204,255]);doc.layers[0].blend=mode;doc.layers[0].pixels=surface(2,2,[51,128,204,255]);assert.equal(deserializeDocument(serializeDocument(doc)).layers[0].blend,mode);assert.equal(importPsd(exportPsd(doc)).document.layers[0].blend,mode);}
});
