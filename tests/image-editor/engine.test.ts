import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BrushStroke, History, SurfaceWriter, addLayer, addMask, alignLayers, blendPixel, compositePixels, createTextLayer, cropDocument, deserializeDocument, documentMemory, duplicateLayer, embedLayer, feather, findLayer, groupLayers, identity, layer, maskTransform, newDocument, newPixelLayer, paintFill, pixel, reorderLayer, resetSourceTransform, resizeCanvas, resizeImage, selectPolygon, selectShape, selectTolerance, serializeDocument, setMaskLinked, straightenDocument, surface, updateLayer } from '../../packages/image-engine/src/index.ts';
import { exportPsd, importPsd, psdCompatibility } from '../../packages/image-engine/src/psd.ts';
import { readPsd } from '../../packages/image-engine/node_modules/ag-psd/dist/index.js';
const blank = (width = 32, height = 24) => newDocument(width,height,'Test',[0,0,0,0]);
const settings = { size: 9, hardness: 1, opacity: 1, flow: 1, spacing: .1, color: '#ff0000', pressure: false };
function stroke(doc: ReturnType<typeof blank>, points = [{x:10,y:10}], options = {}) { const brush = new BrushStroke(doc,{...settings,...options}); points.forEach(p => brush.add(p)); return brush.finish(); }
test('a stroke copies only touched tiles and never changes earlier document pixels', () => {
  const doc = blank(512,512); const next = stroke(doc); const original = findLayer(doc)!.pixels!; const output = findLayer(next)!.pixels!;
  assert.equal(Object.keys(original.tiles).length,0); assert.equal(Object.keys(output.tiles).length,1);
  assert.deepEqual(pixel(original,10,10),[0,0,0,0]); assert.deepEqual(pixel(output,10,10),[255,0,0,255]);
  const second = stroke(next,[{x:270,y:270}]); assert.equal(findLayer(second)!.pixels!.tiles['0,0'],output.tiles['0,0']);
});
test('brush opacity caps a stroke and flow builds gradually inside that cap', () => {
  const doc=blank(); const paint=new BrushStroke(doc,{...settings,opacity:.5,flow:.2}); paint.add({x:10,y:10});
  const first=pixel(findLayer(paint.preview())!.pixels!,10,10)[3]; assert.ok(first>=24 && first<=27);
  for(let i=0;i<20;i++) { paint.add({x:12,y:10}); paint.add({x:10,y:10}); }
  const next=paint.finish(); const alpha=pixel(findLayer(next)!.pixels!,10,10)[3]; assert.ok(alpha>=126 && alpha<=128);
  const twice=stroke(next,[{x:10,y:10}],{opacity:.5}); assert.ok(pixel(findLayer(twice)!.pixels!,10,10)[3]>185);
});
test('selection coverage constrains painting in document coordinates after transforms', () => {
  let doc=blank(); const id=doc.activeIds[0]; doc=updateLayer(doc,id,l=>({...l,transform:{...identity(),x:5,y:3,scaleX:2,scaleY:2}}));
  doc=selectShape(doc,{x:12,y:8},{x:18,y:16},'rectangle'); const next=stroke(doc,[{x:15,y:12}],{size:20}); const pixels=findLayer(next)!.pixels!;
  assert.equal(pixel(pixels,1,1)[3],0); assert.equal(pixel(pixels,5,4)[3],255); assert.equal(pixel(pixels,8,4)[3],0);
});
test('mask painting changes grayscale coverage while preserving layer pixels', () => {
  let doc=blank(); doc=paintFill(doc,'#ff8800'); const source=findLayer(doc)!.pixels; doc=addMask(doc);
  const next=stroke(doc,[{x:10,y:10}],{color:'#000000'}); assert.equal(findLayer(next)!.pixels,source); assert.equal(pixel(findLayer(next)!.mask!.pixels,10,10)[0],0);
  const data=compositePixels(next); assert.equal(data[(10*doc.width+10)*4+3],0); assert.equal(data[(0*doc.width+0)*4+3],255);
  const restored=stroke(next,[{x:10,y:10}],{color:'#ffffff'}); assert.equal(pixel(findLayer(restored)!.mask!.pixels,10,10)[0],255);
});
test('layer operations keep hierarchy, identity and source sharing intact', () => {
  let doc=stroke(blank()); const bottom=doc.activeIds[0]; doc=duplicateLayer(doc); const top=doc.activeIds[0];
  assert.notEqual(bottom,top); assert.equal(findLayer(doc,bottom)!.pixels,findLayer(doc,top)!.pixels);
  doc=reorderLayer(doc,bottom,top); assert.equal(doc.layers[1].id,bottom);
  doc={...doc,activeIds:[bottom,top]}; doc=groupLayers(doc); assert.equal(doc.layers.length,1); assert.equal(doc.layers[0].children!.length,2);
  const groupId=doc.activeIds[0]; doc=reorderLayer(doc,groupId,bottom,true); assert.equal(doc.layers[0].id,groupId);
  doc=updateLayer(doc,bottom,l=>({...l,visible:false})); assert.equal(findLayer(doc,bottom)!.visible,false);
});
test('blend equations and straight-alpha source-over match controlled RGB fixtures', () => {
  for(const [mode,expected] of [['multiply',[64,64,16]],['screen',[191,191,143]],['overlay',[128,128,32]],['darken',[128,128,32]],['lighten',[128,128,128]],['difference',[0,0,96]]] as const) {
    const output=blendPixel([128,128,128,255],[128,128,32,255],1,mode); output.slice(0,3).forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1,`${mode} ${i}: ${value}`));
  }
  assert.deepEqual(blendPixel([0,0,0,0],[255,30,10,128]),[255,30,10,128]);
  const result=blendPixel([0,0,255,128],[255,0,0,128]); assert.ok(Math.abs(result[0]-170.2)<1); assert.ok(Math.abs(result[2]-84.8)<1); assert.ok(Math.abs(result[3]-191.75)<1);
  for(const mode of ['hue','saturation','color','luminosity'] as const) assert.ok(blendPixel([80,130,200,255],[200,100,50,128],1,mode).every(Number.isFinite));
});
test('adjustment layers never mutate source pixels and pass-through groups differ from isolated groups', () => {
  let doc=blank(2,2); doc=paintFill(doc,'#808080'); const pixels=findLayer(doc)!.pixels;
  doc=addLayer(doc,{...layer('Brightness','adjustment'),adjustment:{type:'brightness',values:[30,0]}});
  assert.equal(doc.layers[0].pixels,pixels); assert.ok(compositePixels(doc)[0]>150);
  const multiply={...layer('Multiply'),pixels:surface(2,2,[128,128,128,255]),blend:'multiply' as const};
  const group={...layer('Group','group'),children:[multiply]};
  const pass={...doc,layers:[doc.layers[0],group]}; const isolated={...pass,layers:[doc.layers[0],{...group,blend:'normal' as const}]};
  assert.ok(compositePixels(pass)[0]<70); assert.equal(compositePixels(isolated)[0],128);
});
test('clipping layers respect the alpha of the base layer',()=>{
  let doc=blank(8,8);doc=selectShape(doc,{x:0,y:0},{x:4,y:8},'rectangle');doc=paintFill(doc,'#ff0000');
  doc=addLayer({...doc,selection:null},{...layer('Clipped'),pixels:surface(8,8,[0,0,255,255]),clipping:true});
  const data=compositePixels(doc);assert.equal(data[2],255);assert.equal(data[7*4+3],0);
  const partial={...blank(1,1),layers:[{...layer('Base'),pixels:surface(1,1,[255,0,0,128])},{...layer('Clip'),clipping:true,pixels:surface(1,1,[0,0,255,255])}]};assert.deepEqual([...compositePixels(partial)],[0,0,255,128]);
});
test('embedded objects can be scaled down and reset without losing original source pixels',()=>{
  let doc=stroke(blank());const original=findLayer(doc)!.pixels;doc=embedLayer(doc);doc=updateLayer(doc,doc.activeIds[0],l=>({...l,transform:{...identity(),scaleX:.1,scaleY:.1,rotation:30}}));doc=resetSourceTransform(doc);
  assert.equal(findLayer(doc)!.source,original);assert.deepEqual(findLayer(doc)!.transform,identity());
});
test('native save/reopen preserves editable text, masks, vectors, sources, selections and metadata',()=>{
  let doc=addMask(stroke(blank()));doc=createTextLayer(doc,{x:3,y:4},'Editable after reopening','#aabbcc');doc=selectPolygon(doc,[{x:0,y:0},{x:20,y:0},{x:10,y:20}]);doc.resolution=300;
  const reopened=deserializeDocument(serializeDocument(doc));assert.equal(findLayer(reopened)!.text!.content,'Editable after reopening');assert.equal(reopened.layers[0].mask!.pixels.base[0],255);assert.equal(reopened.resolution,300);assert.deepEqual(reopened.selection,doc.selection);assert.deepEqual(pixel(reopened.layers[0].pixels!,10,10),[255,0,0,255]);
  reopened.layers[1].text!.content='Changed';assert.equal(doc.layers[1].text!.content,'Editable after reopening');
  assert.throws(()=>deserializeDocument('{"format":"unknown","version":1}'),/supported/);
  assert.throws(()=>deserializeDocument(serializeDocument({...doc,selection:new Uint8Array(3)})),/selection mask/);
});
test('transaction history undoes and redoes pixels, masks, transforms and layer operations',()=>{
  const history=new History(blank());const names:string[]=[];
  const apply=(name:string,fn:(d:ReturnType<typeof blank>)=>ReturnType<typeof blank>)=>{names.push(name);history.commit(name,fn(history.current));};
  apply('Brush',d=>stroke(d));apply('Mask',d=>addMask(d));apply('Mask painting',d=>stroke(d,[{x:10,y:10}],{color:'#000000'}));apply('Transform',d=>updateLayer(d,d.activeIds[0],l=>({...l,transform:{...l.transform,x:5}})));apply('Duplicate',d=>duplicateLayer(d));
  const saved=serializeDocument(history.current);for(let i=0;i<names.length;i++)history.undo();assert.equal(Object.keys(findLayer(history.current)!.pixels!.tiles).length,0);assert.equal(history.dirty,false);for(let i=0;i<names.length;i++)history.redo();assert.equal(serializeDocument(history.current),saved);
  history.snapshot('Before');history.commit('New Layer',newPixelLayer(history.current));assert.equal(history.snapshots[0].document.layers.length,2);
});
test('selection operations include ellipse, polygon, tolerance, feather and additive modes',()=>{
  let doc=blank(12,12);doc=selectShape(doc,{x:2,y:2},{x:8,y:8},'ellipse');assert.equal(doc.selection![2*12+2],0);assert.equal(doc.selection![5*12+5],255);
  doc=selectShape(doc,{x:0,y:0},{x:3,y:3},'rectangle','add');assert.equal(doc.selection![0],255);
  doc=selectShape(doc,{x:0,y:0},{x:1,y:1},'rectangle','subtract');assert.equal(doc.selection![0],0);
  const soft=feather(doc,2);assert.ok(soft.selection!.some(v=>v>0&&v<255));
  const rgba=new Uint8ClampedArray(12*12*4);for(let i=0;i<rgba.length;i+=4)rgba.set([100,50,20,255],i);rgba.set([255,255,255,255],0);
  const tolerance=selectTolerance(doc,rgba,{x:0,y:0},2);assert.equal(tolerance.selection![0],255);assert.equal(tolerance.selection![1],0);
});
test('resize, crop and alignment keep editable sources and valid selection dimensions',()=>{
  let doc=selectShape(blank(),{x:3,y:3},{x:10,y:10},'rectangle');const original=findLayer(doc)!.pixels;
  doc=resizeImage(doc,64,48,300);assert.equal(doc.selection!.length,64*48);assert.equal(findLayer(doc)!.pixels,original);assert.equal(findLayer(doc)!.transform.scaleX,2);
  doc=cropDocument(doc,{x:4,y:5,width:20,height:20});assert.equal(doc.selection!.length,400);assert.equal(findLayer(doc)!.transform.x,-4);
  doc=resizeCanvas(doc,30,30);assert.equal(findLayer(doc)!.transform.x,1);doc=alignLayers(doc,'left');assert.equal(findLayer(doc)!.transform.x,0);
});
test('layered PSD writer/reader round trip preserves the supported editable structure',()=>{
  let doc=paintFill(blank(16,12),'#db6144');doc=addMask(doc);doc=stroke(doc,[{x:5,y:5}],{color:'#000000',size:3});
  doc=updateLayer(doc,doc.activeIds[0],l=>({...l,blend:'multiply',opacity:.8,fill:.7}));
  doc=createTextLayer(doc,{x:2,y:3},'Editable PSD');doc=addLayer(doc,{...layer('Brightness','adjustment'),adjustment:{type:'brightness',values:[12,5]}});
  const bytes=exportPsd(doc);assert.equal(String.fromCharCode(...bytes.slice(0,4)),'8BPS');
  const raw=readPsd(bytes,{useImageData:true,skipThumbnail:true});assert.equal(raw.children!.length,3);assert.equal(raw.children![1].text!.text,'Editable PSD');assert.ok(raw.children![0].mask!.imageData);
  const result=importPsd(bytes,'Roundtrip.psd');assert.equal(result.document.layers.length,3);assert.equal(result.document.layers[0].blend,'multiply');assert.ok(Math.abs(result.document.layers[0].fill-.7)<.01);assert.equal(result.document.layers[1].text!.content,'Editable PSD');assert.equal(result.document.layers[2].adjustment!.values[0],12);assert.ok(result.document.original!.data.length>0);
  assert.ok(psdCompatibility(result.document).length>0);
});
test('unsupported PSD depth and color are rejected without implicit conversion',()=>{
  const bytes=exportPsd(blank(2,2));const copy=bytes.slice();new DataView(copy.buffer).setUint16(22,16);assert.throws(()=>importPsd(copy,'16bit.psd'),/Only RGB, 8-bit/);
  const mode=bytes.slice();new DataView(mode.buffer).setUint16(24,4);assert.throws(()=>importPsd(mode,'CMYK.psd'),/not been converted/);
});
test('4096² layered painting uses sparse tiles and bounded transaction history',()=>{
  let doc=blank(4096,4096);for(let i=0;i<7;i++)doc=newPixelLayer(doc);
  const history=new History(doc,2*1024*1024);const before=performance.now();for(let i=0;i<24;i++)history.commit('Brush',stroke(history.current,[{x:100+i*130,y:100+i*100}],{size:20}));
  const elapsed=performance.now()-before;const memory=documentMemory(history.entries.map(e=>e.document));assert.ok(memory<4*1024*1024);assert.ok(elapsed<10000);assert.equal(history.current.layers.length,8);
});
test('fill preserves straight RGB at a feathered edge and gradients interpolate colors',()=>{
  let doc=blank(10,10);doc={...doc,selection:new Uint8Array(100).fill(128)};doc=paintFill(doc,'#ff0000');assert.deepEqual(pixel(findLayer(doc)!.pixels!,2,2),[255,0,0,128]);
  doc=paintFill({...doc,selection:null},'#ff0000',{x:0,y:0},32,{end:{x:9,y:0},background:'#0000ff'});assert.deepEqual(pixel(findLayer(doc)!.pixels!,0,0),[255,0,0,255]);assert.deepEqual(pixel(findLayer(doc)!.pixels!,9,0),[0,0,255,255]);
});
test('clone stamping samples the preserved source with the requested offset',()=>{
  const source=surface(16,16,[10,200,90,255]);const doc=blank(16,16);const next=stroke(doc,[{x:8,y:8}],{clone:{source,offset:{x:2,y:2}},size:5});assert.deepEqual(pixel(findLayer(next)!.pixels!,8,8),[10,200,90,255]);
});
test('straightening rotates editable geometry and continuous controls form one undo transaction',()=>{
  const doc=stroke(blank());const source=findLayer(doc)!.pixels;const next=straightenDocument(doc,15);assert.equal(findLayer(next)!.pixels,source);assert.equal(findLayer(next)!.transform.rotation,15);
  const history=new History(doc);history.commit('Opacity',updateLayer(doc,doc.activeIds[0],l=>({...l,opacity:.8})),'opacity');history.commit('Opacity',updateLayer(history.current,doc.activeIds[0],l=>({...l,opacity:.5})),'opacity');assert.equal(history.entries.length,2);assert.equal(findLayer(history.undo())!.opacity,1);assert.equal(findLayer(history.redo())!.opacity,.5);
});
test('vertical slice: import layered PSD, paint, mask, blend, save native and reopen editable',()=>{
  const source=addLayer(blank(),{...layer('Second layer'),pixels:surface(32,24,[20,50,80,255])});const bytes=exportPsd(source);let doc=importPsd(bytes,'Imported.psd').document;
  const id=doc.layers[1].id;doc={...doc,activeIds:[id]};doc=stroke(doc,[{x:10,y:10}]);doc=addMask(doc);doc=stroke(doc,[{x:10,y:10}],{color:'#000000'});doc=updateLayer(doc,id,l=>({...l,blend:'screen'}));
  const reopened=deserializeDocument(serializeDocument(doc));assert.equal(reopened.layers.length,2);assert.equal(findLayer(reopened)!.blend,'screen');assert.deepEqual(pixel(findLayer(reopened)!.pixels!,10,10),[255,0,0,255]);assert.equal(pixel(findLayer(reopened)!.mask!.pixels,10,10)[0],0);assert.ok(reopened.original!.data.length>0);
  const editable=stroke(reopened,[{x:10,y:10}],{color:'#ffffff'});assert.equal(pixel(findLayer(editable)!.mask!.pixels,10,10)[0],255);
});
test('unlink and relink preserve a mask world position and subsequent linked moves',()=>{
  let doc=addMask(blank());let item=findLayer(doc)!;item={...item,transform:{...identity(),x:8,y:5,scaleX:2,scaleY:2,rotation:15}};const before=maskTransform(item);item=setMaskLinked(item,false);assert.deepEqual(maskTransform(item),before);
  item={...item,transform:{...item.transform,x:25}};assert.deepEqual(maskTransform(item),before);item=setMaskLinked(item,true);const after=maskTransform(item);assert.ok(Math.abs(after.x-before.x)<.00001);assert.ok(Math.abs(after.y-before.y)<.00001);item={...item,transform:{...item.transform,x:30}};assert.ok(Math.abs(maskTransform(item).x-before.x-5)<.00001);
});
