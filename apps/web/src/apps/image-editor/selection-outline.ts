import type { ImageDocument } from '../../../../../packages/image-engine/src';
const outlines=new WeakMap<Uint8Array,{width:number;height:number;path:Path2D}>();
export function selectionOutline(doc:ImageDocument):Path2D|null{
  const selection=doc.selection;if(!selection)return null;const cached=outlines.get(selection);if(cached&&cached.width===doc.width&&cached.height===doc.height)return cached.path;
  const path=new Path2D();for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++)if(selection[y*doc.width+x]>127){
    if(y===0||selection[(y-1)*doc.width+x]<=127){path.moveTo(x,y);path.lineTo(x+1,y);}if(y===doc.height-1||selection[(y+1)*doc.width+x]<=127){path.moveTo(x,y+1);path.lineTo(x+1,y+1);}if(x===0||selection[y*doc.width+x-1]<=127){path.moveTo(x,y);path.lineTo(x,y+1);}if(x===doc.width-1||selection[y*doc.width+x+1]<=127){path.moveTo(x+1,y);path.lineTo(x+1,y+1);}}
  outlines.set(selection,{width:doc.width,height:doc.height,path});return path;
}
