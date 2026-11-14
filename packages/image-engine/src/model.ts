export type RGBA = [number, number, number, number];
export type Point = { x: number; y: number; pressure?: number };
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'difference' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'color dodge' | 'color burn' | 'hard light' | 'soft light' | 'exclusion' | 'linear burn' | 'linear dodge' | 'darker color' | 'lighter color' | 'vivid light' | 'linear light' | 'pin light' | 'hard mix' | 'subtract' | 'divide' | 'pass through';
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'hue', 'saturation', 'color', 'luminosity','color dodge','color burn','hard light','soft light','exclusion','linear burn','linear dodge','darker color','lighter color','vivid light','linear light','pin light','hard mix','subtract','divide'];
export const TILE = 128;
export const MAX_PIXELS = 64 * 1024 * 1024;
export type Surface = { width: number; height: number; base: RGBA; tiles: Record<string, Uint8ClampedArray> };
export type Transform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number;skewX?:number };
export type Adjustment = { type: 'brightness' | 'levels' | 'curves' | 'hue' | 'balance' | 'exposure' | 'vibrance' | 'black-white' | 'photo-filter' | 'channel-mixer' | 'invert' | 'posterize' | 'threshold' | 'gradient-map'; values: number[] };
export type LayerEffect = { type: 'stroke' | 'shadow' | 'overlay'; color: string; size: number; opacity: number; x: number; y: number };
export type Layer = {
  id: string; name: string; kind: 'raster' | 'text' | 'shape' | 'group' | 'adjustment' | 'embedded';
  visible: boolean; locked: boolean; opacity: number; fill: number; blend: BlendMode;
  transform: Transform; pixels?: Surface; source?: Surface; children?: Layer[]; expanded?: boolean;
  embeddedAsset?: { name: string; data: string; format: string };
  mask?: { pixels: Surface; linked: boolean; enabled: boolean; transform: Transform; offset?:Transform };
  clipping: boolean; text?: { content: string; font: string; size: number; color: string; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right'; leading: number; tracking: number };
  shape?: { type: 'rectangle' | 'ellipse' | 'path'; width: number; height: number; fill: string; stroke: string; strokeWidth: number; points?: Point[] };
  adjustment?: Adjustment; effects: LayerEffect[]; filters: Adjustment[];
  rasterFilters?: import('./filters.ts').RasterFilter[];
};
export type ImageDocument = {
  id: string; name: string; width: number; height: number; resolution: number;
  mode: 'RGB'; depth: 8; profile: string; icc?: string;
  layers: Layer[]; activeIds: string[]; target: 'pixels' | 'mask'; selection: Uint8Array | null;
  quickMask?:boolean;savedSelections?:{id:string;name:string;pixels:Uint8Array}[];
  paths: { id: string; name: string; points: Point[]; closed: boolean }[];
  guides: { axis: 'x' | 'y'; position: number }[];
  revision: string; original?: { name: string; data: string; warnings: string[] };
};
export const uid = () => globalThis.crypto.randomUUID();
export const identity = (): Transform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) throw new Error('Use whole dimensions from 1 to 16,384 pixels, up to 64 megapixels.');
}
export function surface(width: number, height: number, base: RGBA = [0, 0, 0, 0]): Surface {
  dimensions(width, height); return { width, height, base: [...base], tiles: {} };
}
export function layer(name = 'Layer 1', kind: Layer['kind'] = 'raster'): Layer {
  return { id: uid(), name, kind, visible: true, locked: false, opacity: 1, fill: 1, blend: kind === 'group' ? 'pass through' : 'normal', transform: identity(), clipping: false, effects: [], filters: [], ...(kind === 'group' ? { children: [], expanded: true } : {}) };
}
export function newDocument(width = 1600, height = 1000, name = 'Untitled-1', background: RGBA = [255, 255, 255, 255]): ImageDocument {
  dimensions(width, height);
  const base = { ...layer(background[3] ? 'Background' : 'Layer 1'), pixels: surface(width, height, background), locked: background[3] === 255 };
  return { id: uid(), name, width, height, resolution: 72, mode: 'RGB', depth: 8, profile: 'sRGB IEC61966-2.1', layers: [base], activeIds: [base.id], target: 'pixels', selection: null, paths: [], guides: [], revision: uid() };
}
export function allLayers(layers: Layer[]): Layer[] { return layers.flatMap(item => [item, ...allLayers(item.children || [])]); }
export function findLayer(doc: ImageDocument, id = doc.activeIds[0]): Layer | undefined { return allLayers(doc.layers).find(item => item.id === id); }
export function updateLayer(doc: ImageDocument, id: string, updater: (value: Layer) => Layer): ImageDocument {
  const walk = (items: Layer[]): Layer[] => items.map(item => item.id === id ? updater(item) : item.children ? { ...item, children: walk(item.children) } : item);
  const next = { ...doc, layers: walk(doc.layers) };
  // Removing an active mask must also leave mask editing. Otherwise the next
  // brush stroke can apply grayscale mask paint to the layer's color pixels.
  if (next.target === 'mask' && !findLayer(next)?.mask) next.target = 'pixels';
  return next;
}
export function removeLayers(doc: ImageDocument, ids: string[]): ImageDocument {
  const walk = (items: Layer[]): Layer[] => items.filter(item => !ids.includes(item.id)).map(item => item.children ? { ...item, children: walk(item.children) } : item);
  const layers = walk(doc.layers); const remaining = allLayers(layers);
  return { ...doc, layers, activeIds: remaining.length ? [remaining[remaining.length - 1].id] : [], target: 'pixels' };
}
export function addLayer(doc: ImageDocument, value: Layer): ImageDocument {
  let inserted = false;
  const walk = (items: Layer[]): Layer[] => items.flatMap(item => {
    if (item.id === doc.activeIds[0]) { inserted = true; return [item, value]; }
    return [{ ...item, ...(item.children ? { children: walk(item.children) } : {}) }];
  });
  const layers = walk(doc.layers);
  return { ...doc, layers: inserted ? layers : [...layers, value], activeIds: [value.id], target: 'pixels' };
}
export function duplicateLayer(doc: ImageDocument): ImageDocument {
  const active = findLayer(doc); if (!active) return doc;
  const clone = (value: Layer): Layer => ({ ...value, id: uid(), ...(value.children ? { children: value.children.map(clone) } : {}) });
  return addLayer(doc, { ...clone(active), name: `${active.name} copy` });
}
export function groupLayers(doc: ImageDocument): ImageDocument {
  // Only siblings are grouped; nesting remains intact.
  let groupedId = '';
  const walk = (items: Layer[]): Layer[] => {
    const selected = items.filter(item => doc.activeIds.includes(item.id));
    if (selected.length) {
      const group = { ...layer('Group 1', 'group'), children: selected }; groupedId = group.id;
      const index = items.findIndex(item => item.id === selected[0].id);
      return [...items.slice(0, index), group, ...items.slice(index).filter(item => !doc.activeIds.includes(item.id))];
    }
    return items.map(item => item.children ? { ...item, children: walk(item.children) } : item);
  };
  const layers = walk(doc.layers); return { ...doc, layers, activeIds: groupedId ? [groupedId] : doc.activeIds, target: 'pixels' };
}
export function reorderLayer(doc: ImageDocument, sourceId: string, destinationId: string, inside = false): ImageDocument {
  const source = findLayer(doc, sourceId); const dest = findLayer(doc, destinationId);
  if (!source || !dest || sourceId === destinationId || allLayers(source.children || []).some(item => item.id === destinationId)) return doc;
  const stripped = removeLayers(doc, [sourceId]);
  const walk = (items: Layer[]): Layer[] => items.flatMap(item => item.id === destinationId
    ? inside && item.kind === 'group' ? [{ ...item, expanded: true, children: [...(item.children || []), source] }] : [item, source]
    : [item.children ? { ...item, children: walk(item.children) } : item]);
  return { ...stripped, layers: walk(stripped.layers), activeIds: [sourceId] };
}
export function toLocal(point: Point, transform: Transform): Point {
  return transformPoint(point,inverse(matrixOf(transform)));
}
export function toDocument(point: Point, transform: Transform): Point {
  return transformPoint(point,matrixOf(transform));
}
export function maskTransform(layer:Layer):Transform{
  if(!layer.mask||layer.mask.linked&&!layer.mask.offset)return layer.transform;
  if(!layer.mask.linked)return layer.mask.transform;
  return transformOf(multiply(matrixOf(layer.transform),matrixOf(layer.mask.offset!)));
}
export function setMaskLinked(layer:Layer,linked:boolean):Layer{
  if(!layer.mask||layer.mask.linked===linked)return layer;const world=maskTransform(layer);
  if(!linked)return {...layer,mask:{...layer.mask,linked:false,transform:world,offset:undefined}};
  return {...layer,mask:{...layer.mask,linked:true,offset:transformOf(multiply(inverse(matrixOf(layer.transform)),matrixOf(world)))}};
}
export function color(value: string): RGBA {
  const hex = value.replace('#', ''); return [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0, parseInt(hex.slice(4, 6), 16) || 0, 255];
}
export const hexColor = (rgba: number[]) => '#' + rgba.slice(0, 3).map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('');
import { inverse, matrixOf, multiply, transformOf, transformPoint } from './matrix.ts';
