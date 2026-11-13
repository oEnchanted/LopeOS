import type { Asset } from '../../../../../packages/photo-engine/src/model.ts';
export type GridCell={asset:Asset;left:number;top:number;width:number;height:number;imageHeight:number};
/** Justified photo rows retain natural aspect; square rows have fixed equal cells. */
export function layoutPhotos(assets:Asset[],width:number,size:number,square=false):{cells:GridCell[];height:number}{
  const gap=12,meta=34,cells:GridCell[]=[];let top=0;
  if(square){const columns=Math.max(1,Math.floor((width+gap)/(size+gap))),cell=(width-gap*(columns-1))/columns;assets.forEach((asset,index)=>cells.push({asset,left:index%columns*(cell+gap),top:Math.floor(index/columns)*(cell+meta+gap),width:cell,height:cell+meta,imageHeight:cell}));return {cells,height:Math.ceil(assets.length/columns)*(cell+meta+gap)};}
  let row:Asset[]=[],ratio=0;
  const aspect=(a:Asset)=>Math.max(.3,Math.min(3,a.metadata.width/a.metadata.height));
  const flush=(last=false)=>{if(!row.length)return;const height=Math.max(50,Math.min(last?size:size*1.5,(width-gap*(row.length-1))/ratio));let left=0;for(const asset of row){const cellWidth=height*aspect(asset);cells.push({asset,left,top,width:cellWidth,height:height+meta,imageHeight:height});left+=cellWidth+gap;}top+=height+meta+gap;row=[];ratio=0;};
  for(const asset of assets){row.push(asset);ratio+=aspect(asset);if(ratio*size+gap*(row.length-1)>=width)flush();}flush(true);return {cells,height:top};
}
