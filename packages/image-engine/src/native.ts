import { BLEND_MODES, TILE, dimensions, type Adjustment, type ImageDocument, type Surface, type Transform } from './model.ts';
export const NATIVE_FORMAT = 'lope-image';
export function toBase64(data: Uint8Array | Uint8ClampedArray): string { let text = ''; for (let i = 0; i < data.length; i += 16384) text += String.fromCharCode(...data.subarray(i, i + 16384)); return btoa(text); }
export function fromBase64(value: string): Uint8Array { const text = atob(value); return Uint8Array.from(text, c => c.charCodeAt(0)); }
export function serializeDocument(document: ImageDocument): string {
  let allocated=0;
  const content=JSON.stringify({ format: NATIVE_FORMAT, version: 1, document }, (_key, value) => {
    if(value instanceof Uint8Array||value instanceof Uint8ClampedArray){allocated+=Math.ceil(value.byteLength/3)*3;if(allocated>384*1024*1024)throw new Error('This project exceeds the native format’s 384 MiB decoded pixel budget. Save smaller documents or export a copy.');const data=toBase64(value);return value instanceof Uint8ClampedArray?{$pixels:data}:{$bytes:data};}
    return value;
  });
  if(content.length>512*1024*1024)throw new Error('This project exceeds the native format’s 512 MiB file limit.');
  return content;
}
export function deserializeDocument(content: string): ImageDocument {
  if (content.length > 512 * 1024 * 1024) throw new Error('Project exceeds the 512 MiB input limit.');
  let allocated = 0;
  const parsed = JSON.parse(content, (_key, value) => {
    if (value && typeof value === 'object' && ('$pixels' in value || '$bytes' in value)) {
      const raw = value.$pixels ?? value.$bytes; if (typeof raw !== 'string') throw new Error('Invalid project pixel data.');
      allocated += raw.length * .75; if (allocated > 384 * 1024 * 1024) throw new Error('Project exceeds the 384 MiB pixel budget.');
      const bytes = fromBase64(raw); return '$pixels' in value ? new Uint8ClampedArray(bytes) : bytes;
    }
    return value;
  });
  if (!parsed || parsed.format !== NATIVE_FORMAT || parsed.version !== 1) throw new Error('This is not a supported Lope Image project.');
  const doc = parsed.document as ImageDocument;
  if (!doc || typeof doc !== 'object') throw new Error('Invalid document.');
  dimensions(doc.width, doc.height);
  if (doc.mode !== 'RGB' || doc.depth !== 8 || !Array.isArray(doc.layers) || !Array.isArray(doc.activeIds)) throw new Error('Invalid RGB/8 document.');
  if (typeof doc.id !== 'string' || typeof doc.name !== 'string' || typeof doc.revision !== 'string' || typeof doc.profile !== 'string' || !Number.isFinite(doc.resolution) || doc.resolution <= 0 || !['pixels', 'mask'].includes(doc.target)) throw new Error('Invalid document metadata.');
  if (!Array.isArray(doc.paths) || !Array.isArray(doc.guides)) throw new Error('Invalid document paths or guides.');
  const validPoint = (point: { x: number; y: number }) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  if (doc.paths.some(path => !path || typeof path.id !== 'string' || typeof path.name !== 'string' || typeof path.closed !== 'boolean' || !Array.isArray(path.points) || !path.points.every(validPoint)) || doc.guides.some(guide => !guide || !['x', 'y'].includes(guide.axis) || !Number.isFinite(guide.position))) throw new Error('Invalid document paths or guides.');
  let count = 0; const ids = new Set<string>();
  const validTransform = (transform: Transform) => transform && [transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite) && (transform.skewX === undefined || Number.isFinite(transform.skewX)) && Math.abs(transform.scaleX) > .00001 && Math.abs(transform.scaleY) > .00001;
  const validAdjustment = (adjustment: Adjustment) => adjustment && ['brightness', 'levels', 'curves', 'hue', 'balance', 'exposure', 'vibrance', 'black-white', 'photo-filter', 'channel-mixer', 'invert', 'posterize', 'threshold', 'gradient-map'].includes(adjustment.type) && Array.isArray(adjustment.values) && adjustment.values.every(Number.isFinite);
  const checkSurface = (surface?: Surface) => {
    if (!surface) return; dimensions(surface.width, surface.height);
    if (!Array.isArray(surface.base) || surface.base.length !== 4 || !surface.base.every(n => Number.isFinite(n) && n >= 0 && n <= 255) || !surface.tiles || typeof surface.tiles !== 'object') throw new Error('Invalid pixel surface.');
    for (const [key, value] of Object.entries(surface.tiles)) { const [x, y] = key.split(',').map(Number); if (!/^\d+,\d+$/.test(key) || x * TILE >= surface.width || y * TILE >= surface.height || !(value instanceof Uint8ClampedArray) || value.length !== TILE * TILE * 4) throw new Error('Invalid pixel tile.'); }
  };
  const checkLayers = (items: ImageDocument['layers'], depth = 0) => {
    if (depth > 24) throw new Error('Layer nesting exceeds 24 groups.');
    if (!Array.isArray(items)) throw new Error('Invalid layer children.');
    for (const item of items) { if (++count > 1024 || !item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name!=='string' || !['raster', 'text', 'shape', 'group', 'adjustment', 'embedded'].includes(item.kind) || !validTransform(item.transform) || !Number.isFinite(item.opacity) || item.opacity<0 || item.opacity>1 || !Number.isFinite(item.fill) || item.fill<0 || item.fill>1 || ![...BLEND_MODES,'pass through'].includes(item.blend) || !Array.isArray(item.effects) || !Array.isArray(item.filters) || typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean' || typeof item.clipping !== 'boolean') throw new Error('Invalid layer structure.');
      if (item.mask && (!item.mask.pixels || typeof item.mask.enabled !== 'boolean' || typeof item.mask.linked !== 'boolean' || !validTransform(item.mask.transform) || item.mask.offset && !validTransform(item.mask.offset))) throw new Error('Invalid mask transform or pixels.');
      if (!item.filters.every(validAdjustment) || item.adjustment && !validAdjustment(item.adjustment)) throw new Error('Invalid adjustment data.');
      if (item.effects.some(effect => !effect || !['stroke', 'shadow', 'overlay'].includes(effect.type) || typeof effect.color !== 'string' || ![effect.size, effect.opacity, effect.x, effect.y].every(Number.isFinite))) throw new Error('Invalid layer effect.');
      if (item.rasterFilters !== undefined && !Array.isArray(item.rasterFilters)) throw new Error('Invalid raster filter list.');
      for (const filter of item.rasterFilters || []) {
        if (!filter || !['gaussian-blur', 'box-blur', 'motion-blur', 'sharpen', 'unsharp-mask', 'high-pass', 'add-noise', 'mosaic', 'emboss', 'find-edges', 'solarize', 'invert', 'grayscale'].includes(filter.type) || ![filter.radius, filter.amount, filter.threshold].every(Number.isFinite) || filter.angle !== undefined && !Number.isFinite(filter.angle) || filter.seed !== undefined && !Number.isFinite(filter.seed) || filter.origin && !validPoint(filter.origin)) throw new Error('Invalid raster filter.');
        if (filter.mask) { if (!filter.mask.pixels || !validTransform(filter.mask.transform)) throw new Error('Invalid Smart Filter mask transform.'); checkSurface(filter.mask.pixels); }
      }
      if (item.text && (typeof item.text.content !== 'string' || typeof item.text.font !== 'string' || typeof item.text.color !== 'string' || !Number.isFinite(item.text.size) || item.text.size < 1 || item.text.size > 2500 || !Number.isFinite(item.text.leading) || item.text.leading <= 0 || !Number.isFinite(item.text.tracking) || !['left', 'center', 'right'].includes(item.text.align))) throw new Error('Invalid text layer.');
      if (item.shape && (!['rectangle', 'ellipse', 'path'].includes(item.shape.type) || ![item.shape.width, item.shape.height, item.shape.strokeWidth].every(Number.isFinite) || item.shape.width <= 0 || item.shape.height <= 0 || typeof item.shape.fill !== 'string' || typeof item.shape.stroke !== 'string' || item.shape.points !== undefined && (!Array.isArray(item.shape.points) || !item.shape.points.every(validPoint)))) throw new Error('Invalid shape layer.');
      ids.add(item.id); checkSurface(item.pixels); checkSurface(item.source); checkSurface(item.mask?.pixels); if (item.children) checkLayers(item.children, depth + 1); }
  };
  checkLayers(doc.layers);
  if (new Set(doc.activeIds).size !== doc.activeIds.length || doc.activeIds.some(id => !ids.has(id))) throw new Error('Invalid active layer selection.');
  if (doc.selection && (!(doc.selection instanceof Uint8Array) || doc.selection.length !== doc.width * doc.height)) throw new Error('Invalid selection mask.');
  if (doc.savedSelections !== undefined && (!Array.isArray(doc.savedSelections) || doc.savedSelections.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string' || !(s.pixels instanceof Uint8Array) || s.pixels.length !== doc.width * doc.height))) throw new Error('Invalid saved selection.');
  return doc;
}
