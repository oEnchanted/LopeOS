import { addLayer, findLayer, identity, layer, maskTransform, surface, toDocument, updateLayer, type ImageDocument, type Point, type Surface } from './model.ts';
import { SurfaceWriter, pixel } from './pixels.ts';
import { selectionBounds } from './selection.ts';
export type PixelClipboard={pixels:Surface;origin:Point;resolution:number};
export function copyRendered(doc:ImageDocument,rgba:Uint8ClampedArray,bounds?:{x:number;y:number;width:number;height:number}):PixelClipboard{
  const selection=doc.selection?selectionBounds(doc):null;if(doc.selection&&!selection)throw new Error('The selection is empty.');
  const area=selection||bounds||{x:0,y:0,width:doc.width,height:doc.height};const x=Math.max(0,Math.floor(area.x)),y=Math.max(0,Math.floor(area.y)),width=Math.min(doc.width-x,Math.ceil(area.width)),height=Math.min(doc.height-y,Math.ceil(area.height));
  if(width<1||height<1)throw new Error('There are no pixels to copy.');const writer=new SurfaceWriter(surface(width,height));
  for(let row=0;row<height;row++)for(let column=0;column<width;column++){const at=((row+y)*doc.width+column+x)*4;const alpha=rgba[at+3]*(doc.selection?doc.selection[(row+y)*doc.width+column+x]/255:1);if(alpha)writer.set(column,row,[rgba[at],rgba[at+1],rgba[at+2],alpha]);}
  return {pixels:writer.value,origin:{x,y},resolution:doc.resolution};
}
export function clearPixels(doc:ImageDocument):ImageDocument{
  const active=findLayer(doc);if(!active||active.locked)throw new Error('Select an unlocked pixel layer or layer mask.');const mask=doc.target==='mask'&&active.mask;
  if(!mask&&active.kind!=='raster')throw new Error('Rasterize this layer before deleting pixels.');const source=mask?mask.pixels:active.pixels||surface(doc.width,doc.height);
  if(!doc.selection){const pixels=surface(source.width,source.height,mask?[255,255,255,255]:[0,0,0,0]);return updateLayer(doc,active.id,l=>mask?{...l,mask:{...mask,pixels}}:{...l,pixels});}
  const writer=new SurfaceWriter(source),transform=mask?maskTransform(active):active.transform;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const point=toDocument({x:x+.5,y:y+.5},transform),dx=Math.floor(point.x),dy=Math.floor(point.y);const amount=dx>=0&&dy>=0&&dx<doc.width&&dy<doc.height?doc.selection[dy*doc.width+dx]/255:0;if(!amount)continue;const rgba=pixel(source,x,y);if(mask){const value=rgba[0]+(255-rgba[0])*amount;writer.set(x,y,[value,value,value,255]);}else writer.set(x,y,[rgba[0],rgba[1],rgba[2],rgba[3]*(1-amount)]);}
  return updateLayer(doc,active.id,l=>mask?{...l,mask:{...mask,pixels:writer.value}}:{...l,pixels:writer.value});
}
export function pastePixels(doc:ImageDocument,clipboard:PixelClipboard,inPlace=false):ImageDocument{
  const selected=selectionBounds(doc);const area=selected||{x:0,y:0,width:doc.width,height:doc.height};const origin=inPlace?clipboard.origin:{x:Math.round(area.x+(area.width-clipboard.pixels.width)/2),y:Math.round(area.y+(area.height-clipboard.pixels.height)/2)};
  return {...addLayer(doc,{...layer('Pasted Layer'),pixels:clipboard.pixels,transform:{...identity(),x:origin.x,y:origin.y}}),selection:null};
}
