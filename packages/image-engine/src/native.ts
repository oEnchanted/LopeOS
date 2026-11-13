import { BLEND_MODES, TILE, dimensions, type ImageDocument, type Surface, type Transform } from './model.ts';
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
  if (parsed.format !== NATIVE_FORMAT || parsed.version !== 1) throw new Error('This is not a supported Lope Image project.');
  const doc = parsed.document as ImageDocument; dimensions(doc.width, doc.height);
  if (doc.mode !== 'RGB' || doc.depth !== 8 || !Array.isArray(doc.layers) || !Array.isArray(doc.activeIds)) throw new Error('Invalid RGB/8 document.');
  let count = 0; const ids = new Set<string>();
  const validTransform=(transform:Transform)=>transform&&Object.values(transform).every(Number.isFinite)&&Math.abs(transform.scaleX)>.00001&&Math.abs(transform.scaleY)>.00001;
  const checkSurface = (surface?: Surface) => {
    if (!surface) return; dimensions(surface.width, surface.height);
    if (!Array.isArray(surface.base) || surface.base.length !== 4 || !surface.base.every(n => Number.isFinite(n) && n >= 0 && n <= 255) || !surface.tiles || typeof surface.tiles !== 'object') throw new Error('Invalid pixel surface.');
    for (const [key, value] of Object.entries(surface.tiles)) { const [x, y] = key.split(',').map(Number); if (!/^\d+,\d+$/.test(key) || x * TILE >= surface.width || y * TILE >= surface.height || !(value instanceof Uint8ClampedArray) || value.length !== TILE * TILE * 4) throw new Error('Invalid pixel tile.'); }
  };
  const checkLayers = (items: ImageDocument['layers'], depth = 0) => {
    if (depth > 24) throw new Error('Layer nesting exceeds 24 groups.');
    for (const item of items) { if (++count > 1024 || ids.has(item.id) || typeof item.name!=='string' || !['raster', 'text', 'shape', 'group', 'adjustment', 'embedded'].includes(item.kind) || !validTransform(item.transform) || !Number.isFinite(item.opacity) || item.opacity<0 || item.opacity>1 || !Number.isFinite(item.fill) || item.fill<0 || item.fill>1 || ![...BLEND_MODES,'pass through'].includes(item.blend) || !Array.isArray(item.effects) || !Array.isArray(item.filters)) throw new Error('Invalid layer structure.');
      if(item.mask&&(!validTransform(item.mask.transform)||item.mask.offset&&!validTransform(item.mask.offset)))throw new Error('Invalid mask transform.');
      for(const filter of item.rasterFilters||[])if(filter.mask){if(!validTransform(filter.mask.transform))throw new Error('Invalid Smart Filter mask transform.');checkSurface(filter.mask.pixels);}
      if(item.text&&(typeof item.text.content!=='string'||typeof item.text.font!=='string'||!Number.isFinite(item.text.size)||item.text.size<1||item.text.size>2500))throw new Error('Invalid text layer.');
      ids.add(item.id); checkSurface(item.pixels); checkSurface(item.source); checkSurface(item.mask?.pixels); if (item.children) checkLayers(item.children, depth + 1); }
  };
  checkLayers(doc.layers);
  if (doc.selection && (!(doc.selection instanceof Uint8Array) || doc.selection.length !== doc.width * doc.height)) throw new Error('Invalid selection mask.');
  if(doc.savedSelections?.some(s=>typeof s.name!=='string'||!(s.pixels instanceof Uint8Array)||s.pixels.length!==doc.width*doc.height))throw new Error('Invalid saved selection.');
  return doc;
}
