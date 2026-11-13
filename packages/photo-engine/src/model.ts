export const ENGINE_VERSION = 'lope-photo/1.0.0';
export type Point = { x: number; y: number };
export type Crop = { x: number; y: number; width: number; height: number };
export const adjustments = {
  exposure: { label: 'Exposure', min: -5, max: 5, step: .01 },
  contrast: { label: 'Contrast', min: -100, max: 100, step: 1 },
  highlights: { label: 'Highlights', min: -100, max: 100, step: 1 },
  shadows: { label: 'Shadows', min: -100, max: 100, step: 1 },
  whites: { label: 'Whites', min: -100, max: 100, step: 1 },
  blacks: { label: 'Blacks', min: -100, max: 100, step: 1 },
  temperature: { label: 'Temperature', min: -100, max: 100, step: 1 },
  tint: { label: 'Tint', min: -100, max: 100, step: 1 },
  vibrance: { label: 'Vibrance', min: -100, max: 100, step: 1 },
  saturation: { label: 'Saturation', min: -100, max: 100, step: 1 },
  texture: { label: 'Texture', min: -100, max: 100, step: 1 },
  clarity: { label: 'Clarity', min: -100, max: 100, step: 1 },
  dehaze: { label: 'Dehaze', min: -100, max: 100, step: 1 },
  vignette: { label: 'Vignette', min: -100, max: 100, step: 1 },
  grain: { label: 'Grain', min: 0, max: 100, step: 1 },
  sharpening: { label: 'Sharpening', min: 0, max: 100, step: 1 },
  noise: { label: 'Luminance noise', min: 0, max: 100, step: 1 },
  colorNoise: { label: 'Color noise', min: 0, max: 100, step: 1 },
  distortion: { label: 'Distortion', min: -100, max: 100, step: 1 },
  fringing: { label: 'Red / blue alignment', min: -100, max: 100, step: 1 },
  straighten: { label: 'Straighten', min: -45, max: 45, step: .1 },
  vertical: { label: 'Vertical', min: -100, max: 100, step: 1 },
  horizontal: { label: 'Horizontal', min: -100, max: 100, step: 1 },
} as const;
export type Adjustment = keyof typeof adjustments;
export type Values = Record<Adjustment, number>;
export type MaskComponent = {
  id: string; type: 'brush' | 'linear' | 'radial' | 'luminance' | 'color';
  mode: 'add' | 'subtract' | 'intersect'; start: Point; end: Point;
  points: Point[]; radius: number; feather: number; density: number;
  range: [number, number]; color: [number, number, number];
};
export type PhotoMask = { id: string; name: string; enabled: boolean; inverted: boolean; components: MaskComponent[]; exposure: number; saturation: number; temperature: number };
export type Retouch = { id: string; type: 'clone' | 'heal'; target: Point; source: Point; radius: number; feather: number };
export type Recipe = {
  version: 1; engine: string; profile: 'color' | 'neutral' | 'monochrome'; values: Values;
  curve: Point[]; mixer: { hue: number; saturation: number; luminance: number }[];
  grading: { shadows: [number, number]; midtones: [number, number]; highlights: [number, number] };
  crop: Crop; rotation: number; flipX: boolean; flipY: boolean; masks: PhotoMask[]; retouch: Retouch[];
};
export type FloatImage = { width: number; height: number; data: Float32Array };
export type PhotoMetadata = {
  width: number; height: number; bitDepth: number; format: string; decoder: string;
  colorSpace: string; orientation: number; camera?: string; lens?: string; iso?: number;
  shutter?: number; aperture?: number; focalLength?: number; captured?: string;
  warnings: string[]; raw: boolean;
};
export type Culling = { sharpness: number; exposure: number; score: number; clipped: number; method: 'edge-energy-and-luminance-v1' };
export type PhotoVersion = { id: string; name: string; created: string; recipe: Recipe };
export type HistoryEntry = { label: string; recipe: Recipe; at: string; transactionId?: string };
export type Asset = {
  id: string; name: string; hash: string; imported: string; size: number;
  metadata: PhotoMetadata; thumbnail: Blob; recipe: Recipe; history: HistoryEntry[]; future: HistoryEntry[];
  rating: number; flag: 'pick' | 'reject' | 'none'; label: string; keywords: string[];
  albumIds: string[]; stackId?: string; order: number; trashed?: string;
  versions: PhotoVersion[]; analysis?: Culling;
  storage: 'managed' | 'workspace'; path?: string; sourceVersion?: string; parentId?: string;
  enhancement?: import('./denoise.ts').DenoiseProvenance;
  sidecars?: { name: string; text: string; report: string[] }[];
};
export type Album = { id: string; name: string; parentId?: string; type: 'album' | 'folder' | 'smart'; rules?: { rating: number; flag: string; text: string } };
export function defaultRecipe(): Recipe {
  return { version: 1, engine: ENGINE_VERSION, profile: 'color', values: Object.fromEntries(Object.keys(adjustments).map(k => [k, 0])) as Values,
    curve: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mixer: Array.from({ length: 8 }, () => ({ hue: 0, saturation: 0, luminance: 0 })),
    grading: { shadows: [0, 0], midtones: [0, 0], highlights: [0, 0] }, crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, flipX: false, flipY: false, masks: [], retouch: [] };
}
export const cloneRecipe = (recipe: Recipe): Recipe => structuredClone(recipe);
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function validateRecipe(input: unknown): Recipe {
  if (!input || typeof input !== 'object') throw new Error('Invalid photo recipe.');
  const r = input as Recipe;
  if (r.version !== 1 || !['color', 'neutral', 'monochrome'].includes(r.profile) || !r.values) throw new Error('Unsupported photo recipe version or profile.');
  for (const [key, spec] of Object.entries(adjustments)) { const n = r.values[key as Adjustment]; if (!Number.isFinite(n) || n < spec.min || n > spec.max) throw new Error(`Invalid ${spec.label} value.`); }
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  if (!r.crop || !point(r.crop) || !Number.isFinite(r.crop.width) || !Number.isFinite(r.crop.height) || r.crop.width < .005 || r.crop.height < .005 || r.crop.x + r.crop.width > 1.00001 || r.crop.y + r.crop.height > 1.00001 || ![0,90,180,270].includes(r.rotation)) throw new Error('Invalid crop or rotation.');
  if (!Array.isArray(r.curve) || r.curve.length < 2 || r.curve.length > 32 || !r.curve.every(point) || r.curve.some((p,i) => i > 0 && p.x <= r.curve[i-1].x)) throw new Error('Invalid tone curve.');
  if (!Array.isArray(r.masks) || r.masks.length > 64 || !Array.isArray(r.retouch) || r.retouch.length > 256 || !Array.isArray(r.mixer) || r.mixer.length !== 8) throw new Error('Recipe exceeds supported adjustment limits.');
  for (const c of r.mixer) if (!['hue','saturation','luminance'].every(k => Number.isFinite(c[k as keyof typeof c]) && Math.abs(c[k as keyof typeof c]) <= 100)) throw new Error('Invalid color mixer.');
  if (!r.grading || !['shadows','midtones','highlights'].every(k => { const v=r.grading[k as keyof typeof r.grading]; return Array.isArray(v)&&v.length===2&&Number.isFinite(v[0])&&v[0]>=0&&v[0]<=360&&Number.isFinite(v[1])&&v[1]>=0&&v[1]<=100; })) throw new Error('Invalid color grading.');
  for (const m of r.masks) {
    if (!Array.isArray(m.components) || m.components.length > 512 || !Number.isFinite(m.exposure) || Math.abs(m.exposure)>5 || !Number.isFinite(m.saturation)||Math.abs(m.saturation)>100||!Number.isFinite(m.temperature)||Math.abs(m.temperature)>100) throw new Error('Invalid mask.');
    for (const c of m.components) if (!['brush','linear','radial','luminance','color'].includes(c.type) || !['add','subtract','intersect'].includes(c.mode) || !point(c.start) || !point(c.end) || !Array.isArray(c.points) || c.points.length > 10000 || !c.points.every(point) || !Number.isFinite(c.radius) || c.radius <= 0 || c.radius>2 || !Number.isFinite(c.feather) || c.feather<0||c.feather>1 || !Number.isFinite(c.density)||c.density<0||c.density>1 || !Array.isArray(c.range)||c.range.length!==2||c.range.some(v=>!Number.isFinite(v)||v<0||v>1)||!Array.isArray(c.color)||c.color.length!==3||c.color.some(v=>!Number.isFinite(v)||v<0||v>1)) throw new Error('Invalid mask component.');
  }
  for (const p of r.retouch) if (!['clone','heal'].includes(p.type)||!point(p.source)||!point(p.target)||!Number.isFinite(p.radius)||p.radius<=0||p.radius>1||!Number.isFinite(p.feather)||p.feather<0||p.feather>1) throw new Error('Invalid retouch operation.');
  return cloneRecipe(r);
}
export function commitRecipe(asset: Asset, recipe: Recipe, label: string): Asset {
  const next = validateRecipe(recipe);
  if (JSON.stringify(asset.recipe) === JSON.stringify(next)) return asset;
  return { ...asset, recipe: next, history: [...asset.history.slice(-79), { label, recipe: cloneRecipe(asset.recipe), at: new Date().toISOString() }], future: [] };
}
export function undoRecipe(asset: Asset, redo = false): Asset {
  const stack = redo ? asset.future : asset.history; const previous = stack.at(-1); if (!previous) return asset;
  const entry = { label: previous.label, recipe: cloneRecipe(asset.recipe), at: new Date().toISOString(), transactionId: previous.transactionId };
  return { ...asset, recipe: cloneRecipe(previous.recipe), history: redo ? [...asset.history, entry] : asset.history.slice(0,-1), future: redo ? asset.future.slice(0,-1) : [...asset.future, entry] };
}
export function newMask(type: MaskComponent['type'], index = 1): PhotoMask {
  return { id: crypto.randomUUID(), name: `Mask ${index}`, enabled: true, inverted: false, exposure: .5, saturation: 0, temperature: 0,
    components: [{ id: crypto.randomUUID(), type, mode: 'add', start: { x: .5, y: .2 }, end: { x: .5, y: .75 }, points: [], radius: .12, feather: .75, density: 1, range: [.3,.8], color: [.5,.5,.5] }] };
}
