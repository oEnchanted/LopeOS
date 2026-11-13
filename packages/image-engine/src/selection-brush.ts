import {TILE,layer,surface,identity,type ImageDocument,type Point} from './model.ts';
import {BrushStroke,type BrushSettings} from './pixels.ts';
/** A transient tile view lets Quick Mask paint without allocating a full RGBA mask. */
export class SelectionStroke{
  readonly layerId:string;private stroke:BrushStroke;private selection:Uint8Array;private document:ImageDocument;
  constructor(document:ImageDocument,settings:BrushSettings){
    this.document=document;
    this.layerId=document.activeIds[0];this.selection=document.selection?.slice()||new Uint8Array(document.width*document.height).fill(255);
    const source=surface(document.width,document.height,[255,255,255,255]);const original=document.selection;
    if(original)source.tiles=new Proxy(source.tiles,{get(target,key:string){if(typeof key!=='string'||!/^\d+,\d+$/.test(key))return undefined;if(target[key])return target[key];const [tx,ty]=key.split(',').map(Number),tile=new Uint8ClampedArray(TILE*TILE*4);for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){const dx=tx*TILE+x,dy=ty*TILE+y,p=(y*TILE+x)*4,value=dx<document.width&&dy<document.height?original[dy*document.width+dx]:0;tile[p]=tile[p+1]=tile[p+2]=value;tile[p+3]=255;}return target[key]=tile;}});
    const virtual={...layer('Quick Mask'),mask:{pixels:source,transform:identity(),linked:true,enabled:true}};
    this.stroke=new BrushStroke({...document,layers:[virtual],activeIds:[virtual.id],target:'mask',selection:null},{...settings,retouch:undefined,clone:undefined});
  }
  add(point:Point){this.stroke.add(point);}
  preview(){for(const [key,tile]of Object.entries(this.stroke.writer.value.tiles)){const [tx,ty]=key.split(',').map(Number);for(let y=0;y<TILE&&ty*TILE+y<this.document.height;y++)for(let x=0;x<TILE&&tx*TILE+x<this.document.width;x++)this.selection[(ty*TILE+y)*this.document.width+tx*TILE+x]=tile[(y*TILE+x)*4];}return {...this.document,selection:this.selection};}
  finish(){this.stroke.finish();return this.preview();}
}
