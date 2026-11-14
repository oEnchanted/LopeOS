import { drawShapes, transformShapes, type Shape } from './markup';

/** Raster canvases are treated as immutable: every operation returns a new canvas, so undo can keep references. */
export function canvas(width: number, height: number) {
  const element = document.createElement('canvas'); element.width = Math.max(1, Math.round(width)); element.height = Math.max(1, Math.round(height)); return element;
}
export const context2d = (element: HTMLCanvasElement) => element.getContext('2d', { willReadFrequently: false })!;
export function fromImageData(image: ImageData | { width: number; height: number; data: Uint8ClampedArray }) {
  const out = canvas(image.width, image.height);
  context2d(out).putImageData(image instanceof ImageData ? image : new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  return out;
}
export function fromSource(source: CanvasImageSource, width: number, height: number) { const out = canvas(width, height); context2d(out).drawImage(source, 0, 0, width, height); return out; }
export const pixelsOf = (source: HTMLCanvasElement) => source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height);
export function hasTransparency(source: HTMLCanvasElement) {
  const data = pixelsOf(source).data; for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true; return false;
}
export interface Rect { x: number; y: number; w: number; h: number }
export type Region = { kind: 'rect' | 'ellipse'; rect: Rect } | { kind: 'lasso'; rect: Rect; points: number[] };
export function regionPath(region: Region) {
  const path = new Path2D(), r = region.rect;
  if (region.kind === 'rect') path.rect(r.x, r.y, r.w, r.h);
  else if (region.kind === 'ellipse') path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  else if (region.kind === 'lasso') { const p = region.points; path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); path.closePath(); }
  return path;
}
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  return { x, y, w: Math.max(0, Math.min(width, Math.ceil(r.x + r.w)) - x), h: Math.max(0, Math.min(height, Math.ceil(r.y + r.h)) - y) };
}

export interface Edit { raster: HTMLCanvasElement; shapes: Shape[] }
const transformImage = (draw: (context: CanvasRenderingContext2D, source: HTMLCanvasElement) => void, swap: boolean) => (source: HTMLCanvasElement) => {
  const out = canvas(swap ? source.height : source.width, swap ? source.width : source.height); draw(context2d(out), source); return out;
};
export function rotate({ raster, shapes }: Edit, clockwise: boolean): Edit {
  const w = raster.width, h = raster.height;
  const draw = (context: CanvasRenderingContext2D, source: HTMLCanvasElement) => { context.translate(clockwise ? source.height : 0, clockwise ? 0 : source.width); context.rotate(clockwise ? Math.PI / 2 : -Math.PI / 2); context.drawImage(source, 0, 0); };
  return { raster: transformImage(draw, true)(raster), shapes: transformShapes(shapes, (x, y) => clockwise ? [h - y, x] : [y, w - x], 1, transformImage(draw, true)) };
}
export function flip({ raster, shapes }: Edit, horizontal: boolean): Edit {
  const w = raster.width, h = raster.height;
  const draw = (context: CanvasRenderingContext2D, source: HTMLCanvasElement) => { context.translate(horizontal ? source.width : 0, horizontal ? 0 : source.height); context.scale(horizontal ? -1 : 1, horizontal ? 1 : -1); context.drawImage(source, 0, 0); };
  return { raster: transformImage(draw, false)(raster), shapes: transformShapes(shapes, (x, y) => horizontal ? [w - x, y] : [x, h - y], 1, transformImage(draw, false)) };
}
export function crop({ raster, shapes }: Edit, region: Region): Edit {
  const r = clampRect(region.rect, raster.width, raster.height); if (!r.w || !r.h) return { raster, shapes };
  const out = canvas(r.w, r.h), context = context2d(out);
  if (region.kind !== 'rect') { context.translate(-r.x, -r.y); context.clip(regionPath(region)); context.setTransform(1, 0, 0, 1, 0, 0); }
  context.drawImage(raster, -r.x, -r.y);
  return { raster: out, shapes: transformShapes(shapes, (x, y) => [x - r.x, y - r.y]) };
}
/** Clears the selection to transparency, or to white for formats that cannot store alpha. */
export function clearRegion(raster: HTMLCanvasElement, region: Region, opaque: boolean, invert = false) {
  const out = fromSource(raster, raster.width, raster.height), context = context2d(out), path = regionPath(region);
  if (invert) { const outside = new Path2D(); outside.rect(0, 0, raster.width, raster.height); outside.addPath(path); context.save(); context.clip(outside, 'evenodd'); }
  else { context.save(); context.clip(path); }
  if (opaque) { context.fillStyle = '#fff'; context.fillRect(0, 0, out.width, out.height); } else context.clearRect(0, 0, out.width, out.height);
  context.restore(); return out;
}
/** High-quality downscaling halves repeatedly before the final draw. */
export function resample(source: HTMLCanvasElement, width: number, height: number) {
  let current = source;
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const half = canvas(current.width / 2, current.height / 2), context = context2d(half);
    context.imageSmoothingQuality = 'high'; context.drawImage(current, 0, 0, half.width, half.height); current = half;
  }
  const out = canvas(width, height), context = context2d(out);
  context.imageSmoothingQuality = 'high'; context.drawImage(current, 0, 0, out.width, out.height); return out;
}
export function resize({ raster, shapes }: Edit, width: number, height: number): Edit {
  const sx = width / raster.width, sy = height / raster.height;
  return { raster: resample(raster, width, height), shapes: transformShapes(shapes, (x, y) => [x * sx, y * sy], Math.sqrt(sx * sy), image => resample(image, Math.max(1, image.width * sx), Math.max(1, image.height * sy))) };
}
export function flatten(raster: HTMLCanvasElement, shapes: Shape[], background?: string) {
  const out = canvas(raster.width, raster.height), context = context2d(out);
  if (background) { context.fillStyle = background; context.fillRect(0, 0, out.width, out.height); }
  context.drawImage(raster, 0, 0); drawShapes(context, shapes); return out;
}

// ---------- Adjust Color ----------
export interface ColorAdjust { exposure: number; contrast: number; highlights: number; shadows: number; saturation: number; temperature: number; tint: number; sepia: number; sharpness: number; black: number; white: number; gamma: number }
export const neutralAdjust: ColorAdjust = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0, sepia: 0, sharpness: 0, black: 0, white: 1, gamma: 1 };
export const isNeutral = (a: ColorAdjust) => (Object.keys(neutralAdjust) as (keyof ColorAdjust)[]).every(key => Math.abs(a[key] - neutralAdjust[key]) < 1e-6);
const toLinear = (n: number) => n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
const toSrgb = (n: number) => n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
const clamp = (n: number) => n < 0 ? 0 : n > 1 ? 1 : n;
function luts(a: ColorAdjust) {
  const tables = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  const gains = [1 + a.temperature / 100 * 0.16, 1 - a.tint / 100 * 0.12, 1 - a.temperature / 100 * 0.16];
  const shadows = a.shadows / 100, highlights = a.highlights / 100, contrast = a.contrast / 100, range = Math.max(1e-3, a.white - a.black), exposure = Math.pow(2, a.exposure);
  for (let i = 0; i < 256; i++) {
    let v = clamp((i / 255 - a.black) / range);
    v = Math.pow(v, 1 / a.gamma);
    v = clamp(toSrgb(clamp(toLinear(v) * exposure)));
    v += shadows * Math.pow(1 - v, 3) * v * 2.4 + highlights * Math.pow(v, 3) * (1 - v) * 2.4;
    v = 0.5 + (v - 0.5) * (contrast >= 0 ? 1 + contrast * 1.4 : 1 + contrast);
    for (let c = 0; c < 3; c++) tables[c][i] = Math.round(clamp(v * gains[c]) * 255);
  }
  return tables;
}
export function adjustPixels(source: ImageData, a: ColorAdjust): ImageData {
  const [lr, lg, lb] = luts(a), input = source.data, out = new ImageData(source.width, source.height), data = out.data;
  const saturation = a.saturation, sepia = a.sepia / 100;
  for (let i = 0; i < input.length; i += 4) {
    let r = lr[input[i]], g = lg[input[i + 1]], b = lb[input[i + 2]];
    if (saturation !== 1) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * saturation; g = l + (g - l) * saturation; b = l + (b - l) * saturation; }
    if (sepia) { const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b; r += (sr - r) * sepia; g += (sg - g) * sepia; b += (sb - b) * sepia; }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = input[i + 3];
  }
  if (a.sharpness) sharpen(out, a.sharpness / 100);
  return out;
}
function sharpen(image: ImageData, amount: number) {
  const { width, height, data } = image, copy = new Uint8ClampedArray(data), strength = amount > 0 ? amount * 1.6 : amount;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= height) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= width) continue; sum += copy[(yy * width + xx) * 4 + c]; n++; } }
      const blur = sum / n, v = copy[i + c];
      data[i + c] = strength > 0 ? v + (v - blur) * strength : v + (blur - v) * -strength;
    }
  }
}
export function adjustCanvas(source: HTMLCanvasElement, a: ColorAdjust) { return fromImageData(adjustPixels(pixelsOf(source), a)); }
export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; max: number }
export function histogram(image: ImageData): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), d = image.data;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; }
  let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, r[i], g[i], b[i]);
  return { r, g, b, max };
}
/** Auto Levels: clip half a percent at each end of the luminance histogram and center the midtones. */
export function autoLevels(image: ImageData): Pick<ColorAdjust, 'black' | 'white' | 'gamma'> {
  const counts = new Uint32Array(256), d = image.data; let total = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); counts[l]++; total++; }
  if (!total) return { black: 0, white: 1, gamma: 1 };
  let low = 0, high = 255;
  for (let acc = 0; low < 255 && (acc += counts[low]) < total * 0.005; low++);
  for (let acc = 0; high > 0 && (acc += counts[high]) < total * 0.005; high--);
  if (high - low < 10) return { black: 0, white: 1, gamma: 1 };
  for (let i = 0; i < 256; i++) sum += counts[i] * clamp((i - low) / (high - low));
  const mean = Math.max(0.05, Math.min(0.95, sum / total)), gamma = Math.max(0.4, Math.min(2.5, Math.log(mean) / Math.log(0.5)));
  return { black: low / 255, white: high / 255, gamma };
}

// ---------- Instant Alpha ----------
/** Selects pixels contiguous with the seed whose color is within the tolerance. */
export function floodMask(image: ImageData, sx: number, sy: number, tolerance: number): Uint8Array {
  const { width, height, data } = image, mask = new Uint8Array(width * height);
  sx = Math.floor(sx); sy = Math.floor(sy); if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const s = (sy * width + sx) * 4, sr = data[s], sg = data[s + 1], sb = data[s + 2], sa = data[s + 3], limit = tolerance * tolerance * 3;
  const near = (i: number) => { const p = i * 4, dr = data[p] - sr, dg = data[p + 1] - sg, db = data[p + 2] - sb, da = data[p + 3] - sa; return dr * dr + dg * dg + db * db + da * da <= limit; };
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!; let x = x0;
    while (x >= 0 && !mask[y * width + x] && near(y * width + x)) x--;
    x++; let up = false, down = false;
    for (; x < width && !mask[y * width + x] && near(y * width + x); x++) {
      mask[y * width + x] = 1;
      if (y > 0) { const n = (y - 1) * width + x; if (!mask[n] && near(n)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
      if (y < height - 1) { const n = (y + 1) * width + x; if (!mask[n] && near(n)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false; }
    }
  }
  return mask;
}
/** Tints the selected area in whichever highlight color stands out most from the clicked color. */
export function maskOverlay(mask: Uint8Array, width: number, height: number, seed: [number, number, number]) {
  const image = new ImageData(width, height), tints: [number, number, number][] = [[235, 40, 70], [30, 110, 255], [20, 200, 90]];
  const [r, g, b] = tints.reduce((best, tint) => Math.hypot(tint[0] - seed[0], tint[1] - seed[1], tint[2] - seed[2]) > Math.hypot(best[0] - seed[0], best[1] - seed[1], best[2] - seed[2]) ? tint : best);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const p = i * 4; image.data[p] = r; image.data[p + 1] = g; image.data[p + 2] = b; image.data[p + 3] = 160; }
  return fromImageData(image);
}
/** Removes the masked pixels, softening the edge by one pixel so cutouts don't look jagged. */
export function removeMasked(raster: HTMLCanvasElement, mask: Uint8Array) {
  const image = pixelsOf(raster), { width, height, data } = image;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (mask[i]) { data[i * 4 + 3] = 0; continue; }
    const edge = (x > 0 && mask[i - 1]) || (x < width - 1 && mask[i + 1]) || (y > 0 && mask[i - width]) || (y < height - 1 && mask[i + width]);
    if (edge) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * 0.55);
  }
  return fromImageData(image);
}
