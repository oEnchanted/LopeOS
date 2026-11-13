import { TILE, allLayers, maskTransform, toLocal, type ImageDocument, type Layer, type Surface, type Transform } from './model.ts';
import { linkSurfaceParent, parentSurface, tileRevision, touchTile } from './pixels.ts';
import {matrixOf,multiply,transformOf} from './matrix.ts';
export type RenderViewport={x:number;y:number;width:number;height:number;scale:number};
export function expandedViewport(doc:ImageDocument,view:RenderViewport):RenderViewport{
  let padding=0;for(const layer of allLayers(doc.layers)){if(!layer.visible)continue;const scale=Math.max(Math.abs(layer.transform.scaleX),Math.abs(layer.transform.scaleY));const filters=layer.rasterFilters?.filter(f=>f.enabled!==false).reduce((sum,f)=>sum+(['gaussian-blur','unsharp-mask','high-pass'].includes(f.type)?f.radius*3+2:['box-blur','motion-blur','mosaic'].includes(f.type)?f.radius+2:['sharpen','emboss','find-edges'].includes(f.type)?2:0)*scale,0)||0;const effects=Math.max(0,...layer.effects.map(e=>e.size*3+Math.abs(e.x)+Math.abs(e.y)));padding=Math.max(padding,filters+effects);}
  const pad=Math.ceil(padding*view.scale)/view.scale,x=Math.max(0,view.x-pad),y=Math.max(0,view.y-pad),right=Math.min(doc.width,view.x+view.width+pad),bottom=Math.min(doc.height,view.y+view.height+pad);return {...view,x,y,width:right-x,height:bottom-y};
}
export function viewportDocument(doc:ImageDocument,view:RenderViewport):ImageDocument{
  const transform=(t:Transform):Transform=>({...t,x:(t.x-view.x)*view.scale,y:(t.y-view.y)*view.scale,scaleX:t.scaleX*view.scale,scaleY:t.scaleY*view.scale});
  const walk=(items:Layer[]):Layer[]=>items.map(item=>({...item,transform:transform(item.transform),rasterFilters:item.rasterFilters?.map(f=>({...f,origin:{x:view.x*view.scale,y:view.y*view.scale}})),...(item.mask&&!item.mask.linked?{mask:{...item.mask,transform:transform(item.mask.transform)}}:{}),effects:item.effects.map(e=>({...e,size:e.size*view.scale,x:e.x*view.scale,y:e.y*view.scale})),...(item.children?{children:walk(item.children)}:{})}));
  return {...doc,width:Math.max(1,Math.ceil(view.width*view.scale)),height:Math.max(1,Math.ceil(view.height*view.scale)),layers:walk(doc.layers),selection:null,savedSelections:undefined,quickMask:undefined,paths:[],guides:[],original:undefined};
}
export function sourceRegion(surface:Surface,transform:Transform,view:RenderViewport,padding=128){
  const points=[{x:view.x-padding,y:view.y-padding},{x:view.x+view.width+padding,y:view.y-padding},{x:view.x-padding,y:view.y+view.height+padding},{x:view.x+view.width+padding,y:view.y+view.height+padding}].map(p=>toLocal(p,transform));
  const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))/TILE)*TILE),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))/TILE)*TILE);
  const right=Math.min(surface.width,Math.ceil(Math.max(...points.map(p=>p.x))/TILE)*TILE),bottom=Math.min(surface.height,Math.ceil(Math.max(...points.map(p=>p.y))/TILE)*TILE);
  return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
type SurfaceRecord={id:string;parent?:string;width:number;height:number;base:Surface['base'];tiles:Record<string,string>};
export type ScenePacket={document:any;surfaces:SurfaceRecord[];assets:{id:string;version:number;data:Uint8ClampedArray}[];viewport:RenderViewport;bytes:number};
/** Main-to-worker messages contain metadata and new/changed visible tiles only. */
export class SceneEncoder{
  private ids=new WeakMap<object,string>();private sent=new Map<string,number>();private sequence=0;
  private id(value:object){let id=this.ids.get(value);if(!id){id=String(++this.sequence);this.ids.set(value,id);}return id;}
  pack(doc:ImageDocument,viewport:RenderViewport){
    const sampling=expandedViewport(doc,viewport);
    const surfaces:SurfaceRecord[]=[],assets:ScenePacket['assets']=[],used=new Set<string>(),seen=new Map<Surface,SurfaceRecord>();
    const surface=(value:Surface,t:Transform)=>{
      let record=seen.get(value);if(!record){const parent=parentSurface(value);record={id:this.id(value),parent:parent?this.id(parent):undefined,width:value.width,height:value.height,base:value.base,tiles:{}};seen.set(value,record);surfaces.push(record);}
      const region=sourceRegion(value,t,sampling);for(let ty=Math.floor(region.y/TILE);ty<Math.ceil((region.y+region.height)/TILE);ty++)for(let tx=Math.floor(region.x/TILE);tx<Math.ceil((region.x+region.width)/TILE);tx++){
        const key=`${tx},${ty}`,tile=value.tiles[key];if(!tile)continue;const id=this.id(tile);record.tiles[key]=id;const version=tileRevision(tile);if(!used.has(id)&&this.sent.get(id)!==version){assets.push({id,version,data:tile.slice()});this.sent.set(id,version);}used.add(id);
      }return {$surface:record.id};
    };
    const walk=(items:Layer[],visible=true):any[]=>items.map(item=>{const shown=visible&&item.visible;return {...item,embeddedAsset:undefined,pixels:shown&&item.pixels?surface(item.pixels,item.transform):undefined,source:shown&&item.source?surface(item.source,item.transform):undefined,mask:shown&&item.mask?{...item.mask,pixels:surface(item.mask.pixels,maskTransform(item))}:undefined,rasterFilters:item.rasterFilters?.map(filter=>({...filter,mask:shown&&filter.mask?{...filter.mask,pixels:surface(filter.mask.pixels,transformOf(multiply(matrixOf(item.transform),matrixOf(filter.mask.transform))))}:undefined})),children:item.children?walk(item.children,shown):undefined};});
    const document={...doc,original:undefined,icc:undefined,selection:null,savedSelections:undefined,quickMask:undefined,paths:[],guides:[],layers:walk(doc.layers)};
    for(const id of this.sent.keys())if(!used.has(id))this.sent.delete(id);
    const packet:ScenePacket={document,surfaces,assets,viewport,bytes:assets.reduce((sum,asset)=>sum+asset.data.byteLength,0)};return {packet,transfer:assets.map(asset=>asset.data.buffer)};
  }
  reset(){this.sent.clear();}
}
export class SceneDecoder{
  private assets=new Map<string,Uint8ClampedArray>();private surfaces=new Map<string,Surface>();
  apply(packet:ScenePacket){
    for(const asset of packet.assets){touchTile(asset.data);this.assets.set(asset.id,asset.data);}const used=new Set<string>(),surfaceIds=new Set<string>();
    for(const record of packet.surfaces){surfaceIds.add(record.id);let value=this.surfaces.get(record.id);if(!value){value={width:record.width,height:record.height,base:record.base,tiles:{}};const parent=record.parent&&this.surfaces.get(record.parent);if(parent)linkSurfaceParent(value,parent);this.surfaces.set(record.id,value);}value.base=record.base;const tiles:Surface['tiles']={};for(const [key,id]of Object.entries(record.tiles)){const tile=this.assets.get(id);if(!tile)throw new Error('A preview tile was not received.');tiles[key]=tile;used.add(id);}value.tiles=tiles;}
    const walk=(items:any[]):Layer[]=>items.map(item=>({...item,pixels:item.pixels?this.surfaces.get(item.pixels.$surface):undefined,source:item.source?this.surfaces.get(item.source.$surface):undefined,mask:item.mask?{...item.mask,pixels:this.surfaces.get(item.mask.pixels.$surface)!}:undefined,rasterFilters:item.rasterFilters?.map((filter:any)=>({...filter,mask:filter.mask?{...filter.mask,pixels:this.surfaces.get(filter.mask.pixels.$surface)!}:undefined})),children:item.children?walk(item.children):undefined}));
    const doc={...packet.document,layers:walk(packet.document.layers)} as ImageDocument;
    for(const id of this.assets.keys())if(!used.has(id))this.assets.delete(id);for(const id of this.surfaces.keys())if(!surfaceIds.has(id))this.surfaces.delete(id);return doc;
  }
}
