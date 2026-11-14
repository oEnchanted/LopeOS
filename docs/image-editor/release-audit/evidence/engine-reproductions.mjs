import {writeFile} from 'node:fs/promises';
import * as before from "/private/tmp/lope-engine-before-qvncuw0v/packages/image-engine/src/index.ts";
import * as after from "/private/tmp/lopeos-photoshop-audit/packages/image-engine/src/index.ts";
function probe(e){
 const doc=e.newDocument(8,8,'bucket',[0,0,0,0]);
 const count=d=>{const p=e.compositePixels(d);let n=0;for(let at=3;at<p.length;at+=4)if(p[at])n++;return n;};
 const bucket=count(e.paintFill(doc,'#ff0000',{x:-1,y:1}));
 const scaled=e.newDocument(8,8,'scaled',[0,0,0,0]);scaled.layers[0]={...scaled.layers[0],pixels:e.surface(32,32,[240,80,20,255]),transform:{...e.identity(),scaleX:.25,scaleY:.25}};
 const mask=e.addMask(scaled),masked={dimensions:[mask.layers[0].mask.pixels.width,mask.layers[0].mask.pixels.height],visiblePixels:count(mask)};
 const left={...e.layer('left'),pixels:e.surface(10,10),transform:{...e.identity(),x:10}},right={...e.layer('right'),pixels:e.surface(10,10),transform:{...e.identity(),x:40}},group={...e.layer('group','group'),children:[left,right]};
 const aligned=e.alignLayers({...e.newDocument(100,100),layers:[group],activeIds:[group.id,right.id]},'left');
 const positions=[e.findLayer(aligned,left.id).transform.x,e.findLayer(aligned,right.id).transform.x];
 const corrupt={};for(const [name,change]of [['missing transform x',d=>delete d.layers[0].transform.x],['missing paths',d=>delete d.paths],['non-array guides',d=>d.guides={}],['unknown active layer',d=>d.activeIds=['missing']],['invalid adjustment',d=>d.layers[0].filters=[{}]],['invalid raster filter',d=>d.layers[0].rasterFilters=[null]],['invalid effect',d=>d.layers[0].effects=[null]]]){const p=JSON.parse(e.serializeDocument(doc));change(p.document);try{e.deserializeDocument(JSON.stringify(p));corrupt[name]='ACCEPTED';}catch(error){corrupt[name]=error.message;}}
 const soft=e.newDocument(3,1,'soft',[30,60,90,255]);soft.selection=new Uint8Array([64,255,64]);const copied=e.copyRendered(soft,e.compositePixels(soft));
 const copiedState={width:copied.pixels.width,pixels:[...e.surfacePixels(copied.pixels)]};
 const withMask=e.addMask(doc),removed=e.updateLayer(withMask,withMask.activeIds[0],l=>({...l,mask:undefined}));const brush=new e.BrushStroke(removed,{size:1,hardness:1,opacity:1,flow:1,spacing:.1,color:'#ff0000',pressure:false});brush.add({x:3,y:3});const painted=brush.finish();
 return {bucketOpaquePixels:bucket,scaledMask:masked,alignedChildX:positions,corruptNative:corrupt,featheredCopy:copiedState,maskDeletion:{target:removed.target,paintedPixel:e.pixel(e.findLayer(painted).pixels,3,3)}};
}
await writeFile("/private/tmp/lopeos-photoshop-audit/docs/image-editor/release-audit/evidence/engine-reproductions.json",JSON.stringify({before:probe(before),after:probe(after)},null,2)+'\n');
