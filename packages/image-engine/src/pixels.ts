import { TILE, clamp, color, findLayer, identity, maskTransform, surface, toDocument, toLocal, updateLayer, type ImageDocument, type Point, type RGBA, type Surface } from './model.ts';
import { matrixOf } from './matrix.ts';
import { blendRGB } from './composite.ts';

const keyOf = (x: number, y: number) => `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
const tileRevisions=new WeakMap<Uint8ClampedArray,number>();
const parents=new WeakMap<Surface,Surface>();
export const tileRevision=(tile:Uint8ClampedArray)=>tileRevisions.get(tile)||0;
export const touchTile=(tile:Uint8ClampedArray)=>tileRevisions.set(tile,tileRevision(tile)+1);
export const parentSurface=(value:Surface)=>parents.get(value);
export const linkSurfaceParent=(value:Surface,parent:Surface)=>parents.set(value,parent);
export function pixel(value: Surface, x: number, y: number): RGBA {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= value.width || y >= value.height) return [0, 0, 0, 0];
  const tile = value.tiles[keyOf(x, y)]; if (!tile) return value.base;
  const offset = ((y % TILE) * TILE + x % TILE) * 4;
  return [tile[offset], tile[offset + 1], tile[offset + 2], tile[offset + 3]];
}
export class SurfaceWriter {
  readonly value: Surface;
  readonly source: Surface;
  private touched = new Set<string>();
  constructor(source: Surface) { this.source = source; this.value = { ...source, tiles: { ...source.tiles } };parents.set(this.value,source); }
  writable(tx:number,ty:number){
    const key=`${tx},${ty}`;
    if(!this.touched.has(key)){const existing=this.source.tiles[key];const tile=existing?existing.slice():new Uint8ClampedArray(TILE*TILE*4);if(!existing&&this.source.base.some(Boolean)){const packed=new Uint8ClampedArray(this.source.base);new Uint32Array(tile.buffer).fill(new Uint32Array(packed.buffer)[0]);}this.value.tiles[key]=tile;this.touched.add(key);touchTile(tile);}
    return this.value.tiles[key];
  }
  set(x: number, y: number, rgba: RGBA) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.value.width || y >= this.value.height) return;
    const tile=this.writable(Math.floor(x/TILE),Math.floor(y/TILE));const at=((y%TILE)*TILE+x%TILE)*4;tile[at]=rgba[0];tile[at+1]=rgba[1];tile[at+2]=rgba[2];tile[at+3]=rgba[3];
  }
}
export function surfacePixels(value: Surface): Uint8ClampedArray {
  const data = new Uint8ClampedArray(value.width * value.height * 4);
  if (value.base.some(Boolean)) { const packed = new Uint8ClampedArray(value.base); new Uint32Array(data.buffer).fill(new Uint32Array(packed.buffer)[0]); }
  for (const [key, tile] of Object.entries(value.tiles)) {
    const [tx, ty] = key.split(',').map(Number);
    const length = Math.min(TILE, value.width - tx * TILE) * 4;
    for (let y = 0; y < TILE && ty * TILE + y < value.height; y++) data.set(tile.subarray(y * TILE * 4, y * TILE * 4 + length), ((ty * TILE + y) * value.width + tx * TILE) * 4);
  }
  return data;
}
export function fromPixels(width: number, height: number, data: ArrayLike<number>): Surface {
  const out = surface(width, height); const source = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data);
  for (let ty = 0; ty < Math.ceil(height / TILE); ty++) for (let tx = 0; tx < Math.ceil(width / TILE); tx++) {
    const tile = new Uint8ClampedArray(TILE * TILE * 4); const length = Math.min(TILE, width - tx * TILE) * 4;
    for (let y = 0; y < TILE && ty * TILE + y < height; y++) { const from = ((ty * TILE + y) * width + tx * TILE) * 4; tile.set(source.subarray(from, from + length), y * TILE * 4); }
    if (new Uint32Array(tile.buffer).some(Boolean)) out.tiles[`${tx},${ty}`] = tile;
  }
  return out;
}
export type BrushSettings = { size: number; hardness: number; opacity: number; flow: number; spacing: number; color: string; pressure: boolean; erase?: boolean; pencil?: boolean;blend?:import('./model.ts').BlendMode;retouch?:'blur'|'sharpen'|'smudge'|'dodge'|'burn'|'sponge';toneRange?:'shadows'|'midtones'|'highlights';saturate?:boolean; clone?: { source: Surface; offset: Point; heal?: boolean } };
export class BrushStroke {
  readonly writer: SurfaceWriter;
  private coverage = new Map<string, Float32Array>();
  private last?: Point;
  private distance = 0;
  private smudge?:RGBA;
  private targetTransform;
  readonly layerId: string;
  readonly document: ImageDocument;
  readonly settings: BrushSettings;
  constructor(document: ImageDocument, settings: BrushSettings) {
    this.document = document; this.settings = settings;
    const layer = findLayer(document); if (!layer || layer.locked) throw new Error('Select an unlocked pixel layer or layer mask.');
    const mask = document.target === 'mask' && layer.mask;
    if (!mask && layer.kind !== 'raster') throw new Error('Painting requires a pixel layer. Create one above this layer.');
    this.layerId = layer.id; this.targetTransform = mask ? maskTransform(layer) : layer.transform;
    this.writer = new SurfaceWriter(mask ? mask.pixels : layer.pixels || surface(document.width, document.height));
  }
  add(point: Point) {
    const local = toLocal(point, this.targetTransform);
    if (!this.last) { this.stamp(local); this.last = local; return; }
    const dx = local.x - this.last.x; const dy = local.y - this.last.y; const length = Math.hypot(dx, dy);
    const spacing = Math.max(0.5, this.settings.size * clamp(this.settings.spacing, 0.01, 1));
    for (let at = spacing - this.distance; at <= length; at += spacing) {
      const t = length ? at / length : 0;
      this.stamp({ x: this.last.x + dx * t, y: this.last.y + dy * t, pressure: (this.last.pressure ?? 1) + ((local.pressure ?? 1) - (this.last.pressure ?? 1)) * t });
    }
    this.distance = (this.distance + length) % spacing; this.last = local;
  }
  private stamp(point: Point) {
    const settings = this.settings; const mask = this.document.target === 'mask';
    const pressure = settings.pressure ? clamp(point.pressure ?? 1, 0.05, 1) : 1;
    const radius = Math.max(0.5, settings.size * pressure / 2); const inner = settings.pencil ? radius : radius * clamp(settings.hardness);
    if(radius<=.5||settings.pencil)point={...point,x:Math.floor(point.x)+.5,y:Math.floor(point.y)+.5};
    const paint = color(settings.color); const gray = Math.round(paint[0] * .2126 + paint[1] * .7152 + paint[2] * .0722);
    const minX=Math.max(0,Math.floor(point.x-radius)),maxX=Math.min(this.writer.value.width,Math.ceil(point.x+radius));const minY=Math.max(0,Math.floor(point.y-radius)),maxY=Math.min(this.writer.value.height,Math.ceil(point.y+radius));
    const t=this.targetTransform,[ax,ay,bx,by]=matrixOf(t);
    const selection=this.document.selection,docWidth=this.document.width,docHeight=this.document.height,base=this.writer.source.base;
    if(settings.retouch==='smudge'){const sampled=pixel(this.writer.source,point.x,point.y);if(!this.smudge)this.smudge=sampled;else for(let c=0;c<3;c++)this.smudge[c]=this.smudge[c]*.95+sampled[c]*.05;}
    let correction=[0,0,0];if(settings.clone?.heal){const a=pixel(settings.clone.source,point.x+settings.clone.offset.x,point.y+settings.clone.offset.y);const b=pixel(this.writer.source,point.x,point.y);correction=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];}
    for(let ty=Math.floor(minY/TILE);ty<=Math.floor((maxY-1)/TILE);ty++)for(let tx=Math.floor(minX/TILE);tx<=Math.floor((maxX-1)/TILE);tx++){
      const key=`${tx},${ty}`,original=this.writer.source.tiles[key];let covered=this.coverage.get(key);let output:Uint8ClampedArray|undefined;
      const x1=Math.max(minX,tx*TILE),x2=Math.min(maxX,(tx+1)*TILE),y1=Math.max(minY,ty*TILE),y2=Math.min(maxY,(ty+1)*TILE);
      for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++){
        const dx=x+.5-point.x,dy=y+.5-point.y,d2=dx*dx+dy*dy;if(d2>radius*radius)continue;
        let selected=1;if(selection){const sx=Math.floor(t.x+(x+.5)*ax+(y+.5)*bx),sy=Math.floor(t.y+(x+.5)*ay+(y+.5)*by);selected=sx>=0&&sy>=0&&sx<docWidth&&sy<docHeight?selection[sy*docWidth+sx]/255:0;}if(!selected)continue;
        if(!covered){covered=new Float32Array(TILE*TILE);this.coverage.set(key,covered);}output ||= this.writer.writable(tx,ty);
        const at=(y-ty*TILE)*TILE+x-tx*TILE,p=at*4;const edge=d2<=inner*inner?1:clamp((radius-Math.sqrt(d2))/Math.max(.001,radius-inner));covered[at]=1-(1-covered[at])*(1-edge*settings.flow*pressure);const alpha=covered[at]*settings.opacity*selected;
        const r=original?original[p]:base[0],g=original?original[p+1]:base[1],b=original?original[p+2]:base[2],a=original?original[p+3]:base[3];
        if(mask&&!settings.retouch){const v=r*(1-alpha)+(settings.erase?255:gray)*alpha;output[p]=output[p+1]=output[p+2]=v;output[p+3]=255;}
        else if(settings.erase){output[p]=r;output[p+1]=g;output[p+2]=b;output[p+3]=a*(1-alpha);}
        else if(settings.retouch){let rr=r,gg=g,bb=b,amount=alpha;const gray=r*.2126+g*.7152+b*.0722;
          if(settings.retouch==='dodge'||settings.retouch==='burn'){const l=gray/255,range=settings.toneRange||'midtones';amount*=range==='shadows'?(1-l)**2:range==='highlights'?l*l:4*l*(1-l);if(settings.retouch==='dodge'){rr=r+(255-r)*.5;gg=g+(255-g)*.5;bb=b+(255-b)*.5;}else{rr=r*.5;gg=g*.5;bb=b*.5;}}
          else if(settings.retouch==='sponge'){const scale=settings.saturate?2:0;rr=gray+(r-gray)*scale;gg=gray+(g-gray)*scale;bb=gray+(b-gray)*scale;}
          else if(settings.retouch==='smudge'){[rr,gg,bb]=this.smudge!;}
          else{let ar=0,ag=0,ab=0,weight=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const neighbor=pixel(this.writer.source,x+xx,y+yy);ar+=neighbor[0]*neighbor[3];ag+=neighbor[1]*neighbor[3];ab+=neighbor[2]*neighbor[3];weight+=neighbor[3];}if(weight){rr=ar/weight;gg=ag/weight;bb=ab/weight;}if(settings.retouch==='sharpen'){rr=clamp(r*2-rr,0,255);gg=clamp(g*2-gg,0,255);bb=clamp(b*2-bb,0,255);}}
          output[p]=r*(1-amount)+rr*amount;output[p+1]=g*(1-amount)+gg*amount;output[p+2]=b*(1-amount)+bb*amount;output[p+3]=a;
        }
        else{let sr=paint[0],sg=paint[1],sb=paint[2],sa=1;if(settings.clone){const sampled=pixel(settings.clone.source,x+settings.clone.offset.x,y+settings.clone.offset.y);sr=clamp(sampled[0]+correction[0],0,255);sg=clamp(sampled[1]+correction[1],0,255);sb=clamp(sampled[2]+correction[2],0,255);sa=sampled[3]/255;}const fa=alpha*sa,ba=a/255,oa=fa+ba*(1-fa),remaining=ba*(1-fa);if(settings.blend&&settings.blend!=='normal'){const mixed=blendRGB([r/255,g/255,b/255],[sr/255,sg/255,sb/255],settings.blend);sr=sr*(1-ba)+mixed[0]*255*ba;sg=sg*(1-ba)+mixed[1]*255*ba;sb=sb*(1-ba)+mixed[2]*255*ba;}output[p]=oa?(sr*fa+r*remaining)/oa:0;output[p+1]=oa?(sg*fa+g*remaining)/oa:0;output[p+2]=oa?(sb*fa+b*remaining)/oa:0;output[p+3]=oa*255;}
      }if(output)touchTile(output);
    }
  }
  preview(): ImageDocument { return updateLayer(this.document, this.layerId, layer => this.document.target === 'mask' && layer.mask ? { ...layer, mask: { ...layer.mask, pixels: this.writer.value } } : { ...layer, pixels: this.writer.value }); }
  finish() { this.coverage.clear(); return this.preview(); }
}
export function paintFill(doc: ImageDocument, value: string, at?: Point, tolerance = 32, gradient?: { end: Point; background: string }): ImageDocument {
  const active = findLayer(doc); if (!active || active.locked || (doc.target === 'pixels' && active.kind !== 'raster')) throw new Error('Select an unlocked pixel layer or mask.');
  const mask = doc.target === 'mask' && active.mask;
  const transform = mask ? maskTransform(active) : active.transform;
  const source = mask ? mask.pixels : active.pixels || surface(doc.width, doc.height);
  const out = new SurfaceWriter(source); const paint = color(value); const start = at ? toLocal(at, transform) : { x: 0, y: 0 }; const target = pixel(source, start.x, start.y);
  let allowed: Uint8Array | null = null;
  if (at && !gradient) {
    allowed = new Uint8Array(source.width * source.height); const stack = [Math.floor(start.y) * source.width + Math.floor(start.x)];
    while (stack.length) {
      const index = stack.pop()!; if (index < 0 || index >= allowed.length || allowed[index]) continue;
      allowed[index] = 1; const x = index % source.width; const y = Math.floor(index / source.width); const rgba = pixel(source, x, y);
      if (Math.max(...rgba.map((c, i) => Math.abs(c - target[i]))) > tolerance) continue;
      allowed[index] = 2;
      if (x > 0) stack.push(index - 1); if (x + 1 < source.width) stack.push(index + 1); if (y > 0) stack.push(index - source.width); if (y + 1 < source.height) stack.push(index + source.width);
    }
  }
  const end = gradient ? toLocal(gradient.end, transform) : start; const dx = end.x - start.x; const dy = end.y - start.y; const background = color(gradient?.background || value);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    if (allowed && allowed[y * source.width + x] !== 2) continue;
    const p = toDocument({ x, y }, transform); const sx = Math.floor(p.x); const sy = Math.floor(p.y);
    const selection = doc.selection ? (sx >= 0 && sy >= 0 && sx < doc.width && sy < doc.height ? doc.selection[sy * doc.width + sx] / 255 : 0) : 1;
    if (!selection) continue;
    const ratio = gradient ? clamp(((x - start.x) * dx + (y - start.y) * dy) / (dx * dx + dy * dy || 1)) : 0;
    const rgba = paint.map((c, i) => c + (background[i] - c) * ratio) as RGBA; const before = pixel(source, x, y);
    if (mask) { const gray = rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722; const v = before[0] * (1 - selection) + gray * selection; out.set(x, y, [v, v, v, 255]); }
    else {const ab=before[3]/255;const alpha=selection+ab*(1-selection);out.set(x,y,[0,1,2].map(i=>alpha?(rgba[i]*selection+before[i]*ab*(1-selection))/alpha:0).concat(alpha*255) as RGBA);}
  }
  return updateLayer(doc, active.id, item => mask ? { ...item, mask: { ...mask, pixels: out.value } } : { ...item, pixels: out.value });
}
export function addMask(doc: ImageDocument): ImageDocument {
  const active = findLayer(doc); if (!active) return doc;
  let pixels = surface(doc.width, doc.height, [255, 255, 255, 255]);
  if (doc.selection) {
    const writer = new SurfaceWriter(pixels);
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const p = toDocument({ x, y }, active.transform); const dx = Math.floor(p.x); const dy = Math.floor(p.y);
      const v = dx >= 0 && dy >= 0 && dx < doc.width && dy < doc.height ? doc.selection[dy * doc.width + dx] : 0; if (v !== 255) writer.set(x, y, [v, v, v, 255]);
    }
    pixels = writer.value;
  }
  return { ...updateLayer(doc, active.id, item => ({ ...item, mask: { pixels, linked: true, enabled: true, transform: identity() } })), target: 'mask' };
}
