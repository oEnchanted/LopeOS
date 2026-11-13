import { clamp, type ImageDocument, type Point } from './model.ts';
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';
export function combineSelection(doc: ImageDocument, next: Uint8Array, mode: SelectionMode): ImageDocument {
  if (mode !== 'replace' && doc.selection) for (let i = 0; i < next.length; i++) next[i] = mode === 'add' ? Math.max(doc.selection[i], next[i]) : mode === 'subtract' ? Math.max(0, doc.selection[i] - next[i]) : Math.min(doc.selection[i], next[i]);
  return { ...doc, selection: next };
}
export function selectShape(doc: ImageDocument, start: Point, end: Point, shape: 'rectangle' | 'ellipse', mode: SelectionMode = 'replace'): ImageDocument {
  const data = new Uint8Array(doc.width * doc.height); const left = Math.min(start.x, end.x); const top = Math.min(start.y, end.y); const w = Math.abs(start.x - end.x); const h = Math.abs(start.y - end.y);
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(doc.height, top + h); y++) for (let x = Math.max(0, Math.floor(left)); x < Math.min(doc.width, left + w); x++) if (shape === 'rectangle' || Math.pow((x + .5 - left - w / 2) / (w / 2 || 1), 2) + Math.pow((y + .5 - top - h / 2) / (h / 2 || 1), 2) <= 1) data[y * doc.width + x] = 255;
  return combineSelection(doc, data, mode);
}
export function selectPolygon(doc: ImageDocument, points: Point[], mode: SelectionMode = 'replace'): ImageDocument {
  const data = new Uint8Array(doc.width * doc.height);
  if (points.length < 3) return doc;
  const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))); const maxY = Math.min(doc.height, Math.ceil(Math.max(...points.map(p => p.y))));
  for (let y = minY; y < maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i]; const b = points[j]; if ((a.y > y + .5) !== (b.y > y + .5)) intersections.push(a.x + ((y + .5 - a.y) * (b.x - a.x)) / (b.y - a.y)); }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) for (let x = Math.max(0, Math.ceil(intersections[i] - .5)); x < Math.min(doc.width, intersections[i + 1] - .5); x++) data[y * doc.width + x] = 255;
  }
  return combineSelection(doc, data, mode);
}
export function selectTolerance(doc: ImageDocument, rgba: Uint8ClampedArray, point: Point, tolerance: number, mode: SelectionMode = 'replace', contiguous = true): ImageDocument {
  const selection = new Uint8Array(doc.width * doc.height); const x = Math.floor(point.x); const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return doc;
  const origin = (y * doc.width + x) * 4; const matches = (index: number) => {const p=index*4;return Math.abs(rgba[p]-rgba[origin])<=tolerance&&Math.abs(rgba[p+1]-rgba[origin+1])<=tolerance&&Math.abs(rgba[p+2]-rgba[origin+2])<=tolerance&&Math.abs(rgba[p+3]-rgba[origin+3])<=tolerance;};
  if (contiguous) {
    const stack=[y*doc.width+x];while(stack.length){const at=stack.pop()!;if(selection[at]||!matches(at))continue;const row=Math.floor(at/doc.width),start=row*doc.width;let left=at%doc.width;while(left>0&&!selection[start+left-1]&&matches(start+left-1))left--;let above=false,below=false;for(let px=left;px<doc.width&&!selection[start+px]&&matches(start+px);px++){const p=start+px;selection[p]=255;if(row>0){const next=!selection[p-doc.width]&&matches(p-doc.width);if(next&&!above)stack.push(p-doc.width);above=next;}if(row+1<doc.height){const next=!selection[p+doc.width]&&matches(p+doc.width);if(next&&!below)stack.push(p+doc.width);below=next;}}}
  } else for (let i = 0; i < selection.length; i++) if (matches(i)) selection[i] = 255;
  return combineSelection(doc, selection, mode);
}
export function selectColorRange(doc:ImageDocument,rgba:Uint8ClampedArray,target:number[],fuzziness:number,mode:SelectionMode='replace'){
  const next=new Uint8Array(doc.width*doc.height),range=Math.max(1,fuzziness);for(let i=0;i<next.length;i++){const p=i*4,distance=Math.max(Math.abs(rgba[p]-target[0]),Math.abs(rgba[p+1]-target[1]),Math.abs(rgba[p+2]-target[2]));next[i]=rgba[p+3]?clamp(1-distance/range)*255:0;}return combineSelection(doc,next,mode);
}
export function borderSelection(doc:ImageDocument,amount:number){if(!doc.selection)return doc;const outer=growSelection(doc,amount).selection!,inner=growSelection(doc,-amount).selection!;return {...doc,selection:outer.map((v,i)=>Math.max(0,v-inner[i]))};}
export function smoothSelection(doc:ImageDocument,amount:number){const smoothed=feather(doc,amount);return smoothed.selection?{...doc,selection:smoothed.selection.map(v=>v>=128?255:0)}:doc;}
export function feather(doc: ImageDocument, amount: number): ImageDocument {
  if (!doc.selection) return doc;
  const radius = Math.round(clamp(amount, 0, 100)); if (!radius) return doc;
  let input: Uint8Array<ArrayBufferLike> = doc.selection;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8Array(input.length); const major = pass ? doc.width : doc.height; const minor = pass ? doc.height : doc.width;
    for (let row = 0; row < major; row++) {
      const index = (pos: number) => pass ? pos * doc.width + row : row * doc.width + pos;
      let sum = 0; for (let pos = -radius; pos <= radius; pos++) if (pos >= 0 && pos < minor) sum += input[index(pos)];
      for (let pos = 0; pos < minor; pos++) { out[index(pos)] = sum / (2 * radius + 1); if (pos - radius >= 0) sum -= input[index(pos - radius)]; if (pos + radius + 1 < minor) sum += input[index(pos + radius + 1)]; }
    }
    input = out;
  }
  return { ...doc, selection: input };
}
export function growSelection(doc: ImageDocument, amount: number): ImageDocument {
  if (!doc.selection) return doc;
  const radius = Math.round(clamp(Math.abs(amount), 0, 64)); const dilate = amount > 0; let input: Uint8Array<ArrayBufferLike> = doc.selection;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8Array(input.length);
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      let value = dilate ? 0 : 255;
      for (let delta = -radius; delta <= radius; delta++) { const px = pass ? x : x + delta; const py = pass ? y + delta : y; const v = px < 0 || py < 0 || px >= doc.width || py >= doc.height ? 0 : input[py * doc.width + px]; value = dilate ? Math.max(value, v) : Math.min(value, v); }
      out[y * doc.width + x] = value;
    }
    input = out;
  }
  return { ...doc, selection: input };
}
export function selectionBounds(doc: ImageDocument) {
  if (!doc.selection) return null;
  let x1 = doc.width; let y1 = doc.height; let x2 = -1; let y2 = -1;
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) if (doc.selection[y * doc.width + x] > 127) { x1 = Math.min(x, x1); y1 = Math.min(y, y1); x2 = Math.max(x, x2); y2 = Math.max(y, y2); }
  return x2 < 0 ? null : { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}
