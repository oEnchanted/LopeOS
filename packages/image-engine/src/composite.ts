import { allLayers, clamp, color, maskTransform, toLocal, type Adjustment, type BlendMode, type ImageDocument, type Layer, type RGBA } from './model.ts';
import { pixel } from './pixels.ts';

type RGB = [number, number, number];
const lum = (c: RGB) => c[0] * .3 + c[1] * .59 + c[2] * .11;
const sat = (c: RGB) => Math.max(...c) - Math.min(...c);
function clipColor(c: RGB): RGB {
  const l = lum(c); const n = Math.min(...c); const x = Math.max(...c);
  if (n < 0) c = c.map(v => l + (v - l) * l / (l - n)) as RGB;
  if (x > 1) c = c.map(v => l + (v - l) * (1 - l) / (x - l)) as RGB;
  return c;
}
function setLum(c: RGB, l: number): RGB { const d = l - lum(c); return clipColor(c.map(v => v + d) as RGB); }
function setSat(c: RGB, s: number): RGB {
  const order = [0, 1, 2].sort((a, b) => c[a] - c[b]); const [min, mid, max] = order; const result: RGB = [0, 0, 0];
  if (c[max] > c[min]) { result[mid] = (c[mid] - c[min]) * s / (c[max] - c[min]); result[max] = s; }
  return result;
}
const dodge=(b:number,s:number)=>b===0?0:s===1?1:Math.min(1,b/(1-s));
const burn=(b:number,s:number)=>b===1?1:s===0?0:1-Math.min(1,(1-b)/s);
function blendChannel(b:number,s:number,mode:BlendMode){
  if(mode==='linear burn')return Math.max(0,b+s-1);
  if(mode==='linear dodge')return Math.min(1,b+s);
  if(mode==='vivid light')return s<.5?burn(b,2*s):dodge(b,2*s-1);
  if(mode==='linear light')return clamp(b+2*s-1);
  if(mode==='pin light')return s<.5?Math.min(b,2*s):Math.max(b,2*s-1);
  if(mode==='hard mix')return b+s>=1?1:0;
  if(mode==='subtract')return Math.max(0,b-s);
  if(mode==='divide')return s===0?1:Math.min(1,b/s);
  if(mode==='color dodge')return dodge(b,s);
  if(mode==='color burn')return burn(b,s);
  if(mode==='hard light')return s<=.5?2*b*s:1-2*(1-b)*(1-s);
  if(mode==='soft light')return s<=.5?b-(1-2*s)*b*(1-b):b+(2*s-1)*((b<=.25?((16*b-12)*b+4)*b:Math.sqrt(b))-b);
  if(mode==='exclusion')return b+s-2*b*s;
  return mode==='multiply'?b*s:mode==='screen'?b+s-b*s:mode==='overlay'?b<=.5?2*b*s:1-2*(1-b)*(1-s):mode==='darken'?Math.min(b,s):mode==='lighten'?Math.max(b,s):mode==='difference'?Math.abs(b-s):s;
}
export function blendRGB(back: RGB, front: RGB, mode: BlendMode): RGB {
  if (mode === 'hue') return setLum(setSat(front, sat(back)), lum(back));
  if (mode === 'saturation') return setLum(setSat(back, sat(front)), lum(back));
  if (mode === 'color') return setLum(front, lum(back));
  if (mode === 'luminosity') return setLum(back, lum(front));
  if(mode==='darker color'||mode==='lighter color'){const b=back[0]+back[1]+back[2],s=front[0]+front[1]+front[2];return [...(mode==='darker color'?s<b-1e-12?front:back:s>b+1e-12?front:back)];}
  return front.map((s,i)=>blendChannel(back[i],s,mode)) as RGB;
}
/** Straight-alpha fallback for modes Canvas does not support, without per-pixel allocations. */
export function blendBuffers(back:Uint8ClampedArray,front:Uint8ClampedArray,opacity:number,mode:BlendMode){
  opacity=clamp(opacity);const colorMode=mode==='darker color'||mode==='lighter color';
  for(let p=0;p<back.length;p+=4){const sa=front[p+3]/255*opacity;if(!sa){if(!back[p+3])back[p]=back[p+1]=back[p+2]=0;continue;}const ba=back[p+3]/255,alpha=sa+ba*(1-sa);let source=false;if(colorMode){const b=back[p]+back[p+1]+back[p+2],s=front[p]+front[p+1]+front[p+2];source=mode==='darker color'?s<b:s>b;}for(let c=0;c<3;c++){const b=back[p+c]/255,s=front[p+c]/255,mixed=colorMode?source?s:b:blendChannel(b,s,mode);back[p+c]=((1-sa)*ba*b+(1-ba)*sa*s+ba*sa*mixed)/alpha*255;}back[p+3]=alpha*255;}return back;
}
export function blendPixel(back: RGBA, front: RGBA, opacity = 1, mode: BlendMode = 'normal'): RGBA {
  const ab = back[3] / 255; const as = front[3] / 255 * opacity; const ao = as + ab * (1 - as);
  if (!ao) return [0, 0, 0, 0];
  const b = back.slice(0, 3).map(v => v / 255) as RGB; const s = front.slice(0, 3).map(v => v / 255) as RGB; const mixed = blendRGB(b, s, mode);
  return [0, 1, 2].map(i => ((1 - as) * ab * b[i] + (1 - ab) * as * s[i] + ab * as * mixed[i]) / ao * 255).concat(ao * 255) as RGBA;
}
export function adjustRGB(input: RGB, adjustment: Adjustment): RGB {
  const values = adjustment.values;
  let c: RGB = [...input];
  if (adjustment.type === 'brightness') {
    const contrast = clamp(values[1] ?? 0, -100, 100) / 100; const factor = (1 + contrast) / Math.max(.01, 1 - contrast);
    c = c.map(v => (v - .5) * factor + .5 + (values[0] || 0) / 255) as RGB;
  } else if (adjustment.type === 'levels') {
    const low = (values[0] || 0) / 255; const gamma = clamp(values[1] ?? 1, .1, 10); const high = (values[2] ?? 255) / 255;
    c = c.map(v => Math.pow(clamp((v - low) / Math.max(.001, high - low)), 1 / gamma)) as RGB;
  } else if (adjustment.type === 'curves') {
    // Three editable points: black, midpoint and white. Piecewise linear interpolation.
    const points = [(values[0] || 0) / 255, (values[1] ?? 128) / 255, (values[2] ?? 255) / 255];
    c = c.map(v => v < .5 ? points[0] + (points[1] - points[0]) * v * 2 : points[1] + (points[2] - points[1]) * (v - .5) * 2) as RGB;
  } else if (adjustment.type === 'balance') c = c.map((v, i) => v + (values[i] || 0) / 255) as RGB;
  else if(adjustment.type==='exposure')c=c.map(v=>Math.pow(Math.max(0,v*2**(values[0]||0)+(values[1]||0)),1/Math.max(.01,values[2]??1))) as RGB;
  else if(adjustment.type==='invert')c=c.map(v=>1-v) as RGB;
  else if(adjustment.type==='posterize'){const levels=Math.max(2,Math.round(values[0]??4))-1;c=c.map(v=>Math.round(v*levels)/levels) as RGB;}
  else if(adjustment.type==='threshold'){const v=lum(c)*255>=(values[0]??128)?1:0;c=[v,v,v];}
  else if(adjustment.type==='photo-filter'){const density=clamp((values[3]??25)/100);c=c.map((v,i)=>v*(1-density)+(values[i]??128)/255*density) as RGB;}
  else if(adjustment.type==='gradient-map'){const v=lum(c);c=c.map((_,i)=>((values[i]??0)*(1-v)+(values[i+3]??255)*v)/255) as RGB;}
  else if(adjustment.type==='channel-mixer'){const original=c;c=[0,1,2].map(row=>original.reduce((sum,v,column)=>sum+v*(values[row*4+column]??(row===column?100:0))/100,(values[row*4+3]||0)/100)) as RGB;}
  else if(adjustment.type==='vibrance'){const l=lum(c),sat=Math.max(...c)-Math.min(...c),factor=1+(values[1]||0)/100+(values[0]||0)/100*(1-sat);c=c.map(v=>l+(v-l)*factor) as RGB;}
  else if(adjustment.type==='black-white'){const [r,g,b]=c,min=Math.min(r,g,b),max=Math.max(r,g,b),chroma=max-min;let value=min;if(chroma){const hue=(max===r?(g-b)/chroma+(g<b?6:0):max===g?(b-r)/chroma+2:(r-g)/chroma+4);const low=Math.floor(hue)%6,high=(low+1)%6,weight=hue-Math.floor(hue);value+=chroma*((values[low]??50)*(1-weight)+(values[high]??50)*weight)/100;}c=[value,value,value];}
  else if (adjustment.type === 'hue') {
    const angle = (values[0] || 0) * Math.PI / 180; const co = Math.cos(angle); const si = Math.sin(angle);
    const [r, g, b] = c;
    c = [(.213 + co * .787 - si * .213) * r + (.715 - co * .715 - si * .715) * g + (.072 - co * .072 + si * .928) * b,
      (.213 - co * .213 + si * .143) * r + (.715 + co * .285 + si * .140) * g + (.072 - co * .072 - si * .283) * b,
      (.213 - co * .213 - si * .787) * r + (.715 - co * .715 + si * .715) * g + (.072 + co * .928 + si * .072) * b];
    const l = lum(c); c = c.map(v => l + (v - l) * (1 + (values[1] || 0) / 100) + (values[2] || 0) / 100) as RGB;
  }
  return c.map(v => clamp(v)) as RGB;
}
function sampleLayer(layer: Layer, x: number, y: number): RGBA {
  const p = toLocal({ x: x + .5, y: y + .5 }, layer.transform);
  let rgba: RGBA = [0, 0, 0, 0];
  const source = layer.kind === 'embedded' ? layer.source : layer.pixels;
  if (source) rgba = [...pixel(source, p.x, p.y)];
  else if (layer.kind === 'shape' && layer.shape) {
    const shape = layer.shape; const inBounds = p.x >= 0 && p.y >= 0 && p.x < shape.width && p.y < shape.height;
    if (inBounds && (shape.type !== 'ellipse' || ((p.x / shape.width - .5) ** 2 + (p.y / shape.height - .5) ** 2) <= .25)) rgba = color(shape.fill);
  }
  for (const filter of layer.filters) { const rgb = adjustRGB(rgba.slice(0, 3).map(v => v / 255) as RGB, filter); rgba = [...rgb.map(v => v * 255), rgba[3]] as RGBA; }
  if (layer.mask?.enabled) { const m = toLocal({x:x+.5,y:y+.5},maskTransform(layer)); rgba[3] *= pixel(layer.mask.pixels, m.x, m.y)[0] / 255; }
  rgba[3] *= layer.fill; return rgba;
}
/** Deterministic RGB/8 oracle for regression fixtures. Text and effects use the browser rasterizer. */
export function compositePixels(doc: ImageDocument): Uint8ClampedArray {
  const output = new Uint8ClampedArray(doc.width * doc.height * 4);
  const maskAmount = (item: Layer, x: number, y: number) => { if (!item.mask?.enabled) return 1; const p = toLocal({x:x+.5,y:y+.5},maskTransform(item)); return pixel(item.mask.pixels,p.x,p.y)[0]/255; };
  const walk = (layers: Layer[], x: number, y: number, initial: RGBA): RGBA => {
    let back = initial;
    for (let index=0;index<layers.length;index++) {
      const item=layers[index];
      if (!item.visible) continue;
      if (item.clipping) continue;
      if (item.kind === 'adjustment' && item.adjustment) {
        const adjusted = adjustRGB(back.slice(0, 3).map(v => v / 255) as RGB, item.adjustment);
        const amount = item.opacity * item.fill * maskAmount(item,x,y);
        back = [0, 1, 2].map(c => back[c] * (1 - amount) + adjusted[c] * 255 * amount).concat(back[3]) as RGBA;
        continue;
      }
      if (item.kind === 'group' && item.blend === 'pass through') {
        const result = walk(item.children || [], x, y, back); let amount = item.opacity;
        amount *= maskAmount(item,x,y);
        const alpha = back[3] + (result[3] - back[3]) * amount;
        back = [0, 1, 2].map(c => alpha ? (back[c] * back[3] * (1 - amount) + result[c] * result[3] * amount) / alpha : 0).concat(alpha) as RGBA;
      } else {
        let front = item.kind === 'group' ? walk(item.children || [], x, y, [0, 0, 0, 0]) : sampleLayer(item, x, y);
        if (item.kind === 'group') front = [front[0], front[1], front[2], front[3] * maskAmount(item,x,y)];
        while (layers[index+1]?.clipping) {
          const clipped=layers[++index]; if(!clipped.visible)continue;
          if(clipped.adjustment){const adjusted=adjustRGB(front.slice(0,3).map(v=>v/255) as RGB,clipped.adjustment);const amount=clipped.opacity*maskAmount(clipped,x,y);front=[0,1,2].map(c=>front[c]*(1-amount)+adjusted[c]*255*amount).concat(front[3]) as RGBA;}
          else {const sample=sampleLayer(clipped,x,y);const amount=sample[3]/255*clipped.opacity;const mixed=blendRGB(front.slice(0,3).map(v=>v/255) as RGB,sample.slice(0,3).map(v=>v/255) as RGB,clipped.blend);front=[0,1,2].map(c=>front[c]*(1-amount)+mixed[c]*255*amount).concat(front[3]) as RGBA;}
        }
        back = blendPixel(back, front, item.opacity, item.blend);
      }
    }
    return back;
  };
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) output.set(walk(doc.layers, x, y, [0, 0, 0, 0]), (y * doc.width + x) * 4);
  return output;
}
export const hasSpecialLayers = (doc: ImageDocument) => allLayers(doc.layers).some(layer => layer.kind === 'group' || layer.kind === 'adjustment' || layer.clipping);
