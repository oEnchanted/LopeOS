import { addLayer, allLayers, dimensions, findLayer, identity, layer, surface, toDocument, updateLayer, type ImageDocument, type Layer, type Point } from './model.ts';
import { fromPixels } from './pixels.ts';
import { compositePixels } from './composite.ts';
import { inverse,matrixOf,multiply,transformOf,type Matrix } from './matrix.ts';

const mapLayers = (layers: Layer[], fn: (layer: Layer) => Layer): Layer[] => layers.map(item => { const next = fn(item); return next.children ? { ...next, children: mapLayers(next.children, fn) } : next; });
function remapSelections(doc:ImageDocument,width:number,height:number,source:(x:number,y:number)=>Point){
  const map=(input:Uint8Array)=>{const out=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=source(x,y),sx=Math.floor(p.x),sy=Math.floor(p.y);if(sx>=0&&sy>=0&&sx<doc.width&&sy<doc.height)out[y*width+x]=input[sy*doc.width+sx];}return out;};return {selection:doc.selection?map(doc.selection):null,savedSelections:doc.savedSelections?.map(s=>({...s,pixels:map(s.pixels)}))};
}
export function resizeImage(doc: ImageDocument, width: number, height: number, resolution = doc.resolution): ImageDocument {
  dimensions(width, height); if (resolution < 1 || !Number.isFinite(resolution)) throw new Error('Resolution must be positive.');
  const sx = width / doc.width; const sy = height / doc.height;
  const scale:Matrix=[sx,0,0,sy,0,0];const layers = mapLayers(doc.layers, item => ({ ...item, transform:transformOf(multiply(scale,matrixOf(item.transform))), ...(item.mask && !item.mask.linked ? { mask: { ...item.mask, transform:transformOf(multiply(scale,matrixOf(item.mask.transform))) } } : {}) }));
  return { ...doc, width, height, resolution, layers,...remapSelections(doc,width,height,(x,y)=>({x:x/sx,y:y/sy})), guides: doc.guides.map(g => ({ ...g, position: g.position * (g.axis === 'x' ? sx : sy) })), paths: doc.paths.map(p => ({ ...p, points: p.points.map(v => ({ x: v.x * sx, y: v.y * sy })) })) };
}
export function resizeCanvas(doc: ImageDocument, width: number, height: number, offset = { x: (width - doc.width) / 2, y: (height - doc.height) / 2 }): ImageDocument {
  dimensions(width, height); offset = { x: Math.round(offset.x), y: Math.round(offset.y) };
  const layers = mapLayers(doc.layers, item => ({ ...item, transform: { ...item.transform, x: item.transform.x + offset.x, y: item.transform.y + offset.y }, ...(item.mask && !item.mask.linked ? { mask: { ...item.mask, transform: { ...item.mask.transform, x: item.mask.transform.x + offset.x, y: item.mask.transform.y + offset.y } } } : {}) }));
  return { ...doc, width, height, layers,...remapSelections(doc,width,height,(x,y)=>({x:x-offset.x,y:y-offset.y})), guides: doc.guides.map(g => ({ ...g, position: g.position + (g.axis === 'x' ? offset.x : offset.y) })), paths: doc.paths.map(p => ({ ...p, points: p.points.map(v => ({ x: v.x + offset.x, y: v.y + offset.y })) })) };
}
export function cropDocument(doc: ImageDocument, rect: { x: number; y: number; width: number; height: number }): ImageDocument {
  const x = Math.max(0, Math.round(rect.x)); const y = Math.max(0, Math.round(rect.y)); const width = Math.min(doc.width - x, Math.round(rect.width)); const height = Math.min(doc.height - y, Math.round(rect.height));
  return resizeCanvas(doc, width, height, { x: -x, y: -y });
}
export function trimDocument(doc:ImageDocument,rgba:Uint8ClampedArray):ImageDocument{
  let left=doc.width,top=doc.height,right=-1,bottom=-1;for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++)if(rgba[(y*doc.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}return right<0?doc:cropDocument(doc,{x:left,y:top,width:right-left+1,height:bottom-top+1});
}
export function revealAll(doc:ImageDocument):ImageDocument{
  const bounds=doc.layers.filter(l=>l.visible).map(l=>transformedBounds(l,doc));const left=Math.floor(Math.min(0,...bounds.map(b=>b.x))),top=Math.floor(Math.min(0,...bounds.map(b=>b.y))),right=Math.ceil(Math.max(doc.width,...bounds.map(b=>b.x+b.width))),bottom=Math.ceil(Math.max(doc.height,...bounds.map(b=>b.y+b.height)));return resizeCanvas(doc,right-left,bottom-top,{x:-left,y:-top});
}
export function straightenDocument(doc: ImageDocument, degrees: number): ImageDocument {
  const angle=degrees*Math.PI/180;const cx=doc.width/2;const cy=doc.height/2;
  const rotate=(p:Point):Point=>({x:cx+(p.x-cx)*Math.cos(angle)-(p.y-cy)*Math.sin(angle),y:cy+(p.x-cx)*Math.sin(angle)+(p.y-cy)*Math.cos(angle)});
  const layers=mapLayers(doc.layers,item=>({...item,transform:{...item.transform,...rotate(item.transform),rotation:item.transform.rotation+degrees},...(item.mask&&!item.mask.linked?{mask:{...item.mask,transform:{...item.mask.transform,...rotate(item.mask.transform),rotation:item.mask.transform.rotation+degrees}}}:{})}));
  return {...doc,layers,...remapSelections(doc,doc.width,doc.height,(x,y)=>({x:cx+(x-cx)*Math.cos(angle)+(y-cy)*Math.sin(angle),y:cy-(x-cx)*Math.sin(angle)+(y-cy)*Math.cos(angle)})),paths:doc.paths.map(path=>({...path,points:path.points.map(rotate)}))};
}
export function rotateDocument(doc:ImageDocument,clockwise=true):ImageDocument{
  const m:Matrix=clockwise?[0,1,-1,0,doc.height,0]:[0,-1,1,0,0,doc.width];const transform=(t:Layer['transform'])=>transformOf(multiply(m,matrixOf(t)));return {...doc,width:doc.height,height:doc.width,layers:mapLayers(doc.layers,l=>({...l,transform:transform(l.transform),...(l.mask&&!l.mask.linked?{mask:{...l.mask,transform:transform(l.mask.transform)}}:{})})),...remapSelections(doc,doc.height,doc.width,(x,y)=>clockwise?{x:y,y:doc.height-1-x}:{x:doc.width-1-y,y:x}),paths:doc.paths.map(p=>({...p,points:p.points.map(v=>clockwise?{x:doc.height-v.y,y:v.x}:{x:v.y,y:doc.width-v.x})})),guides:doc.guides.map(g=>({axis:g.axis==='x'?'y':'x',position:clockwise?(g.axis==='x'?g.position:doc.height-g.position):(g.axis==='x'?doc.width-g.position:g.position)}))};
}
export function transformedBounds(item: Layer, doc: ImageDocument): { x: number; y: number; width: number; height: number } {
  if (item.children?.length) {
    const bounds = item.children.map(child => transformedBounds(child, doc)); const x = Math.min(...bounds.map(b => b.x)); const y = Math.min(...bounds.map(b => b.y));
    return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y };
  }
  const source = item.kind === 'embedded' ? item.source : item.pixels; const width = source?.width || item.shape?.width || (item.text ? Math.max(80, item.text.content.length * item.text.size * .58) : doc.width); const height = source?.height || item.shape?.height || (item.text ? item.text.content.split('\n').length * item.text.size * item.text.leading : doc.height);
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map(p => toDocument(p, item.transform));
  const x = Math.min(...points.map(p => p.x)); const y = Math.min(...points.map(p => p.y)); return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
export function translateLayer(item: Layer, x: number, y: number): Layer {
  return { ...item, transform: { ...item.transform, x: item.transform.x + x, y: item.transform.y + y }, ...(item.children ? { children: item.children.map(child => translateLayer(child, x, y)) } : {}) };
}
export function transformLayerWorld(item:Layer,matrix:Matrix):Layer{
  if(item.locked)return item;return {...item,transform:transformOf(multiply(matrix,matrixOf(item.transform))),...(item.children?{children:item.children.map(child=>transformLayerWorld(child,matrix))}:{})};
}
export function transformSelected(doc:ImageDocument,matrix:Matrix):ImageDocument{
  const walk=(items:Layer[]):Layer[]=>items.map(item=>doc.activeIds.includes(item.id)?transformLayerWorld(item,matrix):item.children?{...item,children:walk(item.children)}:item);return {...doc,layers:walk(doc.layers)};
}
export function replaceLayerTransform(doc:ImageDocument,id:string,transform:Layer['transform']):ImageDocument{
  const active=findLayer(doc,id);if(!active)return doc;const delta=multiply(matrixOf(transform),inverse(matrixOf(active.transform)));return updateLayer(doc,id,item=>transformLayerWorld(item,delta));
}
export function flipSelected(doc:ImageDocument,horizontal=true):ImageDocument{
  const bounds=allLayers(doc.layers).filter(l=>doc.activeIds.includes(l.id)).map(l=>transformedBounds(l,doc));if(!bounds.length)return doc;
  const left=Math.min(...bounds.map(b=>b.x)),right=Math.max(...bounds.map(b=>b.x+b.width)),top=Math.min(...bounds.map(b=>b.y)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
  return transformSelected(doc,horizontal?[-1,0,0,1,left+right,0]:[1,0,0,-1,0,top+bottom]);
}
export function alignLayers(doc: ImageDocument, alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-x' | 'distribute-y'): ImageDocument {
  const selected = allLayers(doc.layers).filter(item => doc.activeIds.includes(item.id) && !item.locked); if (!selected.length) return doc;
  let next = doc; const bounds = selected.map(item => transformedBounds(item, doc));
  const area = selected.length > 1 ? { x: Math.min(...bounds.map(b => b.x)), y: Math.min(...bounds.map(b => b.y)), right: Math.max(...bounds.map(b => b.x + b.width)), bottom: Math.max(...bounds.map(b => b.y + b.height)) } : { x: 0, y: 0, right: doc.width, bottom: doc.height };
  if (alignment.startsWith('distribute')) {
    if (selected.length < 3) return doc;
    const horizontal = alignment === 'distribute-x'; const ordered = selected.map((item, index) => ({ item, b: bounds[index] })).sort((a, b) => horizontal ? a.b.x - b.b.x : a.b.y - b.b.y);
    const first = ordered[0].b; const last = ordered[ordered.length - 1].b; const gap = ((horizontal ? last.x + last.width - first.x : last.y + last.height - first.y) - ordered.reduce((sum, v) => sum + (horizontal ? v.b.width : v.b.height), 0)) / (ordered.length - 1);
    let position = horizontal ? first.x : first.y;
    for (const { item, b } of ordered) { const delta = position - (horizontal ? b.x : b.y); next = updateLayer(next, item.id, value => translateLayer(value, horizontal ? delta : 0, horizontal ? 0 : delta)); position += (horizontal ? b.width : b.height) + gap; }
  } else selected.forEach((item, i) => { const b = bounds[i]; const x = alignment === 'left' ? area.x - b.x : alignment === 'center' ? (area.x + area.right - b.width) / 2 - b.x : alignment === 'right' ? area.right - b.width - b.x : 0; const y = alignment === 'top' ? area.y - b.y : alignment === 'middle' ? (area.y + area.bottom - b.height) / 2 - b.y : alignment === 'bottom' ? area.bottom - b.height - b.y : 0; next = updateLayer(next, item.id, value => translateLayer(value, x, y)); });
  return next;
}
export function embedLayer(doc: ImageDocument): ImageDocument {
  const active = findLayer(doc); if (!active || !active.pixels || active.kind === 'embedded') return doc;
  return updateLayer(doc, active.id, value => ({ ...value, kind: 'embedded', source: value.pixels, pixels: undefined }));
}
export function resetSourceTransform(doc: ImageDocument): ImageDocument {
  const active = findLayer(doc); if (!active || active.kind !== 'embedded') return doc;
  return updateLayer(doc, active.id, value => ({ ...value, transform: identity() }));
}
export function mergeLayers(doc: ImageDocument, ids = doc.activeIds, data?: Uint8ClampedArray): ImageDocument {
  const chosen = { ...doc, layers: doc.layers.filter(item => ids.includes(item.id)), selection: null };
  if (!chosen.layers.length) return doc;
  const pixels = fromPixels(doc.width, doc.height, data || compositePixels(chosen)); const merged = { ...layer(chosen.layers[chosen.layers.length - 1].name), pixels };
  const position = doc.layers.findIndex(item => ids.includes(item.id)); const remaining = doc.layers.filter(item => !ids.includes(item.id)); remaining.splice(position, 0, merged);
  return { ...doc, layers: remaining, activeIds: [merged.id], target: 'pixels' };
}
export function newPixelLayer(doc: ImageDocument) { return addLayer(doc, { ...layer(`Layer ${allLayers(doc.layers).length}`), pixels: surface(doc.width, doc.height) }); }
export function createTextLayer(doc: ImageDocument, point: Point, content: string, foreground = '#ffffff'): ImageDocument {
  return addLayer(doc, { ...layer(content.slice(0, 24) || 'Type layer', 'text'), transform: { ...identity(), x: point.x, y: point.y }, text: { content, font: 'Arial', size: 72, color: foreground, bold: false, italic: false, align: 'left', leading: 1.2, tracking: 0 } });
}
