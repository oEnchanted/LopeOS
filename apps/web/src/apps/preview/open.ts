import { decodeDds, decodeExr, decodeFarbfeld, decodeHdr, decodeIcns, decodeIco, decodePcx, decodePnm, decodeQoi, decodeTga, decodeTiff, decodeWbmp, decodeXbm, gunzip, type Pixels } from './decoders';
import { identify, type ImageFormat } from './formats';
import { canvas, context2d, fromImageData, hasTransparency } from './raster';

export interface OpenedImage {
  raster: HTMLCanvasElement; format: ImageFormat;
  /** Original bytes shown by the browser while unedited, keeping animation and vector sharpness. */
  live?: Blob; animated: boolean; frames?: number;
  details: [string, string][]; exif: [string, string][]; alpha: boolean; dpi?: number;
}
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

function animation(bytes: Uint8Array, format: ImageFormat): number {
  const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (format.id === 'gif') { let frames = 0; for (let i = 13; i < bytes.length - 9; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4 && bytes[i + 7] === 0 && bytes[i + 8] === 0x2c) frames++; return frames; }
  if (format.id === 'png') { for (let p = 8; p + 8 < bytes.length && p < 1 << 20;) { const length = (bytes[p] << 24 | bytes[p + 1] << 16 | bytes[p + 2] << 8 | bytes[p + 3]) >>> 0, type = text(p + 4, p + 8); if (type === 'acTL') return (bytes[p + 8] << 24 | bytes[p + 9] << 16 | bytes[p + 10] << 8 | bytes[p + 11]) >>> 0; if (type === 'IDAT') break; p += length + 12; } }
  if (format.id === 'webp' && text(12, 16) === 'VP8X' && bytes[20] & 2) { let frames = 0; for (let p = 12; p + 8 < bytes.length;) { const length = bytes[p + 4] | bytes[p + 5] << 8 | bytes[p + 6] << 16 | bytes[p + 7] << 24; if (text(p, p + 4) === 'ANMF') frames++; p += 8 + length + (length & 1); } return frames; }
  return 0;
}
function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    image.src = url;
  });
}
async function browserRaster(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    try { const out = canvas(bitmap.width, bitmap.height); context2d(out).drawImage(bitmap, 0, 0); return out; } finally { bitmap.close(); }
  } catch {
    const image = await loadImage(blob);
    const out = canvas(image.naturalWidth, image.naturalHeight); context2d(out).drawImage(image, 0, 0); return out;
  }
}
function unavailable(format: ImageFormat) {
  if (format.id === 'heic') return new Error('This browser can’t decode HEIF/HEIC photos. Open the photo in Safari, or export it from your phone as JPEG.');
  return new Error(`This browser can’t decode ${format.label}s. Try opening it in a browser that supports ${format.label.replace(/ image$/, '')}.`);
}
function exifDetails(bytes: Uint8Array, metadata: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [], add = (label: string, value: unknown) => { if (value !== undefined && value !== null && value !== '' && !(typeof value === 'number' && !Number.isFinite(value))) rows.push([label, String(value)]); };
  add('Camera', metadata.camera); add('Lens', metadata.lens);
  if (typeof metadata.shutter === 'number' && metadata.shutter > 0) add('Exposure', metadata.shutter >= 1 ? `${metadata.shutter} s` : `1/${Math.round(1 / metadata.shutter)} s`);
  if (typeof metadata.aperture === 'number') add('Aperture', `ƒ/${+metadata.aperture.toFixed(1)}`);
  add('ISO', metadata.iso);
  if (typeof metadata.focalLength === 'number') add('Focal length', `${+metadata.focalLength.toFixed(1)} mm`);
  if (typeof metadata.captured === 'string') { const text = metadata.captured.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T'), date = new Date(text); add('Date taken', Number.isNaN(date.getTime()) ? metadata.captured : date.toLocaleString()); }
  if (typeof metadata.orientation === 'number' && metadata.orientation > 1) add('Orientation', ['', 'Normal', 'Mirrored', 'Rotated 180°', 'Flipped', 'Mirrored, rotated 90°', 'Rotated 90° clockwise', 'Mirrored, rotated 90° counterclockwise', 'Rotated 90° counterclockwise'][metadata.orientation]);
  void bytes; return rows;
}
function jpegDpi(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || String.fromCharCode(...bytes.subarray(6, 10)) !== 'JFIF') return undefined;
  const units = bytes[13], density = bytes[14] << 8 | bytes[15];
  return density > 1 ? units === 2 ? Math.round(density * 2.54) : units === 1 ? density : undefined : undefined;
}
function pngDpi(bytes: Uint8Array) {
  for (let p = 8; p + 12 < bytes.length && p < 1 << 20;) {
    const length = (bytes[p] << 24 | bytes[p + 1] << 16 | bytes[p + 2] << 8 | bytes[p + 3]) >>> 0, type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (type === 'pHYs' && bytes[p + 16] === 1) return Math.round(((bytes[p + 8] << 24 | bytes[p + 9] << 16 | bytes[p + 10] << 8 | bytes[p + 11]) >>> 0) * 0.0254);
    if (type === 'IDAT') break; p += length + 12;
  }
}
async function custom(bytes: Uint8Array, format: ImageFormat): Promise<Pixels> {
  switch (format.decoder) {
    case 'tiff': return decodeTiff(bytes);
    case 'tga': return decodeTga(bytes);
    case 'pnm': return decodePnm(bytes);
    case 'qoi': return decodeQoi(bytes);
    case 'hdr': return decodeHdr(bytes);
    case 'pcx': return decodePcx(bytes);
    case 'xbm': return decodeXbm(bytes);
    case 'wbmp': return decodeWbmp(bytes);
    case 'farbfeld': return decodeFarbfeld(bytes);
    case 'ico': return decodeIco(bytes);
    case 'icns': return decodeIcns(bytes);
    case 'dds': return decodeDds(bytes);
    case 'exr': return decodeExr(bytes);
  }
  throw new Error('No decoder is available for this format.');
}
export async function openImage(input: Uint8Array, name: string): Promise<OpenedImage> {
  if (input.byteLength > MAX_FILE_BYTES) throw new Error('This file is larger than the 512 MB Preview can open.');
  if (input.byteLength < 4) throw new Error('This file is empty or damaged.');
  const format = identify(input, name);
  let details: [string, string][] = [], exif: [string, string][] = [], live: Blob | undefined, frames = 0, raster: HTMLCanvasElement;
  const engine = format.decoder === 'browser' || format.id === 'tiff' ? await import('../../../../../packages/photo-engine/src/decode').catch(() => null) : null;
  if (engine && (format.id === 'jpeg' || format.id === 'tiff')) { try { exif = exifDetails(input, engine.metadataFromTags(engine.exifTags(input))); } catch { /* Metadata is optional. */ } }
  if (format.decoder === 'photo') {
    const { decodePhoto } = await import('../../../../../packages/photo-engine/src/decode'), { linearToSrgb } = await import('../../../../../packages/photo-engine/src/tiff');
    const { image, metadata } = await decodePhoto(new Blob([input as BlobPart]), name);
    const data = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? image.data[i] * 255 : linearToSrgb(Math.max(0, Math.min(1, image.data[i]))) * 255;
    raster = fromImageData({ width: image.width, height: image.height, data });
    exif = exifDetails(input, metadata as unknown as Record<string, unknown>);
    details = [['Decoder', metadata.decoder], ['Bit depth', `${metadata.bitDepth}-bit`]];
  } else if (format.decoder === 'svg') {
    const text = format.extensions.includes('svgz') && input[0] === 0x1f ? await gunzip(input) : input;
    live = new Blob([text as BlobPart], { type: 'image/svg+xml' });
    let image: HTMLImageElement;
    try { image = await loadImage(live); } catch { throw new Error('This SVG image couldn’t be drawn. It may be damaged or reference missing content.'); }
    let width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) { const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(new TextDecoder().decode(text.subarray(0, 8192))); width = box ? +box[1] : 1024; height = box ? +box[2] : 1024; }
    const scale = Math.min(1, 8192 / Math.max(width, height)); width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
    raster = canvas(width, height); context2d(raster).drawImage(image, 0, 0, width, height);
    details = [['Kind', 'Vector graphics, shown at its natural size']];
  } else if (format.decoder === 'browser') {
    const blob = new Blob([input as BlobPart], { type: format.mime });
    try { raster = await browserRaster(blob); } catch { throw unavailable(format); }
    frames = animation(input, format);
    if (frames > 1) live = blob;
  } else {
    let pixels: Pixels;
    try { pixels = await custom(input, format); }
    catch (cause) {
      if (format.id === 'tiff') { try { raster = await browserRaster(new Blob([input as BlobPart], { type: 'image/tiff' })); return finish(); } catch { /* Report the bundled decoder's explanation. */ } }
      throw cause;
    }
    raster = fromImageData(pixels); details = pixels.details ?? [];
  }
  return finish();
  function finish(): OpenedImage {
    const alpha = format.alpha && hasTransparency(raster);
    if (frames > 1) details.unshift(['Animation', `${frames} frames`]);
    const dpi = format.id === 'jpeg' ? jpegDpi(input) : format.id === 'png' ? pngDpi(input) : undefined;
    return { raster, format, live, animated: frames > 1, frames, details, exif, alpha, dpi };
  }
}
