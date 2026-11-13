import { BLEND_MODES, TILE, clamp, identity, maskTransform, type ImageDocument, type Layer, type Surface } from './model.ts';
import { adjustRGB,blendBuffers } from './composite.ts';
import { parentSurface, surfacePixels, tileRevision } from './pixels.ts';
import { sourceRegion, viewportDocument, expandedViewport, type RenderViewport } from './preview.ts';
import { WebGLCompositor } from './gpu.ts';
import { filterPixels,mixFilteredPixels } from './filters.ts';
import { matrixOf,multiply,transformOf } from './matrix.ts';

export type Canvas = HTMLCanvasElement | OffscreenCanvas;
export function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
export function context2d(canvas: Canvas) { const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null; if (!context) throw new Error('A 2D canvas context is required.'); return context; }
const image = (data: Uint8ClampedArray, width: number, height: number) => new ImageData(new Uint8ClampedArray(data), width, height);
export function surfaceCanvas(surface: Surface) {
  const canvas = makeCanvas(surface.width, surface.height); const ctx = context2d(canvas);
  if (surface.base[3]) { ctx.fillStyle = `rgba(${surface.base[0]},${surface.base[1]},${surface.base[2]},${surface.base[3]/255})`; ctx.fillRect(0,0,surface.width,surface.height); }
  for (const [key,tile] of Object.entries(surface.tiles)) { const [tx,ty] = key.split(',').map(Number); ctx.putImageData(image(tile,TILE,TILE),tx*TILE,ty*TILE); }
  return canvas;
}
const operation = (mode: Layer['blend']): GlobalCompositeOperation => mode === 'normal' || mode === 'pass through' ? 'source-over' : mode.replaceAll(' ','-') as GlobalCompositeOperation;
const customModes=new Set<Layer['blend']>(['linear burn','linear dodge','darker color','lighter color','vivid light','linear light','pin light','hard mix','subtract','divide']);
function drawBlended(destination:Canvas,front:Canvas,opacity:number,mode:Layer['blend']){
  const ctx=context2d(destination);if(customModes.has(mode)){const back=ctx.getImageData(0,0,destination.width,destination.height),source=context2d(front).getImageData(0,0,front.width,front.height);blendBuffers(back.data,source.data,opacity,mode);ctx.putImageData(back,0,0);}else{ctx.save();ctx.globalAlpha=clamp(opacity);ctx.globalCompositeOperation=operation(mode);ctx.drawImage(front,0,0);ctx.restore();}
}
function applyTransform(ctx: ReturnType<typeof context2d>, layer: Layer) { ctx.transform(...matrixOf(layer.transform)); }
export function layerBounds(layer: Layer, doc: ImageDocument) {
  const source = layer.kind === 'embedded' ? layer.source : layer.kind === 'raster' ? layer.pixels : undefined;
  return { width: source?.width || layer.shape?.width || (layer.text ? Math.max(80, layer.text.content.length * layer.text.size * .58) : doc.width), height: source?.height || layer.shape?.height || (layer.text ? layer.text.content.split('\n').length * layer.text.size * layer.text.leading : doc.height) };
}
/** Current-frame cache is explicitly cleared between documents and bounded by 96 MiB. */
export class CanvasRenderer {
  private cache = new Map<string, { canvas:Canvas;bytes:number;serial:number;tiles:Map<string,{id:number;version:number}> }>();
  private ids=new WeakMap<object,number>();private nextId=0;
  private tileCache=new Map<Uint8ClampedArray,Map<string,{canvas:Canvas;bytes:number;version:number}>>();
  private tileOrder=new Map<Canvas,{tile:Uint8ClampedArray;key:string;bytes:number}>();private tileBytes=0;
  private contentCache=new Map<string,{signature:string;canvas:Canvas;bytes:number}>();private contentBytes=0;
  private bytes = 0;
  backend = 'Canvas 2D';
  fallbackReason?: string;
  private gpu?: WebGLCompositor;
  private gpuFailed = false;
  private preferGpu: boolean;
  constructor(options: { gpu?: boolean } = {}) { this.preferGpu = Boolean(options.gpu); }
  private objectId(value:object){let id=this.ids.get(value);if(!id){id=++this.nextId;this.ids.set(value,id);}return id;}
  private tileImage(tile:Uint8ClampedArray,level:number,mask:boolean){
    const key=`${level}/${mask}`,version=tileRevision(tile);let group=this.tileCache.get(tile);if(!group){group=new Map();this.tileCache.set(tile,group);}let entry=group.get(key);
    if(entry&&entry.version===version){const order=this.tileOrder.get(entry.canvas)!;this.tileOrder.delete(entry.canvas);this.tileOrder.set(entry.canvas,order);return entry.canvas;}
    const size=Math.max(1,Math.ceil(TILE*level));const canvas=entry?.canvas||makeCanvas(size,size);const ctx=context2d(canvas);const local=level===1?canvas:makeCanvas(TILE,TILE);const lc=context2d(local);let data=tile;
    if(mask){data=new Uint8ClampedArray(tile.length);for(let p=0;p<data.length;p+=4){data[p]=data[p+1]=data[p+2]=255;data[p+3]=tile[p];}}
    lc.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>,TILE,TILE),0,0);if(level!==1){ctx.clearRect(0,0,size,size);ctx.drawImage(local,0,0,size,size);local.width=local.height=0;}
    const bytes=size*size*4+tile.byteLength;if(!entry){entry={canvas,bytes,version};group.set(key,entry);this.tileBytes+=bytes;}else entry.version=version;
    this.tileOrder.delete(canvas);this.tileOrder.set(canvas,{tile,key,bytes});while(this.tileBytes>48*1024*1024&&this.tileOrder.size>1){const [old,info]=this.tileOrder.entries().next().value!;this.tileOrder.delete(old);this.tileCache.get(info.tile)?.delete(info.key);if(!this.tileCache.get(info.tile)?.size)this.tileCache.delete(info.tile);this.tileBytes-=info.bytes;old.width=old.height=0;}return canvas;
  }
  private getSurface(surface:Surface,layer:Layer,doc:ImageDocument,mask=false){
    const t=mask?maskTransform(layer):layer.transform;const region=sourceRegion(surface,t,{x:0,y:0,width:doc.width,height:doc.height,scale:1},Math.max(16,...layer.effects.map(e=>e.size+Math.abs(e.x)+Math.abs(e.y))));
    const level=Math.max(1/64,Math.min(1,2**Math.ceil(Math.log2(Math.max(Math.abs(t.scaleX),Math.abs(t.scaleY),1/64)))));const suffix=`${region.x},${region.y},${region.width},${region.height}/${level}/${mask}`,key=`${this.objectId(surface)}/${suffix}`;
    let entry=this.cache.get(key);if(!entry){const parent=parentSurface(surface);const parentKey=parent?`${this.objectId(parent)}/${suffix}`:'';const previous=this.cache.get(parentKey);if(previous){entry=previous;this.cache.delete(parentKey);this.cache.set(key,entry);}else{const width=Math.max(1,Math.ceil(region.width*level)),height=Math.max(1,Math.ceil(region.height*level));entry={canvas:makeCanvas(width,height),bytes:width*height*4,serial:0,tiles:new Map()};this.cache.set(key,entry);this.bytes+=entry.bytes;}}
    const ctx=context2d(entry.canvas);const base=mask?[255,255,255,surface.base[0]]:surface.base;let changed=false;
    for(let ty=Math.floor(region.y/TILE);ty<Math.ceil((region.y+region.height)/TILE);ty++)for(let tx=Math.floor(region.x/TILE);tx<Math.ceil((region.x+region.width)/TILE);tx++){
      const tileKey=`${tx},${ty}`,tile=surface.tiles[tileKey],previous=entry.tiles.get(tileKey);if(entry.serial&&(!tile&&!previous||tile&&previous?.id===this.objectId(tile)&&previous.version===tileRevision(tile)))continue;
      const x=(tx*TILE-region.x)*level,y=(ty*TILE-region.y)*level;ctx.clearRect(x,y,TILE*level,TILE*level);
      if(tile){ctx.drawImage(this.tileImage(tile,level,mask),x,y,TILE*level,TILE*level);entry.tiles.set(tileKey,{id:this.objectId(tile),version:tileRevision(tile)});}else{entry.tiles.delete(tileKey);if(base[3]){ctx.fillStyle=`rgba(${base[0]},${base[1]},${base[2]},${base[3]/255})`;ctx.fillRect(x,y,TILE*level,TILE*level);}}changed=true;
    }
    if(changed||!entry.serial)entry.serial++;this.cache.delete(key);this.cache.set(key,entry);while(this.bytes>96*1024*1024&&this.cache.size>1){const [old,value]=this.cache.entries().next().value!;this.cache.delete(old);this.bytes-=value.bytes;}
    return {...region,canvas:entry.canvas,signature:`${key}:${entry.serial}`};
  }
  invalidate(surface:Surface){const prefix=`${this.objectId(surface)}/`;for(const [key,value]of this.cache)if(key.startsWith(prefix)){this.cache.delete(key);this.bytes-=value.bytes;}}
  dispose(){for(const entry of this.cache.values())entry.canvas.width=entry.canvas.height=0;for(const canvas of this.tileOrder.keys())canvas.width=canvas.height=0;for(const entry of this.contentCache.values())entry.canvas.width=entry.canvas.height=0;this.cache.clear();this.tileOrder.clear();this.tileCache.clear();this.contentCache.clear();this.bytes=this.tileBytes=this.contentBytes=0;this.gpu?.dispose();this.gpu=undefined;}
  renderViewport(doc:ImageDocument,view:RenderViewport,target?:Canvas){const expanded=expandedViewport(doc,view);if(expanded.x===view.x&&expanded.y===view.y&&expanded.width===view.width&&expanded.height===view.height)return this.render(viewportDocument(doc,view),target);const rendered=this.render(viewportDocument(doc,expanded)),out=target||makeCanvas(Math.max(1,Math.ceil(view.width*view.scale)),Math.max(1,Math.ceil(view.height*view.scale)));out.width=Math.max(1,Math.ceil(view.width*view.scale));out.height=Math.max(1,Math.ceil(view.height*view.scale));context2d(out).drawImage(rendered,(expanded.x-view.x)*view.scale,(expanded.y-view.y)*view.scale);rendered.width=rendered.height=0;return out;}
  content(layer: Layer, doc: ImageDocument): Canvas {
    const source = layer.kind === 'embedded' ? layer.source : layer.kind === 'raster' ? layer.pixels : undefined;
    const raster=source?this.getSurface(source,layer,doc):undefined;const mask=layer.mask?.enabled?this.getSurface(layer.mask.pixels,layer,doc,true):undefined;
    const filterMasks=layer.rasterFilters?.map(filter=>{if(!filter.mask)return undefined;const transform=transformOf(multiply(matrixOf(layer.transform),matrixOf(filter.mask.transform)));return {transform,raster:this.getSurface(filter.mask.pixels,{...layer,mask:undefined,transform},doc,true)};});
    const filterSignatures=layer.rasterFilters?.map((filter,index)=>({...filter,mask:filterMasks?.[index]&&{transform:filterMasks[index]!.transform,signature:filterMasks[index]!.raster.signature}}));
    const signature=JSON.stringify([doc.width,doc.height,layer.transform,layer.text,layer.shape,layer.filters,filterSignatures,layer.effects,layer.fill,raster?.signature,mask?.signature,layer.mask&&[layer.mask.enabled,layer.mask.linked,layer.mask.transform,layer.mask.offset]]);
    const cached=this.contentCache.get(layer.id);if(cached?.signature===signature){this.contentCache.delete(layer.id);this.contentCache.set(layer.id,cached);return cached.canvas;}
    const out = makeCanvas(doc.width, doc.height); const ctx = context2d(out); ctx.save(); applyTransform(ctx, layer);
    if (raster&&raster.width&&raster.height) ctx.drawImage(raster.canvas,0,0,raster.canvas.width,raster.canvas.height,raster.x,raster.y,raster.width,raster.height);
    else if (layer.text) {
      const text = layer.text; ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? 'bold ' : ''}${text.size}px ${text.font}`; ctx.textBaseline = 'top'; ctx.fillStyle = text.color; ctx.textAlign = text.align;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${text.tracking}px`;
      text.content.split('\n').forEach((line, index) => ctx.fillText(line, 0, index * text.size * text.leading));
    } else if (layer.shape) {
      const shape = layer.shape; ctx.beginPath();
      if (shape.type === 'ellipse') ctx.ellipse(shape.width / 2, shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
      else if (shape.type === 'path' && shape.points?.length) { ctx.moveTo(shape.points[0].x, shape.points[0].y); shape.points.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath(); }
      else ctx.rect(0, 0, shape.width, shape.height);
      ctx.fillStyle = shape.fill; ctx.fill(); if (shape.strokeWidth) { ctx.lineWidth = shape.strokeWidth; ctx.strokeStyle = shape.stroke; ctx.stroke(); }
    }
    ctx.restore();
    if (layer.filters.length) this.adjust(out, layer.filters);
    if(layer.rasterFilters?.length){let pixels:Uint8ClampedArray=ctx.getImageData(0,0,out.width,out.height).data;for(let index=0;index<layer.rasterFilters.length;index++){const filter=layer.rasterFilters[index];if(filter.enabled===false)continue;const after=filterPixels(out.width,out.height,pixels,{...filter,radius:filter.radius*Math.max(Math.abs(layer.transform.scaleX),Math.abs(layer.transform.scaleY))}),filterMask=filterMasks?.[index];if(filterMask){const coverage=makeCanvas(doc.width,doc.height),mc=context2d(coverage),r=filterMask.raster;mc.transform(...matrixOf(filterMask.transform));if(r.width&&r.height)mc.drawImage(r.canvas,0,0,r.canvas.width,r.canvas.height,r.x,r.y,r.width,r.height);pixels=mixFilteredPixels(pixels,after,mc.getImageData(0,0,doc.width,doc.height).data);coverage.width=coverage.height=0;}else pixels=after;}ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels),out.width,out.height),0,0);}
    if (layer.mask?.enabled) {
      const maskCanvas = makeCanvas(doc.width, doc.height); const maskCtx = context2d(maskCanvas); maskCtx.save();
      maskCtx.transform(...matrixOf(maskTransform(layer)));
      if(mask&&mask.width&&mask.height)maskCtx.drawImage(mask.canvas,0,0,mask.canvas.width,mask.canvas.height,mask.x,mask.y,mask.width,mask.height);maskCtx.restore();
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(maskCanvas, 0, 0); ctx.globalCompositeOperation = 'source-over';
    }
    if (layer.effects.length || layer.fill !== 1) {
      const styled = makeCanvas(doc.width, doc.height); const sc = context2d(styled);
      for (const effect of layer.effects) {
        if (effect.type === 'shadow') { sc.save(); sc.globalAlpha = effect.opacity; sc.shadowColor = effect.color; sc.shadowBlur = effect.size; sc.shadowOffsetX = effect.x; sc.shadowOffsetY = effect.y; sc.drawImage(out, 0, 0); sc.globalCompositeOperation = 'destination-out'; sc.shadowColor = 'transparent'; sc.drawImage(out, 0, 0); sc.restore(); }
        if (effect.type === 'stroke') {
          const outline = makeCanvas(doc.width, doc.height); const oc = context2d(outline); const size = Math.min(30, effect.size);
          for (let i = 0; i < 16; i++) oc.drawImage(out, Math.cos(i / 16 * Math.PI * 2) * size, Math.sin(i / 16 * Math.PI * 2) * size);
          oc.globalCompositeOperation = 'source-in'; oc.fillStyle = effect.color; oc.fillRect(0, 0, doc.width, doc.height); sc.globalAlpha = effect.opacity; sc.drawImage(outline, 0, 0); sc.globalAlpha = 1;
        }
      }
      sc.globalAlpha = layer.fill; sc.drawImage(out, 0, 0); sc.globalAlpha = 1;
      for (const effect of layer.effects.filter(e => e.type === 'overlay')) { const overlay = makeCanvas(doc.width, doc.height); const oc = context2d(overlay); oc.drawImage(out, 0, 0); oc.globalCompositeOperation = 'source-in'; oc.fillStyle = effect.color; oc.fillRect(0, 0, doc.width, doc.height); sc.globalAlpha = effect.opacity * layer.fill; sc.drawImage(overlay, 0, 0); sc.globalAlpha = 1; }
      return this.rememberContent(layer.id,signature,styled);
    }
    return this.rememberContent(layer.id,signature,out);
  }
  private rememberContent(id:string,signature:string,canvas:Canvas){const bytes=canvas.width*canvas.height*4;const previous=this.contentCache.get(id);if(previous){this.contentBytes-=previous.bytes;this.contentCache.delete(id);}if(bytes<=64*1024*1024){while(this.contentBytes+bytes>64*1024*1024&&this.contentCache.size){const [key,value]=this.contentCache.entries().next().value!;this.contentCache.delete(key);this.contentBytes-=value.bytes;}this.contentCache.set(id,{signature,canvas,bytes});this.contentBytes+=bytes;}return canvas;}
  private adjust(canvas: Canvas, adjustments: NonNullable<Layer['filters']>, mask?: Canvas, opacity = 1) {
    const ctx = context2d(canvas); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); const coverage = mask ? context2d(mask).getImageData(0, 0, canvas.width, canvas.height).data : null;
    const independent=adjustments.every(a=>['brightness','levels','curves','balance','exposure','invert','posterize','photo-filter'].includes(a.type));
    if(independent){const tables=[new Float32Array(256),new Float32Array(256),new Float32Array(256)];for(let value=0;value<256;value++){let rgb:[number,number,number]=[value/255,value/255,value/255];for(const adjustment of adjustments)rgb=adjustRGB(rgb,adjustment);for(let c=0;c<3;c++)tables[c][value]=rgb[c]*255;}for(let at=0;at<pixels.data.length;at+=4){const amount=opacity*(coverage?coverage[at+3]/255:1);for(let c=0;c<3;c++)pixels.data[at+c]=pixels.data[at+c]*(1-amount)+tables[c][pixels.data[at+c]]*amount;}ctx.putImageData(pixels,0,0);return;}
    for (let at = 0; at < pixels.data.length; at += 4) {
      let rgb = [pixels.data[at] / 255, pixels.data[at + 1] / 255, pixels.data[at + 2] / 255] as [number, number, number];
      for (const adjustment of adjustments) rgb = adjustRGB(rgb, adjustment);
      const amount = opacity * (coverage ? coverage[at + 3] / 255 : 1);
      for (let c = 0; c < 3; c++) pixels.data[at + c] = pixels.data[at + c] * (1 - amount) + rgb[c] * 255 * amount;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  private coverage(item: Layer,doc: ImageDocument): Canvas | undefined {
    if(!item.mask?.enabled)return undefined;
    return this.content({...item,kind:'raster',pixels:{width:doc.width,height:doc.height,base:[255,255,255,255],tiles:{}},transform:identity(),mask:{...item.mask,linked:false,transform:maskTransform(item)},effects:[],filters:[],fill:1},doc);
  }
  render(doc: ImageDocument, target?: Canvas): Canvas {
    const out = target || makeCanvas(doc.width, doc.height); if (out.width !== doc.width) out.width = doc.width; if (out.height !== doc.height) out.height = doc.height;
    const ctx = context2d(out); ctx.clearRect(0, 0, out.width, out.height);
    if (this.preferGpu && !this.gpuFailed && !doc.layers.some(l => l.kind === 'group' || l.kind === 'adjustment' || l.clipping)) {
      try { this.gpu ||= new WebGLCompositor(); const layers = doc.layers.filter(l => l.visible && (l.kind !== 'raster' || l.effects.length || l.pixels && (l.pixels.base[3] || Object.keys(l.pixels.tiles).length))).map(item => ({ canvas: () => this.content(item,doc), opacity:item.opacity,blend:item.blend })); ctx.drawImage(this.gpu.render(doc.width,doc.height,layers),0,0); this.backend='WebGL2'; return out; }
      catch(error) { this.fallbackReason=error instanceof Error?error.message:'WebGL compositing failed';this.gpu?.dispose(); this.gpu=undefined; this.gpuFailed=true; }
    }
    this.backend='Canvas 2D';
    const walk = (layers: Layer[], destination: Canvas) => {
      const context = context2d(destination);
      for (let index=0;index<layers.length;index++) {
        const item=layers[index];
        if (!item.visible) continue;
        if(item.clipping)continue;
        const raster = item.kind === 'embedded' ? item.source : item.kind === 'raster' ? item.pixels : undefined;
        if ((item.kind === 'raster' || item.kind === 'embedded') && (!raster || !raster.base[3] && !Object.keys(raster.tiles).length) && !item.effects.length) continue;
        if (item.kind === 'adjustment' && item.adjustment) {
          const mask = this.coverage(item,doc);
          this.adjust(destination, [item.adjustment], mask, item.opacity * item.fill); continue;
        }
        if (item.kind === 'group' && item.blend === 'pass through') {
          if (item.opacity === 1 && !item.mask) walk(item.children || [], destination);
          else {
            const before = makeCanvas(doc.width, doc.height); context2d(before).drawImage(destination, 0, 0);
            const after = makeCanvas(doc.width, doc.height); context2d(after).drawImage(destination, 0, 0); walk(item.children || [], after);
            const a = context2d(after).getImageData(0, 0, doc.width, doc.height); const b = context2d(before).getImageData(0, 0, doc.width, doc.height); const coverage=this.coverage(item,doc);const mask=coverage?context2d(coverage).getImageData(0,0,doc.width,doc.height).data:null;
            for (let p = 0; p < a.data.length; p += 4) { const amount = item.opacity * (mask ? mask[p+3] / 255 : 1); const alpha = b.data[p + 3] * (1 - amount) + a.data[p + 3] * amount; for (let c = 0; c < 3; c++) a.data[p + c] = alpha ? (b.data[p + c] * b.data[p + 3] * (1 - amount) + a.data[p + c] * a.data[p + 3] * amount) / alpha : 0; a.data[p + 3] = alpha; }
            context.putImageData(a, 0, 0);
          }
          continue;
        }
        let content: Canvas;
        if (item.kind === 'group') { content = makeCanvas(doc.width, doc.height); walk(item.children || [], content); const mask=this.coverage(item,doc);if(mask){const cc=context2d(content);cc.globalCompositeOperation='destination-in';cc.drawImage(mask,0,0);cc.globalCompositeOperation='source-over';} }
        else content = this.content(item, doc);
        if(layers[index+1]?.clipping){const base=content;content=makeCanvas(doc.width,doc.height);context2d(content).drawImage(base,0,0);const cc=context2d(content);const original=cc.getImageData(0,0,doc.width,doc.height);const alpha=new Uint8Array(doc.width*doc.height);for(let p=0;p<original.data.length;p+=4){alpha[p/4]=original.data[p+3];original.data[p+3]=255;}cc.putImageData(original,0,0);
          while(layers[index+1]?.clipping){const clipped=layers[++index];if(!clipped.visible)continue;if(clipped.adjustment)this.adjust(content,[clipped.adjustment],this.coverage(clipped,doc),clipped.opacity*clipped.fill);else drawBlended(content,this.content(clipped,doc),clipped.opacity,clipped.blend);}
          const result=cc.getImageData(0,0,doc.width,doc.height);for(let p=0;p<result.data.length;p+=4)result.data[p+3]=alpha[p/4];cc.putImageData(result,0,0);}
        drawBlended(destination,content,item.opacity,item.blend);
      }
    };
    walk(doc.layers, out); return out;
  }
}
/** WebGL2 presentation uses an actual GPU texture; editing/export always has the same Canvas fallback. */
export class GpuPresenter {
  private gl: WebGL2RenderingContext | null;
  private program?: WebGLProgram; private texture?: WebGLTexture;
  private buffer?: WebGLBuffer;
  readonly canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    const gl = this.gl; if (!gl) return;
    const compile = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'GPU shader compilation failed'); return shader; };
    const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\n in vec2 position; out vec2 uv; void main(){uv=vec2((position.x+1.)/2.,(1.-position.y)/2.);gl_Position=vec4(position,0.,1.);}');
    const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\n precision mediump float; in vec2 uv; uniform sampler2D image; out vec4 color; void main(){color=texture(image,uv);}');
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { this.gl = null; return; }
    this.program = program; gl.useProgram(program); const buffer = gl.createBuffer(); this.buffer = buffer!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW); const at = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.gl = null; });
  }
  get available() { return Boolean(this.gl && !this.gl.isContextLost()); }
  draw(source: Canvas) {
    const gl = this.gl; if (!gl || gl.isContextLost() || !this.program) return false;
    if (this.canvas.width !== source.width) this.canvas.width = source.width; if (this.canvas.height !== source.height) this.canvas.height = source.height;
    gl.viewport(0, 0, source.width, source.height); gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D, this.texture!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); gl.drawArrays(gl.TRIANGLES, 0, 6); return true;
  }
  dispose() { if (this.gl) { if (this.texture) this.gl.deleteTexture(this.texture); if (this.program) this.gl.deleteProgram(this.program); if (this.buffer) this.gl.deleteBuffer(this.buffer); } this.gl = null; }
}
