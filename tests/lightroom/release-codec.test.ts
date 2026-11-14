import { test } from 'node:test';
import { png, u16, u32, tiffRgba } from './release-codec-fixtures.ts';
import assert from 'node:assert/strict';
import { decodePng16 } from '../../packages/photo-engine/src/png.ts';
import { decodeTiff, encodeTiff, srgbToLinear } from '../../packages/photo-engine/src/tiff.ts';

test('PNG16 grayscale tRNS compares the full 16-bit sample and preserves transparency',async()=>{
  const result=await decodePng16(png(0,[0x1234,0x1235],[{name:'tRNS',data:u16(0x1234)}]));
  assert.equal(result.data[3],0);assert.equal(result.data[7],1);assert.ok(Math.abs(result.data[0]-srgbToLinear(0x1234/65535))<1e-8);
});
test('PNG16 RGB tRNS requires all three channels to match',async()=>{
  const result=await decodePng16(png(2,[1000,2000,3000,1000,2000,3001],[{name:'tRNS',data:u16(1000,2000,3000)}]));
  assert.equal(result.data[3],0);assert.equal(result.data[7],1);
});
for(const [label,codes] of [['PQ transfer',[1,16,0,1]],['HLG transfer',[1,18,0,1]],['narrow range',[1,13,0,0]],['RGB matrix mismatch',[1,13,1,1]]] as const){
  test(`PNG16 rejects unsupported ${label} instead of silently interpreting it as sRGB`,async()=>{
    await assert.rejects(decodePng16(png(2,[1000,2000,3000],[{name:'cICP',data:Uint8Array.from(codes)}])),/color transform|range|matrix|characteristics/);
  });
}
test('PNG16 honors sRGB cICP precedence over lower-precedence color metadata',async()=>{
  const result=await decodePng16(png(2,[1000,2000,3000],[{name:'gAMA',data:u32(100000)},{name:'cICP',data:new Uint8Array([1,13,0,1])}]));
  assert.ok(Math.abs(result.data[0]-srgbToLinear(1000/65535))<1e-8);
});
test('PNG16 rejects unsupported chromaticities when no higher-precedence sRGB declaration exists',async()=>{
  await assert.rejects(decodePng16(png(2,[1000,2000,3000],[{name:'cHRM',data:u32(31270,32900,68000,32000,26500,69000,15000,6000)}])),/color transform|chromatic/);
});
test('PNG16 accepts the standard sRGB chromaticities',async()=>{
  const result=await decodePng16(png(2,[1000,2000,3000],[{name:'cHRM',data:u32(31270,32900,64000,33000,30000,60000,15000,6000)}]));
  assert.ok(Math.abs(result.data[0]-srgbToLinear(1000/65535))<1e-8);
});
function changeTiffTag(bytes:Uint8Array,tag:number,value:number){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint16(8,true);
  for(let i=0;i<count;i++){const p=10+i*12;if(view.getUint16(p,true)===tag){view.setUint32(p+4,1,true);view.setUint32(p+8,value,true);return;}}
  throw new Error('Fixture tag missing');
}
test('TIFF rejects RGB data with fewer than three samples per pixel',()=>{
  const bytes=encodeTiff({width:2,height:1,data:new Float32Array([.1,.2,.3,1,.4,.5,.6,1])},16);changeTiffTag(bytes,277,2);
  assert.throws(()=>decodeTiff(bytes),/variant|samples|channels/);
});
test('TIFF rejects absent strip byte counts rather than reading bytes outside the declared strip',()=>{
  const bytes=encodeTiff({width:1,height:1,data:new Float32Array([.1,.2,.3,1])},16),view=new DataView(bytes.buffer),count=view.getUint16(8,true);
  for(let i=0;i<count;i++){const p=10+i*12;if(view.getUint16(p,true)===279)view.setUint16(p,65000,true);}
  assert.throws(()=>decodeTiff(bytes),/strip/);
});
test('TIFF associated alpha is unpremultiplied before conversion to linear RGB',()=>{
  const {image}=decodeTiff(tiffRgba(1));
  assert.ok(Math.abs(image.data[0]-srgbToLinear(13107/32768))<1e-7);
  assert.ok(Math.abs(image.data[3]-32768/65535)<1e-7);
});
test('TIFF unassociated alpha preserves the unmultiplied color samples',()=>{
  const {image}=decodeTiff(tiffRgba(2));
  assert.ok(Math.abs(image.data[0]-srgbToLinear(13107/65535))<1e-7);
  assert.ok(Math.abs(image.data[3]-32768/65535)<1e-7);
});
test('TIFF unspecified extra data is not silently interpreted as transparency',()=>{
  const {image}=decodeTiff(tiffRgba(0));assert.equal(image.data[3],1);
});
test('TIFF associated transparent pixels have zero color rather than division artifacts',()=>{
  const {image}=decodeTiff(tiffRgba(1,[0,0,0,0]));assert.deepEqual([...image.data],[0,0,0,0]);
});
