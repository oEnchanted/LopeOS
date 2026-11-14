import { canvas, context2d, flatten, pixelsOf, resample } from './raster';

export interface EncodeOptions { quality: number; alpha: boolean; dpi?: number }
const blob = (source: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => source.toBlob(value => value ? resolve(value) : reject(new Error('This browser can’t encode that format.')), type, quality));
const bytes = async (value: Blob) => new Uint8Array(await value.arrayBuffer());
const opaque = (source: HTMLCanvasElement) => flatten(source, [], '#ffffff');

function bmp(source: HTMLCanvasElement, alpha: boolean, dpi = 72) {
  const { width, height, data } = pixelsOf(source), bpp = alpha ? 32 : 24, stride = Math.ceil(width * bpp / 32) * 4, header = alpha ? 108 : 40, offset = 14 + header;
  const out = new Uint8Array(offset + stride * height), v = new DataView(out.buffer);
  out[0] = 66; out[1] = 77; v.setUint32(2, out.length, true); v.setUint32(10, offset, true);
  v.setUint32(14, header, true); v.setInt32(18, width, true); v.setInt32(22, -height, true); v.setUint16(26, 1, true); v.setUint16(28, bpp, true);
  v.setUint32(30, alpha ? 3 : 0, true); v.setUint32(34, stride * height, true); v.setInt32(38, Math.round(dpi / 0.0254), true); v.setInt32(42, Math.round(dpi / 0.0254), true);
  if (alpha) { v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true); out.set([0x20, 0x6e, 0x69, 0x57], 70); }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 4, d = offset + y * stride + x * (bpp / 8), a = data[s + 3] / 255;
    if (alpha) { out[d] = data[s + 2]; out[d + 1] = data[s + 1]; out[d + 2] = data[s]; out[d + 3] = data[s + 3]; }
    else { out[d] = data[s + 2] * a + 255 * (1 - a); out[d + 1] = data[s + 1] * a + 255 * (1 - a); out[d + 2] = data[s] * a + 255 * (1 - a); }
  }
  return out;
}
function tiff(source: HTMLCanvasElement, alpha: boolean, dpi = 72) {
  const { width, height, data } = pixelsOf(alpha ? source : opaque(source)), samples = alpha ? 4 : 3, entries = alpha ? 13 : 12;
  const ifd = 8, extra = ifd + 2 + entries * 12 + 4, bitsAt = extra, resAt = extra + 8, pixelAt = resAt + 16, size = width * height * samples;
  const out = new Uint8Array(pixelAt + size), v = new DataView(out.buffer); let entry = 0;
  out.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]); v.setUint16(ifd, entries, true);
  const tag = (id: number, type: number, count: number, value: number) => { const p = ifd + 2 + entry++ * 12; v.setUint16(p, id, true); v.setUint16(p + 2, type, true); v.setUint32(p + 4, count, true); if (type === 3 && count === 1) v.setUint16(p + 8, value, true); else v.setUint32(p + 8, value, true); };
  tag(256, 4, 1, width); tag(257, 4, 1, height); tag(258, 3, samples, bitsAt); tag(259, 3, 1, 1); tag(262, 3, 1, 2); tag(273, 4, 1, pixelAt);
  tag(277, 3, 1, samples); tag(278, 4, 1, height); tag(279, 4, 1, size); tag(282, 5, 1, resAt); tag(283, 5, 1, resAt + 8); tag(296, 3, 1, 2);
  if (alpha) tag(338, 3, 1, 2);
  for (let i = 0; i < samples; i++) v.setUint16(bitsAt + i * 2, 8, true);
  v.setUint32(resAt, Math.round(dpi * 100), true); v.setUint32(resAt + 4, 100, true); v.setUint32(resAt + 8, Math.round(dpi * 100), true); v.setUint32(resAt + 12, 100, true);
  for (let i = 0, p = pixelAt; i < width * height; i++) for (let c = 0; c < samples; c++) out[p++] = data[i * 4 + c];
  return out;
}
function tga(source: HTMLCanvasElement) {
  const { width, height, data } = pixelsOf(source), out = new Uint8Array(18 + width * height * 4), v = new DataView(out.buffer);
  out[2] = 2; v.setUint16(12, width, true); v.setUint16(14, height, true); out[16] = 32; out[17] = 0x28;
  for (let i = 0; i < width * height; i++) { const s = i * 4, d = 18 + i * 4; out[d] = data[s + 2]; out[d + 1] = data[s + 1]; out[d + 2] = data[s]; out[d + 3] = data[s + 3]; }
  return out;
}
function qoi(source: HTMLCanvasElement) {
  const { width, height, data } = pixelsOf(source), out = new Uint8Array(14 + width * height * 5 + 8), v = new DataView(out.buffer), index = new Uint8Array(256);
  out.set([113, 111, 105, 102]); v.setUint32(4, width); v.setUint32(8, height); out[12] = 4; out[13] = 0;
  let p = 14, run = 0, pr = 0, pg = 0, pb = 0, pa = 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (r === pr && g === pg && b === pb && a === pa) { run++; if (run === 62 || i === data.length - 4) { out[p++] = 0xc0 | (run - 1); run = 0; } continue; }
    if (run) { out[p++] = 0xc0 | (run - 1); run = 0; }
    const h = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;
    if (index[h] === r && index[h + 1] === g && index[h + 2] === b && index[h + 3] === a) out[p++] = h / 4;
    else {
      index[h] = r; index[h + 1] = g; index[h + 2] = b; index[h + 3] = a;
      if (a === pa) {
        const dr = ((r - pr + 384) & 255) - 128, dg = ((g - pg + 384) & 255) - 128, db = ((b - pb + 384) & 255) - 128, drg = dr - dg, dbg = db - dg;
        if (dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) out[p++] = 0x40 | (dr + 2) << 4 | (dg + 2) << 2 | (db + 2);
        else if (drg > -9 && drg < 8 && dg > -33 && dg < 32 && dbg > -9 && dbg < 8) { out[p++] = 0x80 | (dg + 32); out[p++] = (drg + 8) << 4 | (dbg + 8); }
        else { out[p++] = 0xfe; out[p++] = r; out[p++] = g; out[p++] = b; }
      } else { out[p++] = 0xff; out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = a; }
    }
    pr = r; pg = g; pb = b; pa = a;
  }
  out.set([0, 0, 0, 0, 0, 0, 0, 1], p); return out.slice(0, p + 8);
}
function pnm(source: HTMLCanvasElement, alpha: boolean) {
  const { width, height, data } = pixelsOf(alpha ? source : opaque(source)), samples = alpha ? 4 : 3;
  const header = new TextEncoder().encode(alpha ? `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n` : `P6\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + width * height * samples); out.set(header);
  for (let i = 0, p = header.length; i < width * height; i++) for (let c = 0; c < samples; c++) out[p++] = data[i * 4 + c];
  return out;
}
async function ico(source: HTMLCanvasElement) {
  const scale = Math.min(1, 256 / Math.max(source.width, source.height)), w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
  const square = canvas(Math.max(w, h), Math.max(w, h)); context2d(square).drawImage(scale < 1 ? resample(source, w, h) : source, (square.width - w) / 2, (square.height - h) / 2, w, h);
  const png = await bytes(await blob(square, 'image/png')), out = new Uint8Array(22 + png.length), v = new DataView(out.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, 1, true); out[6] = square.width >= 256 ? 0 : square.width; out[7] = square.height >= 256 ? 0 : square.height;
  v.setUint16(10, 1, true); v.setUint16(12, 32, true); v.setUint32(14, png.length, true); v.setUint32(18, 22, true); out.set(png, 22);
  return out;
}
/** A one-page PDF sized from the image resolution, with the image embedded as JPEG. */
async function pdf(source: HTMLCanvasElement, quality: number, dpi = 72) {
  const jpeg = await bytes(await blob(opaque(source), 'image/jpeg', quality)), pw = +(source.width * 72 / dpi).toFixed(2), ph = +(source.height * 72 / dpi).toFixed(2), encoder = new TextEncoder();
  const w = source.width, h = source.height, content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [`<< /Producer (LopeOS Preview) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`],
  ];
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')], offsets: number[] = []; let length = parts[0].length;
  const push = (part: string | Uint8Array) => { const value = typeof part === 'string' ? encoder.encode(part) : part; parts.push(value); length += value.length; };
  objects.forEach((object, i) => { offsets.push(length); push(`${i + 1} 0 obj\n`); object.forEach(push); push('\nendobj\n'); });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length); let p = 0; for (const part of parts) { out.set(part, p); p += part.length; } return out;
}
export async function encode(source: HTMLCanvasElement, format: string, options: EncodeOptions): Promise<Uint8Array> {
  switch (format) {
    case 'png': return bytes(await blob(options.alpha ? source : opaque(source), 'image/png'));
    case 'jpeg': return bytes(await blob(opaque(source), 'image/jpeg', options.quality));
    case 'webp': { const value = await blob(options.alpha ? source : opaque(source), 'image/webp', options.quality); if (value.type !== 'image/webp') throw new Error('This browser can’t encode WebP images.'); return bytes(value); }
    case 'tiff': return tiff(source, options.alpha, options.dpi);
    case 'bmp': return bmp(source, options.alpha, options.dpi);
    case 'tga': return tga(options.alpha ? source : opaque(source));
    case 'qoi': return qoi(options.alpha ? source : opaque(source));
    case 'pnm': return pnm(source, options.alpha);
    case 'ico': return ico(source);
    case 'pdf': return pdf(source, options.quality, options.dpi);
  }
  throw new Error('Preview can’t save in this format. Use Export to choose another format.');
}
export const supportsQuality = (format: string) => ['jpeg', 'webp', 'pdf'].includes(format);
export const supportsAlpha = (format: string) => ['png', 'webp', 'tiff', 'bmp', 'tga', 'qoi', 'pnm'].includes(format);
