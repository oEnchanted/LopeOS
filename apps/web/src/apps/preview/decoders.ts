/**
 * Decoders for image formats browsers cannot display themselves. Each returns
 * 8-bit, non-premultiplied sRGB RGBA pixels. Inputs are untrusted: every read is
 * bounds-checked and dimensions are limited before allocating.
 */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray; details?: [string, string][] }
export const MAX_PIXELS = 120_000_000;
export function checkSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > MAX_PIXELS)
    throw new Error(`The image dimensions (${width} × ${height}) are invalid or larger than Preview supports.`);
}
function pixels(width: number, height: number): Pixels { checkSize(width, height); return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
const truncated = () => new Error('The image file is truncated or damaged.');
const toSrgb = (n: number) => n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
const linearByte = (n: number) => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, n)))) * 255);

class Reader {
  view: DataView; pos = 0;
  constructor(public bytes: Uint8Array, public little = true) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  need(n: number, at = this.pos) { if (at < 0 || at + n > this.bytes.length) throw truncated(); }
  u8(at?: number) { const p = at ?? this.pos; this.need(1, p); if (at === undefined) this.pos++; return this.bytes[p]; }
  u16(at?: number) { const p = at ?? this.pos; this.need(2, p); if (at === undefined) this.pos += 2; return this.view.getUint16(p, this.little); }
  u32(at?: number) { const p = at ?? this.pos; this.need(4, p); if (at === undefined) this.pos += 4; return this.view.getUint32(p, this.little); }
  i32(at?: number) { const p = at ?? this.pos; this.need(4, p); if (at === undefined) this.pos += 4; return this.view.getInt32(p, this.little); }
  f32(at?: number) { const p = at ?? this.pos; this.need(4, p); if (at === undefined) this.pos += 4; return this.view.getFloat32(p, this.little); }
}
async function inflate(data: Uint8Array, format: 'deflate' | 'gzip' = 'deflate') {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export const gunzip = (data: Uint8Array) => inflate(data, 'gzip');
function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
/** Global Reinhard operator with a white point at the brightest pixel, for HDR sources. */
function toneMap(rgb: Float32Array, alpha: Float32Array | null, width: number, height: number): Pixels {
  const out = pixels(width, height); let white = 0;
  for (let i = 0; i < rgb.length; i += 3) { const l = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]; if (Number.isFinite(l) && l > white) white = l; }
  if (white <= 1) { for (let p = 0, i = 0; i < rgb.length; i += 3, p += 4) { out.data[p] = linearByte(rgb[i]); out.data[p + 1] = linearByte(rgb[i + 1]); out.data[p + 2] = linearByte(rgb[i + 2]); out.data[p + 3] = alpha ? Math.round(Math.max(0, Math.min(1, alpha[i / 3])) * 255) : 255; } return out; }
  const w2 = white * white;
  for (let p = 0, i = 0; i < rgb.length; i += 3, p += 4) {
    const l = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2], scale = l > 0 && Number.isFinite(l) ? (1 + l / w2) / (1 + l) : 0;
    out.data[p] = linearByte(rgb[i] * scale); out.data[p + 1] = linearByte(rgb[i + 1] * scale); out.data[p + 2] = linearByte(rgb[i + 2] * scale);
    out.data[p + 3] = alpha ? Math.round(Math.max(0, Math.min(1, alpha[i / 3])) * 255) : 255;
  }
  return out;
}
export function orient(image: Pixels, orientation: number): Pixels {
  if (orientation <= 1 || orientation > 8) return image;
  const swap = orientation >= 5, width = swap ? image.height : image.width, height = swap ? image.width : image.height, out = pixels(width, height);
  const source = new Uint32Array(image.data.buffer), target = new Uint32Array(out.data.buffer);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sx = x, sy = y;
    if (orientation === 2) sx = image.width - 1 - x;
    else if (orientation === 3) { sx = image.width - 1 - x; sy = image.height - 1 - y; }
    else if (orientation === 4) sy = image.height - 1 - y;
    else if (orientation === 5) { sx = y; sy = x; }
    else if (orientation === 6) { sx = y; sy = image.height - 1 - x; }
    else if (orientation === 7) { sx = image.width - 1 - y; sy = image.height - 1 - x; }
    else if (orientation === 8) { sx = image.width - 1 - y; sy = x; }
    target[y * width + x] = source[sy * image.width + sx];
  }
  return { ...out, details: image.details };
}

// ---------- TIFF (none, LZW, PackBits, Deflate, JPEG; strips and tiles; planar) ----------
function lzwDecode(input: Uint8Array, expected: number) {
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; length[i] = 1; }
  let out = new Uint8Array(Math.max(expected, 1024)), pos = 0, bit = 0, width = 9, next = 258, old = -1;
  const read = () => {
    if ((bit + width) > input.length * 8) return 257;
    let value = 0;
    for (let i = 0; i < width; i++) { value = (value << 1) | ((input[(bit + i) >> 3] >> (7 - ((bit + i) & 7))) & 1); }
    bit += width; return value;
  };
  const emit = (code: number) => {
    const n = length[code];
    if (pos + n > out.length) { const grown = new Uint8Array(Math.max(out.length * 2, pos + n)); grown.set(out); out = grown; }
    for (let i = n - 1, c = code; i >= 0; i--, c = prefix[c]) out[pos + i] = suffix[c];
    pos += n;
  };
  const first = (code: number) => { while (prefix[code] >= 0) code = prefix[code]; return suffix[code]; };
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { width = 9; next = 258; old = -1; continue; }
    if (old < 0) { if (code > 255) throw truncated(); emit(code); old = code; continue; }
    if (code < next) { emit(code); if (next < 4096) { prefix[next] = old; suffix[next] = first(code); length[next] = length[old] + 1; next++; } }
    else if (code === next && next < 4096) { prefix[next] = old; suffix[next] = first(old); length[next] = length[old] + 1; next++; emit(code); }
    else throw truncated();
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
    if (pos >= expected) break;
  }
  return out.subarray(0, pos);
}
function packBits(input: Uint8Array, expected: number) {
  const out = new Uint8Array(expected); let i = 0, o = 0;
  while (i < input.length && o < expected) {
    const n = (input[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < expected; k++) out[o++] = input[i++]; }
    else if (n !== -128) { const value = input[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = value; }
  }
  return out;
}
// ---------- CCITT fax (Modified Huffman, Group 3 1D/2D, Group 4), used by scanned-document TIFFs ----------
const whiteCodes = '00110101 000111 0111 1000 1011 1100 1110 1111 10011 10100 00111 01000 001000 000011 110100 110101 101010 101011 0100111 0001100 0001000 0010111 0000011 0000100 0101000 0101011 0010011 0100100 0011000 00000010 00000011 00011010 00011011 00010010 00010011 00010100 00010101 00010110 00010111 00101000 00101001 00101010 00101011 00101100 00101101 00000100 00000101 00001010 00001011 01010010 01010011 01010100 01010101 00100100 00100101 01011000 01011001 01011010 01011011 01001010 01001011 00110010 00110011 00110100';
const whiteMakeup = '11011 10010 010111 0110111 00110110 00110111 01100100 01100101 01101000 01100111 011001100 011001101 011010010 011010011 011010100 011010101 011010110 011010111 011011000 011011001 011011010 011011011 010011000 010011001 010011010 011000 010011011';
const blackCodes = '0000110111 010 11 10 011 0011 0010 00011 000101 000100 0000100 0000101 0000111 00000100 00000111 000011000 0000010111 0000011000 0000001000 00001100111 00001101000 00001101100 00000110111 00000101000 00000010111 00000011000 000011001010 000011001011 000011001100 000011001101 000001101000 000001101001 000001101010 000001101011 000011010010 000011010011 000011010100 000011010101 000011010110 000011010111 000001101100 000001101101 000011011010 000011011011 000001010100 000001010101 000001010110 000001010111 000001100100 000001100101 000001010010 000001010011 000000100100 000000110111 000000111000 000000100111 000000101000 000001011000 000001011001 000000101011 000000101100 000001011010 000001100110 000001100111';
const blackMakeup = '0000001111 000011001000 000011001001 000001011011 000000110011 000000110100 000000110101 0000001101100 0000001101101 0000001001010 0000001001011 0000001001100 0000001001101 0000001110010 0000001110011 0000001110100 0000001110101 0000001110110 0000001110111 0000001010010 0000001010011 0000001010100 0000001010101 0000001011010 0000001011011 0000001100100 0000001100101';
const extendedMakeup = '00000001000 00000001100 00000001101 000000010010 000000010011 000000010100 000000010101 000000010110 000000010111 000000011100 000000011101 000000011110 000000011111';
let faxTables: [Map<string, number>, Map<string, number>] | null = null;
function faxCodes() {
  if (faxTables) return faxTables;
  const table = (terminating: string, makeup: string) => {
    const map = new Map<string, number>();
    terminating.split(' ').forEach((code, run) => map.set(code, run));
    makeup.split(' ').forEach((code, i) => map.set(code, (i + 1) * 64));
    extendedMakeup.split(' ').forEach((code, i) => map.set(code, 1792 + i * 64));
    return map;
  };
  return faxTables = [table(whiteCodes, whiteMakeup), table(blackCodes, blackMakeup)];
}
function decodeFax(input: Uint8Array, width: number, rows: number, mode: 2 | 3 | 4, options: number, lsbFirst: boolean): Uint8Array {
  const data = lsbFirst ? input.map(b => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; }) : input;
  const rowBytes = Math.ceil(width / 8), out = new Uint8Array(rowBytes * rows), total = data.length * 8, [white, black] = faxCodes();
  let bit = 0;
  const peek = (n: number) => { let v = 0; for (let i = 0; i < n; i++) { const p = bit + i; v = v << 1 | (p < total ? (data[p >> 3] >> (7 - (p & 7))) & 1 : 0); } return v; };
  const take = (n: number) => { const v = peek(n); bit += n; return v; };
  const run = (color: number) => {
    let length = 0;
    for (;;) {
      let code = '', value: number | undefined;
      while (code.length < 14 && bit < total) { code += take(1); value = (color ? black : white).get(code); if (value !== undefined) break; }
      if (value === undefined) throw new Error('This fax-compressed TIFF is damaged.');
      length += value; if (value < 64) return length;
    }
  };
  const skipEol = () => { let zeros = 0; const start = bit; while (bit < total && peek(1) === 0 && zeros < 64) { bit++; zeros++; } if (zeros >= 11 && peek(1) === 1) { bit++; return true; } bit = start; return false; };
  const fill = (row: number, from: number, to: number) => { for (let x = Math.max(0, from); x < Math.min(width, to); x++) out[row * rowBytes + (x >> 3)] |= 0x80 >> (x & 7); };
  let reference: number[] = [width, width];
  for (let y = 0; y < rows && bit < total; y++) {
    if (mode === 2) bit = Math.ceil(bit / 8) * 8;
    let twoD = mode === 4;
    if (mode === 3) { skipEol(); if (options & 1) twoD = take(1) === 0; } // EOL scanning also consumes fill bits.
    const changes: number[] = []; let a0 = -1, color = 0;
    if (!twoD) {
      while (a0 < width) { const length = run(color), start = Math.max(0, a0), end = start + length; if (color) fill(y, start, end); changes.push(end); a0 = end; color ^= 1; if (end >= width) break; }
    } else {
      while (a0 < width) {
        let i = 0; while (i < reference.length && (reference[i] <= a0 || (i & 1) !== color)) i++;
        const b1 = reference[i] ?? width, b2 = reference[i + 1] ?? width;
        if (peek(1) === 1) { bit += 1; if (color) fill(y, a0, b1); changes.push(b1); a0 = b1; color ^= 1; continue; }
        const three = peek(3);
        if (three === 0b011 || three === 0b010) { bit += 3; const a1 = b1 + (three === 0b011 ? 1 : -1); if (color) fill(y, a0, a1); changes.push(a1); a0 = a1; color ^= 1; continue; }
        if (three === 0b001) { bit += 3; const start = Math.max(0, a0), first = run(color), second = run(color ^ 1); if (color) fill(y, start, start + first); else fill(y, start + first, start + first + second); changes.push(start + first, start + first + second); a0 = start + first + second; continue; }
        if (peek(4) === 0b0001) { bit += 4; if (color) fill(y, a0, b2); a0 = b2; continue; }
        const six = peek(6), seven = peek(7);
        if (six === 0b000011 || six === 0b000010) { bit += 6; const a1 = b1 + (six === 0b000011 ? 2 : -2); if (color) fill(y, a0, a1); changes.push(a1); a0 = a1; color ^= 1; continue; }
        if (seven === 0b0000011 || seven === 0b0000010) { bit += 7; const a1 = b1 + (seven === 0b0000011 ? 3 : -3); if (color) fill(y, a0, a1); changes.push(a1); a0 = a1; color ^= 1; continue; }
        if (peek(12) === 1) { bit += 12; break; } // End of facsimile block.
        throw new Error('This fax-compressed TIFF uses an unsupported extension.');
      }
    }
    reference = [...changes.filter(c => c < width), width, width];
  }
  return out;
}
type TiffTags = Map<number, number[]>;
function tiffIfd(r: Reader, offset: number): { tags: TiffTags; next: number } {
  const count = r.u16(offset); if (count > 4096) throw truncated();
  const tags: TiffTags = new Map(), sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12, tag = r.u16(p), type = r.u16(p + 2), n = r.u32(p + 4), size = sizes[type];
    if (!size || n > 50_000_000) continue;
    const at = n * size <= 4 ? p + 8 : r.u32(p + 8); r.need(n * size, at);
    const values: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      const q = at + j * size;
      values[j] = type === 3 ? r.u16(q) : type === 4 || type === 16 ? r.u32(q) : type === 8 ? (r.u16(q) << 16) >> 16 : type === 9 ? r.i32(q) : type === 5 ? r.u32(q) / Math.max(1, r.u32(q + 4)) : type === 10 ? r.i32(q) / Math.max(1, r.i32(q + 4)) : type === 11 ? r.f32(q) : type === 12 ? r.view.getFloat64(q, r.little) : type === 6 ? (r.bytes[q] << 24) >> 24 : r.bytes[q];
    }
    tags.set(tag, values);
  }
  return { tags, next: r.u32(offset + 2 + count * 12) };
}
async function decodeJpegTile(data: Uint8Array, tables: Uint8Array | undefined, ycbcr: boolean): Promise<ImageData> {
  // Merge shared tables, and state the color transform with an Adobe marker: decoders disagree when a stream has none.
  const adobe = [0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 0x64, 0, 0, 0, 0, ycbcr ? 1 : 0];
  const head = tables && tables.length > 4 ? tables.subarray(2, tables.length - 2) : new Uint8Array();
  const stream = new Uint8Array(2 + adobe.length + head.length + data.length - 2);
  stream.set([0xff, 0xd8]); stream.set(adobe, 2); stream.set(head, 2 + adobe.length); stream.set(data.subarray(2), 2 + adobe.length + head.length);
  const bitmap = await createImageBitmap(new Blob([stream as BlobPart], { type: 'image/jpeg' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0); bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
export async function decodeTiff(bytes: Uint8Array): Promise<Pixels> {
  const r = new Reader(bytes, bytes[0] === 0x49); if (r.u16(2) !== 42) throw new Error('BigTIFF files aren’t supported.');
  const first = r.u32(4), { tags } = tiffIfd(r, first);
  let pages = 1; { const seen = new Set([first]); let next = tiffIfd(r, first).next; while (next && !seen.has(next) && pages < 1000) { seen.add(next); pages++; try { next = tiffIfd(r, next).next; } catch { break; } } }
  const get = (tag: number, fallback?: number) => tags.get(tag)?.[0] ?? fallback;
  const width = get(256)!, height = get(257)!; checkSize(width, height);
  const bits = tags.get(258) ?? [1], depth = bits[0], compression = get(259, 1)!, photometric = get(262, bits.length >= 3 ? 2 : 1)!, samples = get(277, 1)!;
  const planar = get(284, 1)!, predictor = get(317, 1)!, format = get(339, 1)!, extra = tags.get(338) ?? [], colormap = tags.get(320);
  if (tags.has(50706)) throw new Error('DNG raw images are developed by the raw decoder.');
  const tiled = tags.has(322), tileWidth = tiled ? get(322)! : width, tileHeight = tiled ? get(323)! : Math.min(height, get(278, height)!);
  const offsets = tags.get(tiled ? 324 : 273) ?? [], counts = tags.get(tiled ? 325 : 279) ?? [];
  if (!offsets.length || !tileWidth || !tileHeight) throw new Error('This TIFF has no readable image data.');
  if (![1, 2, 3, 4, 5, 7, 8, 32773, 32946].includes(compression)) throw new Error(`This TIFF uses a compression method (${compression}) Preview can’t read.`);
  if (compression >= 2 && compression <= 4 && (depth !== 1 || samples !== 1)) throw new Error('This fax-compressed TIFF isn’t black and white.');
  if (![0, 1, 2, 3, 5, 6].includes(photometric)) throw new Error('This TIFF uses a color space Preview can’t read (such as CIELab).');
  if (photometric === 6 && compression !== 7) throw new Error('Uncompressed YCbCr TIFFs aren’t supported.');
  if (![1, 2, 4, 8, 16, 32].includes(depth)) throw new Error(`${depth}-bit TIFF samples aren’t supported.`);
  const out = pixels(width, height), across = Math.ceil(width / tileWidth), down = Math.ceil(height / tileHeight), perPlane = across * down;
  const color = photometric === 2 || photometric === 6 ? 3 : photometric === 5 ? 4 : 1, alphaIndex = samples > color && (extra[0] === 1 || extra[0] === 2) ? color : -1, premultiplied = extra[0] === 1;
  const jpegTables = tags.has(347) ? Uint8Array.from(tags.get(347)!) : undefined;
  const planes = planar === 2 ? samples : 1, chunkSamples = planar === 2 ? 1 : samples, rowBytes = Math.ceil(tileWidth * chunkSamples * depth / 8);
  const sample = new Float64Array(samples), planarValues = planar === 2 ? new Float32Array(width * height * samples) : null;
  const writePixel = (d: number, s: ArrayLike<number>) => {
    const toByte = (v: number) => format === 3 ? linearByte(v) : Math.round(Math.max(0, Math.min(1, v)) * 255);
    const alpha = alphaIndex >= 0 ? Math.max(0, Math.min(1, s[alphaIndex])) : 1, un = (v: number) => premultiplied && alpha > 0 ? v / alpha : v, target = out.data;
    if (photometric === 3 && colormap) { const i = Math.round(s[0] * ((1 << depth) - 1)), n = colormap.length / 3; target[d] = colormap[i] / 257; target[d + 1] = colormap[n + i] / 257; target[d + 2] = colormap[2 * n + i] / 257; }
    else if (photometric === 5) { const k = s[3]; target[d] = 255 * (1 - s[0]) * (1 - k); target[d + 1] = 255 * (1 - s[1]) * (1 - k); target[d + 2] = 255 * (1 - s[2]) * (1 - k); }
    else if (color === 3) { target[d] = toByte(un(s[0])); target[d + 1] = toByte(un(s[1])); target[d + 2] = toByte(un(s[2])); }
    else { const v = toByte(un(photometric === 0 ? 1 - s[0] : s[0])); target[d] = target[d + 1] = target[d + 2] = v; }
    target[d + 3] = Math.round(alpha * 255);
  };
  for (let plane = 0; plane < planes; plane++) for (let t = 0; t < perPlane; t++) {
    const index = plane * perPlane + t, offset = offsets[index], count = counts[index] ?? bytes.length - offset;
    if (offset === undefined) throw truncated();
    const ox = (t % across) * tileWidth, oy = Math.floor(t / across) * tileHeight, rows = tiled ? tileHeight : Math.min(tileHeight, height - oy);
    r.need(Math.min(count, bytes.length - offset), offset);
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + count)), expected = rowBytes * rows;
    if (compression === 7) {
      const tile = await decodeJpegTile(chunk, jpegTables, photometric === 6);
      for (let y = 0; y < Math.min(tile.height, height - oy); y++) for (let x = 0; x < Math.min(tile.width, width - ox); x++) {
        const s = (y * tile.width + x) * 4, d = ((oy + y) * width + ox + x) * 4;
        out.data[d] = tile.data[s]; out.data[d + 1] = tile.data[s + 1]; out.data[d + 2] = tile.data[s + 2]; out.data[d + 3] = 255;
      }
      continue;
    }
    let data = compression >= 2 && compression <= 4 ? decodeFax(chunk, tileWidth, rows, compression as 2 | 3 | 4, get(compression === 4 ? 293 : 292, 0)!, get(266, 1) === 2) : compression === 1 ? chunk : compression === 5 ? lzwDecode(chunk, expected) : compression === 32773 ? packBits(chunk, expected) : await inflate(chunk);
    if (predictor === 2) {
      data = new Uint8Array(data);
      if (depth === 8) for (let y = 0; y < rows; y++) for (let x = chunkSamples; x < tileWidth * chunkSamples; x++) { const p = y * rowBytes + x; if (p < data.length) data[p] = (data[p] + data[p - chunkSamples]) & 255; }
      else if (depth === 16) { const v = new DataView(data.buffer, data.byteOffset, data.byteLength); for (let y = 0; y < rows; y++) for (let x = chunkSamples; x < tileWidth * chunkSamples; x++) { const p = y * rowBytes + x * 2; if (p + 2 <= data.length) v.setUint16(p, (v.getUint16(p, r.little) + v.getUint16(p - chunkSamples * 2, r.little)) & 0xffff, r.little); } }
    } else if (predictor === 3) throw new Error('Floating-point predicted TIFFs aren’t supported.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength), max = (1 << Math.min(depth, 16)) - 1;
    const readSample = (row: number, index: number) => {
      if (depth === 8) { const p = row * rowBytes + index; return p < data.length ? data[p] / 255 : 0; }
      if (depth === 16) { const p = row * rowBytes + index * 2; return p + 2 <= data.length ? view.getUint16(p, r.little) / 65535 : 0; }
      if (depth === 32) { const p = row * rowBytes + index * 4; if (p + 4 > data.length) return 0; return format === 3 ? view.getFloat32(p, r.little) : view.getUint32(p, r.little) / 4294967295; }
      const bit = index * depth, p = row * rowBytes + (bit >> 3); if (p >= data.length) return 0;
      return ((data[p] >> (8 - depth - (bit & 7))) & max) / max;
    };
    for (let y = 0; y < rows && oy + y < height; y++) for (let x = 0; x < tileWidth && ox + x < width; x++) {
      const i = (oy + y) * width + ox + x;
      if (planarValues) planarValues[i * samples + plane] = readSample(y, x);
      else { for (let c = 0; c < samples; c++) sample[c] = readSample(y, x * samples + c); writePixel(i * 4, sample); }
    }
  }
  if (planarValues) for (let i = 0; i < width * height; i++) writePixel(i * 4, planarValues.subarray(i * samples, i * samples + samples));
  const kind = photometric === 5 ? 'CMYK' : photometric === 3 ? 'Indexed color' : color === 1 ? (depth === 1 ? 'Black and white' : 'Grayscale') : 'RGB';
  const names: Record<number, string> = { 2: 'CCITT Modified Huffman', 3: 'CCITT Group 3 fax', 4: 'CCITT Group 4 fax', 1: 'None', 5: 'LZW', 7: 'JPEG', 8: 'Deflate', 32946: 'Deflate', 32773: 'PackBits' };
  const result: Pixels = { ...out, details: [['Color model', kind], ['Bit depth', `${depth}-bit${format === 3 ? ' floating point' : ''}`], ['Compression', names[compression]], ...(pages > 1 ? [['Pages', `${pages} (showing page 1)`] as [string, string]] : [])] };
  const resolution = get(282); if (resolution) result.details!.push(['Resolution', `${Math.round(resolution)} pixels/${get(296, 2) === 3 ? 'cm' : 'inch'}`]);
  return orient(result, get(274, 1)!);
}

// ---------- Targa ----------
export function decodeTga(bytes: Uint8Array): Pixels {
  const r = new Reader(bytes); r.need(18, 0);
  const idLength = bytes[0], mapType = bytes[1], type = bytes[2], mapStart = r.u16(3), mapLength = r.u16(5), mapDepth = bytes[7];
  const width = r.u16(12), height = r.u16(14), depth = bytes[16], descriptor = bytes[17];
  if (![1, 2, 3, 9, 10, 11].includes(type)) throw new Error('This Targa image type isn’t supported.');
  const out = pixels(width, height), mapBytes = Math.ceil(mapDepth / 8), pixelBytes = Math.ceil(depth / 8);
  let pos = 18 + idLength;
  const palette: number[][] = [];
  if (mapType === 1) { for (let i = 0; i < mapLength; i++) palette[mapStart + i] = color(pos + i * mapBytes, mapDepth); pos += mapLength * mapBytes; }
  function color(p: number, bpp: number): number[] {
    r.need(Math.ceil(bpp / 8), p);
    if (bpp === 8) return [bytes[p], bytes[p], bytes[p], 255];
    if (bpp === 15 || bpp === 16) { const v = bytes[p] | bytes[p + 1] << 8; return [((v >> 10) & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, (v & 31) * 255 / 31, bpp === 16 && (descriptor & 15) ? (v & 0x8000 ? 255 : 0) : 255]; }
    if (bpp === 24) return [bytes[p + 2], bytes[p + 1], bytes[p], 255];
    return [bytes[p + 2], bytes[p + 1], bytes[p], bytes[p + 3]];
  }
  const total = width * height, read = (p: number) => type === 1 || type === 9 ? palette[bytes[p] | (pixelBytes === 2 ? bytes[p + 1] << 8 : 0)] ?? [0, 0, 0, 255] : type === 3 || type === 11 ? (depth === 16 ? [bytes[p], bytes[p], bytes[p], bytes[p + 1]] : [bytes[p], bytes[p], bytes[p], 255]) : color(p, depth);
  const top = (descriptor & 0x20) !== 0, right = (descriptor & 0x10) !== 0;
  let anyAlpha = false;
  const put = (i: number, v: number[]) => {
    const x = i % width, y = (i / width) | 0, d = ((top ? y : height - 1 - y) * width + (right ? width - 1 - x : x)) * 4;
    out.data[d] = v[0]; out.data[d + 1] = v[1]; out.data[d + 2] = v[2]; out.data[d + 3] = v[3]; if (v[3]) anyAlpha = true;
  };
  if (type < 9) { r.need(total * pixelBytes, pos); for (let i = 0; i < total; i++) put(i, read(pos + i * pixelBytes)); }
  else for (let i = 0; i < total;) {
    const header = r.u8(pos++), n = (header & 127) + 1;
    if (header & 128) { r.need(pixelBytes, pos); const value = read(pos); pos += pixelBytes; for (let k = 0; k < n && i < total; k++) put(i++, value); }
    else for (let k = 0; k < n && i < total; k++) { r.need(pixelBytes, pos); put(i++, read(pos)); pos += pixelBytes; }
  }
  if (!anyAlpha) for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return { ...out, details: [['Bit depth', `${depth}-bit`], ['Compression', type >= 9 ? 'RLE' : 'None']] };
}

// ---------- Netpbm (PBM, PGM, PPM, PAM, PFM) ----------
export function decodePnm(bytes: Uint8Array): Pixels {
  let pos = 0;
  const token = () => {
    for (;;) { while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++; if (bytes[pos] === 35) { while (pos < bytes.length && bytes[pos] !== 10) pos++; } else break; }
    const start = pos; while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) pos++;
    if (start === pos) throw truncated(); return String.fromCharCode(...bytes.subarray(start, pos));
  };
  const magic = token();
  if (magic === 'PF' || magic === 'Pf') {
    const width = +token(), height = +token(), scale = +token(); pos++;
    const channels = magic === 'PF' ? 3 : 1, view = new DataView(bytes.buffer, bytes.byteOffset), little = scale < 0, rgb = new Float32Array(width * height * 3); checkSize(width, height);
    if (pos + width * height * channels * 4 > bytes.length) throw truncated();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) rgb[((height - 1 - y) * width + x) * 3 + c] = view.getFloat32(pos + ((y * width + x) * channels + (channels === 1 ? 0 : c)) * 4, little);
    return { ...toneMap(rgb, null, width, height), details: [['Bit depth', '32-bit floating point']] };
  }
  let width: number, height: number, max = 1, depth: number, tuple = '';
  if (magic === 'P7') {
    const header: Record<string, string> = {};
    for (;;) { const key = token(); if (key === 'ENDHDR') break; header[key] = token(); }
    width = +header.WIDTH; height = +header.HEIGHT; depth = +header.DEPTH; max = +header.MAXVAL; tuple = header.TUPLTYPE || '';
  } else {
    if (!/^P[1-6]$/.test(magic)) throw new Error('This Netpbm variant isn’t supported.');
    width = +token(); height = +token(); if (!['P1', 'P4'].includes(magic)) max = +token();
    depth = ['P3', 'P6'].includes(magic) ? 3 : 1;
  }
  const out = pixels(width, height); if (!(max >= 1 && max <= 65535) || !(depth >= 1 && depth <= 4)) throw truncated();
  const ascii = ['P1', 'P2', 'P3'].includes(magic), wide = max > 255; pos++;
  const values = new Float32Array(width * height * depth);
  if (ascii) { for (let i = 0; i < values.length; i++) { if (magic === 'P1') { while (pos < bytes.length && !(bytes[pos] === 48 || bytes[pos] === 49)) { if (bytes[pos] === 35) while (pos < bytes.length && bytes[pos] !== 10) pos++; else pos++; } if (pos >= bytes.length) throw truncated(); values[i] = bytes[pos++] - 48; } else values[i] = +token(); } }
  else if (magic === 'P4') { const row = Math.ceil(width / 8); if (pos + row * height > bytes.length) throw truncated(); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = (bytes[pos + y * row + (x >> 3)] >> (7 - (x & 7))) & 1; }
  else { const size = wide ? 2 : 1; if (pos + values.length * size > bytes.length) throw truncated(); for (let i = 0; i < values.length; i++) values[i] = wide ? bytes[pos + i * 2] << 8 | bytes[pos + i * 2 + 1] : bytes[pos + i]; }
  const bitmap = magic === 'P1' || magic === 'P4' || tuple.startsWith('BLACKANDWHITE');
  for (let i = 0; i < width * height; i++) {
    const d = i * 4, v = (c: number) => bitmap && magic !== 'P7' ? (values[i] ? 0 : 255) : Math.round(values[i * depth + c] / max * 255);
    if (depth >= 3) { out.data[d] = v(0); out.data[d + 1] = v(1); out.data[d + 2] = v(2); out.data[d + 3] = depth === 4 ? v(3) : 255; }
    else { out.data[d] = out.data[d + 1] = out.data[d + 2] = v(0); out.data[d + 3] = depth === 2 ? v(1) : 255; }
  }
  return { ...out, details: [['Color model', depth >= 3 ? 'RGB' : bitmap ? 'Black and white' : 'Grayscale'], ['Bit depth', `${Math.ceil(Math.log2(max + 1))}-bit`], ['Encoding', ascii ? 'Plain text' : 'Binary']] };
}

// ---------- QOI ----------
export function decodeQoi(bytes: Uint8Array): Pixels {
  const r = new Reader(bytes, false), width = r.u32(4), height = r.u32(8), channels = bytes[12], out = pixels(width, height);
  const index = new Uint8Array(256), px = [0, 0, 0, 255]; let pos = 14;
  for (let p = 0, run = 0; p < out.data.length; p += 4) {
    if (run > 0) run--;
    else {
      if (pos >= bytes.length) throw truncated();
      const b = bytes[pos++];
      if (b === 0xfe) { px[0] = bytes[pos++]; px[1] = bytes[pos++]; px[2] = bytes[pos++]; }
      else if (b === 0xff) { px[0] = bytes[pos++]; px[1] = bytes[pos++]; px[2] = bytes[pos++]; px[3] = bytes[pos++]; }
      else if ((b & 0xc0) === 0x00) { const i = b * 4; px[0] = index[i]; px[1] = index[i + 1]; px[2] = index[i + 2]; px[3] = index[i + 3]; }
      else if ((b & 0xc0) === 0x40) { px[0] = (px[0] + ((b >> 4) & 3) - 2) & 255; px[1] = (px[1] + ((b >> 2) & 3) - 2) & 255; px[2] = (px[2] + (b & 3) - 2) & 255; }
      else if ((b & 0xc0) === 0x80) { const b2 = bytes[pos++], dg = (b & 0x3f) - 32; px[0] = (px[0] + dg - 8 + ((b2 >> 4) & 15)) & 255; px[1] = (px[1] + dg) & 255; px[2] = (px[2] + dg - 8 + (b2 & 15)) & 255; }
      else run = b & 0x3f;
      const h = ((px[0] * 3 + px[1] * 5 + px[2] * 7 + px[3] * 11) % 64) * 4; index[h] = px[0]; index[h + 1] = px[1]; index[h + 2] = px[2]; index[h + 3] = px[3];
    }
    out.data[p] = px[0]; out.data[p + 1] = px[1]; out.data[p + 2] = px[2]; out.data[p + 3] = px[3];
  }
  return { ...out, details: [['Channels', channels === 4 ? 'RGBA' : 'RGB']] };
}

// ---------- Radiance HDR ----------
export function decodeHdr(bytes: Uint8Array): Pixels {
  let pos = 0; const line = () => { const start = pos; while (pos < bytes.length && bytes[pos] !== 10) pos++; if (pos >= bytes.length) throw truncated(); return new TextDecoder().decode(bytes.subarray(start, pos++)); };
  let exposure = 1; for (let l = line(); l.trim() !== ''; l = line()) { const m = /^EXPOSURE=\s*([\d.e+-]+)/i.exec(l); if (m) exposure *= +m[1] || 1; if (/FORMAT=/.test(l) && !/32-bit_rle_rgbe/.test(l)) throw new Error('Only RGBE Radiance files are supported.'); }
  const size = /^([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)/.exec(line()); if (!size) throw new Error('This Radiance HDR orientation isn’t supported.');
  const height = +size[2], width = +size[4], flipY = size[1] === '+', flipX = size[3] === '-'; checkSize(width, height);
  const rgb = new Float32Array(width * height * 3), scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (pos + 4 > bytes.length) throw truncated();
    if (width >= 8 && width < 32768 && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] << 8 | bytes[pos + 3]) === width) {
      pos += 4;
      for (let c = 0; c < 4; c++) for (let x = 0; x < width;) {
        if (pos >= bytes.length) throw truncated();
        let n = bytes[pos++];
        if (n > 128) { n -= 128; const v = bytes[pos++]; while (n-- > 0 && x < width) scan[(x++) * 4 + c] = v; }
        else { while (n-- > 0 && x < width) scan[(x++) * 4 + c] = bytes[pos++]; }
      }
    } else { if (pos + width * 4 > bytes.length) throw truncated(); scan.set(bytes.subarray(pos, pos + width * 4)); pos += width * 4; }
    const ty = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) { const e = scan[x * 4 + 3], f = e ? Math.pow(2, e - 136) / exposure : 0, d = (ty * width + (flipX ? width - 1 - x : x)) * 3; rgb[d] = scan[x * 4] * f; rgb[d + 1] = scan[x * 4 + 1] * f; rgb[d + 2] = scan[x * 4 + 2] * f; }
  }
  return { ...toneMap(rgb, null, width, height), details: [['Dynamic range', 'High (tone mapped for display)']] };
}

// ---------- PCX ----------
export function decodePcx(bytes: Uint8Array): Pixels {
  const r = new Reader(bytes); r.need(128, 0); if (bytes[0] !== 10) throw truncated();
  const bpp = bytes[3], width = r.u16(8) - r.u16(4) + 1, height = r.u16(10) - r.u16(6) + 1, planes = bytes[65], line = r.u16(66), out = pixels(width, height);
  const scan = new Uint8Array(planes * line); let pos = 128;
  const hasPalette = bytes.length > 769 && bytes[bytes.length - 769] === 12, palette = (i: number) => hasPalette ? bytes.subarray(bytes.length - 768 + i * 3, bytes.length - 765 + i * 3) : bpp === 8 ? [i, i, i] : bytes.subarray(16 + i * 3, 19 + i * 3);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < scan.length;) { if (pos >= bytes.length) throw truncated(); const b = bytes[pos++]; if (bytes[3] && (b & 0xc0) === 0xc0 && bytes[2] === 1) { const v = bytes[pos++]; for (let n = b & 0x3f; n > 0 && i < scan.length; n--) scan[i++] = v; } else scan[i++] = b; }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4; let c: ArrayLike<number>;
      if (bpp === 8 && planes >= 3) { out.data[d] = scan[x]; out.data[d + 1] = scan[line + x]; out.data[d + 2] = scan[2 * line + x]; out.data[d + 3] = planes === 4 ? scan[3 * line + x] : 255; continue; }
      if (bpp === 8) c = palette(scan[x]);
      else if (bpp === 1 && planes === 1) { const v = (scan[x >> 3] >> (7 - (x & 7))) & 1 ? 255 : 0; c = [v, v, v]; }
      else if (bpp === 1) { let i = 0; for (let p = 0; p < planes; p++) i |= ((scan[p * line + (x >> 3)] >> (7 - (x & 7))) & 1) << p; c = palette(i); }
      else if (bpp === 4) c = palette((scan[x >> 1] >> (x & 1 ? 0 : 4)) & 15);
      else if (bpp === 2) c = palette((scan[x >> 2] >> (6 - (x & 3) * 2)) & 3);
      else throw new Error('This PCX variant isn’t supported.');
      out.data[d] = c[0]; out.data[d + 1] = c[1]; out.data[d + 2] = c[2]; out.data[d + 3] = 255;
    }
  }
  return { ...out, details: [['Bit depth', `${bpp * planes}-bit`]] };
}

// ---------- XBM, WBMP, Farbfeld ----------
export function decodeXbm(bytes: Uint8Array): Pixels {
  const text = new TextDecoder().decode(bytes), width = +(/_width\s+(\d+)/.exec(text)?.[1] ?? 0), height = +(/_height\s+(\d+)/.exec(text)?.[1] ?? 0), out = pixels(width, height);
  const body = text.slice(text.indexOf('{') + 1), values = [...body.matchAll(/0x([0-9a-f]{1,4})/gi)].map(m => parseInt(m[1], 16)), row = Math.ceil(width / 8);
  if (values.length < row * height) throw truncated();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = (values[y * row + (x >> 3)] >> (x & 7)) & 1 ? 0 : 255, d = (y * width + x) * 4; out.data[d] = out.data[d + 1] = out.data[d + 2] = v; out.data[d + 3] = 255; }
  return { ...out, details: [['Color model', 'Black and white']] };
}
export function decodeWbmp(bytes: Uint8Array): Pixels {
  let pos = 2; const multi = () => { let v = 0, b; do { if (pos >= bytes.length) throw truncated(); b = bytes[pos++]; v = v << 7 | (b & 127); } while (b & 128); return v; };
  if (bytes[0] !== 0) throw new Error('Only type 0 WBMP images are supported.');
  const width = multi(), height = multi(), out = pixels(width, height), row = Math.ceil(width / 8); if (pos + row * height > bytes.length) throw truncated();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = (bytes[pos + y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, d = (y * width + x) * 4; out.data[d] = out.data[d + 1] = out.data[d + 2] = v; out.data[d + 3] = 255; }
  return { ...out, details: [['Color model', 'Black and white']] };
}
export function decodeFarbfeld(bytes: Uint8Array): Pixels {
  const r = new Reader(bytes, false), width = r.u32(8), height = r.u32(12), out = pixels(width, height); r.need(width * height * 8, 16);
  for (let i = 0; i < width * height * 4; i++) out.data[i] = bytes[16 + i * 2];
  return { ...out, details: [['Bit depth', '16-bit']] };
}

// ---------- Icons: ICO, CUR, ICNS ----------
async function browserPixels(data: Uint8Array, type: string): Promise<Pixels> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type }));
  try { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); const image = context.getImageData(0, 0, bitmap.width, bitmap.height); return { width: image.width, height: image.height, data: image.data }; }
  finally { bitmap.close(); }
}
function decodeDib(bytes: Uint8Array, offset: number, length: number): Pixels {
  const r = new Reader(bytes); r.need(Math.min(length, 40), offset);
  const headerSize = r.u32(offset), width = r.i32(offset + 4), height = Math.abs(r.i32(offset + 8)) / 2, bpp = r.u16(offset + 14), compression = r.u32(offset + 16);
  if (compression !== 0 && compression !== 3) throw new Error('This icon uses a compressed bitmap Preview can’t read.');
  const out = pixels(width, height), colors = bpp <= 8 ? (r.u32(offset + 32) || 1 << bpp) : 0, paletteAt = offset + headerSize + (compression === 3 ? 12 : 0);
  const xorAt = paletteAt + colors * 4, stride = Math.ceil(width * bpp / 32) * 4, maskStride = Math.ceil(width / 32) * 4, maskAt = xorAt + stride * height;
  r.need(stride * height, xorAt);
  let alphaUsed = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = xorAt + (height - 1 - y) * stride, d = (y * width + x) * 4;
    if (bpp === 32 || bpp === 24) { const p = row + x * (bpp / 8); out.data[d] = bytes[p + 2]; out.data[d + 1] = bytes[p + 1]; out.data[d + 2] = bytes[p]; out.data[d + 3] = bpp === 32 ? bytes[p + 3] : 255; if (bpp === 32 && bytes[p + 3]) alphaUsed = true; }
    else if (bpp === 16) { const v = bytes[row + x * 2] | bytes[row + x * 2 + 1] << 8; out.data[d] = ((v >> 10) & 31) * 8.226; out.data[d + 1] = ((v >> 5) & 31) * 8.226; out.data[d + 2] = (v & 31) * 8.226; out.data[d + 3] = 255; }
    else { const bit = x * bpp, i = (bytes[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1), p = paletteAt + i * 4; out.data[d] = bytes[p + 2]; out.data[d + 1] = bytes[p + 1]; out.data[d + 2] = bytes[p]; out.data[d + 3] = 255; }
  }
  if (!(bpp === 32 && alphaUsed) && maskAt + maskStride * height <= bytes.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((bytes[maskAt + (height - 1 - y) * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1) out.data[(y * width + x) * 4 + 3] = 0;
  return out;
}
export async function decodeIco(bytes: Uint8Array): Promise<Pixels> {
  const r = new Reader(bytes), count = r.u16(4); if (!count || count > 512) throw truncated();
  const entries = Array.from({ length: count }, (_, i) => { const p = 6 + i * 16; r.need(16, p); return { width: bytes[p] || 256, height: bytes[p + 1] || 256, bpp: r.u16(p + 6), size: r.u32(p + 8), offset: r.u32(p + 12) }; });
  const best = [...entries].sort((a, b) => b.width * b.height - a.width * a.height || b.bpp - a.bpp)[0]; r.need(Math.min(best.size, 8), best.offset);
  const data = bytes.subarray(best.offset, best.offset + best.size);
  const image = data[0] === 0x89 && data[1] === 0x50 ? await browserPixels(data, 'image/png') : decodeDib(bytes, best.offset, best.size);
  const sizes = [...new Set(entries.map(e => `${e.width}×${e.height}`))].join(', ');
  return { ...image, details: [['Icon sizes', sizes], ['Showing', `${image.width} × ${image.height}`]] };
}
export async function decodeIcns(bytes: Uint8Array): Promise<Pixels> {
  const r = new Reader(bytes, false), total = Math.min(r.u32(4), bytes.length), found: { type: string; data: Uint8Array }[] = [];
  for (let p = 8; p + 8 <= total;) { const type = String.fromCharCode(...bytes.subarray(p, p + 4)), length = r.u32(p + 4); if (length < 8) break; const data = bytes.subarray(p + 8, Math.min(total, p + length)); if (data[0] === 0x89 && data[1] === 0x50 || data[4] === 0x6a && data[5] === 0x50) found.push({ type, data }); p += length; }
  const candidates = found.sort((a, b) => b.data.length - a.data.length);
  for (const entry of candidates) { try { const image = await browserPixels(entry.data, entry.data[0] === 0x89 ? 'image/png' : 'image/jp2'); return { ...image, details: [['Icon images', String(found.length)], ['Showing', `${image.width} × ${image.height}`]] }; } catch { /* Try a smaller representation. */ } }
  throw new Error('This icon file only contains legacy bitmaps Preview can’t read.');
}

// ---------- DDS (uncompressed, BC1–BC3) ----------
function rgb565(v: number) { return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]; }
export function decodeDds(bytes: Uint8Array): Pixels {
  const r = new Reader(bytes); r.need(128, 0);
  const height = r.u32(12), width = r.u32(16), flags = r.u32(80), fourCC = String.fromCharCode(...bytes.subarray(84, 88)), bits = r.u32(88), masks = [r.u32(92), r.u32(96), r.u32(100), r.u32(104)];
  let format = fourCC, pos = 128;
  if (fourCC === 'DX10') { const dxgi = r.u32(128); pos = 148; format = ({ 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5', 28: 'RGBA', 29: 'RGBA', 87: 'BGRA', 91: 'BGRA' } as Record<number, string>)[dxgi] ?? ''; if (!format) throw new Error('This DDS texture format isn’t supported.'); }
  const out = pixels(width, height);
  if (format === 'RGBA' || format === 'BGRA') { r.need(width * height * 4, pos); for (let i = 0; i < width * height; i++) { const s = pos + i * 4, d = i * 4; out.data[d] = bytes[s + (format === 'BGRA' ? 2 : 0)]; out.data[d + 1] = bytes[s + 1]; out.data[d + 2] = bytes[s + (format === 'BGRA' ? 0 : 2)]; out.data[d + 3] = bytes[s + 3]; } return { ...out, details: [['Texture', 'Uncompressed']] }; }
  if (!(flags & 4)) {
    const size = bits / 8; if (![2, 3, 4].includes(size)) throw new Error('This DDS pixel layout isn’t supported.'); r.need(width * height * size, pos);
    const channel = (v: number, mask: number) => { if (!mask) return 255; let shift = 0; while (!((mask >>> shift) & 1)) shift++; const max = mask >>> shift; return ((v & mask) >>> shift) * 255 / max; };
    for (let i = 0; i < width * height; i++) { const s = pos + i * size; let v = 0; for (let b = 0; b < size; b++) v |= bytes[s + b] << (8 * b); v >>>= 0; const d = i * 4; out.data[d] = channel(v, masks[0]); out.data[d + 1] = channel(v, masks[1]); out.data[d + 2] = channel(v, masks[2]); out.data[d + 3] = masks[3] && flags & 1 ? channel(v, masks[3]) : 255; }
    return { ...out, details: [['Texture', `Uncompressed ${bits}-bit`]] };
  }
  if (!['DXT1', 'DXT3', 'DXT5'].includes(format)) throw new Error(`DDS ${format.trim() || 'compressed'} textures aren’t supported.`);
  const blockSize = format === 'DXT1' ? 8 : 16, bw = Math.ceil(width / 4), bh = Math.ceil(height / 4); r.need(bw * bh * blockSize, pos);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const block = pos + (by * bw + bx) * blockSize, colorAt = block + (format === 'DXT1' ? 0 : 8), c0 = r.u16(colorAt), c1 = r.u16(colorAt + 2), a = rgb565(c0), b = rgb565(c1);
    const palette = c0 > c1 || format !== 'DXT1' ? [a, b, a.map((v, i) => (2 * v + b[i]) / 3), a.map((v, i) => (v + 2 * b[i]) / 3)] : [a, b, a.map((v, i) => (v + b[i]) / 2), [0, 0, 0]];
    const indices = r.u32(colorAt + 4), alphas: number[] = [];
    if (format === 'DXT5') { const a0 = bytes[block], a1 = bytes[block + 1]; alphas.push(a0, a1); for (let i = 1; i < 7; i++) alphas.push(a0 > a1 ? ((7 - i) * a0 + i * a1) / 7 : i < 5 ? ((5 - i) * a0 + i * a1) / 5 : 0); if (a0 <= a1) { alphas[6] = 0; alphas[7] = 255; } }
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2); if (x >= width || y >= height) continue;
      const ci = (indices >>> (i * 2)) & 3, d = (y * width + x) * 4, color = palette[ci];
      out.data[d] = color[0]; out.data[d + 1] = color[1]; out.data[d + 2] = color[2];
      if (format === 'DXT1') out.data[d + 3] = c0 <= c1 && ci === 3 ? 0 : 255;
      else if (format === 'DXT3') out.data[d + 3] = ((bytes[block + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      else { const bit = i * 3, lo = bytes[block + 2 + (bit >> 3)] | (bytes[block + 3 + (bit >> 3)] ?? 0) << 8; out.data[d + 3] = alphas[(lo >> (bit & 7)) & 7]; }
    }
  }
  return { ...out, details: [['Texture', `${format} (${format === 'DXT1' ? 'BC1' : format === 'DXT3' ? 'BC2' : 'BC3'})`]] };
}

// ---------- OpenEXR (scanline; none, RLE, ZIPS, ZIP) ----------
export async function decodeExr(bytes: Uint8Array): Promise<Pixels> {
  const r = new Reader(bytes); r.pos = 4; const version = r.u32();
  if (version & 0x200) throw new Error('Tiled OpenEXR images aren’t supported.');
  if (version & 0x1000) throw new Error('Multi-part OpenEXR images aren’t supported.');
  const cstr = () => { const start = r.pos; while (r.u8() !== 0); return String.fromCharCode(...bytes.subarray(start, r.pos - 1)); };
  const channels: { name: string; type: number; xs: number; ys: number }[] = []; let compression = 0, box = [0, 0, 0, 0];
  for (;;) {
    const name = cstr(); if (!name) break; const type = cstr(), size = r.u32(), end = r.pos + size; r.need(size);
    if (name === 'channels') { while (r.pos < end - 1) { const n = cstr(); const t = r.u32(); r.pos += 4; const xs = r.i32(), ys = r.i32(); channels.push({ name: n, type: t, xs, ys }); } }
    else if (name === 'compression') compression = bytes[r.pos];
    else if (name === 'dataWindow' && type === 'box2i') box = [r.i32(r.pos), r.i32(r.pos + 4), r.i32(r.pos + 8), r.i32(r.pos + 12)];
    r.pos = end;
  }
  const lines = ({ 0: 1, 1: 1, 2: 1, 3: 16 } as Record<number, number>)[compression];
  if (!lines) throw new Error(`This OpenEXR compression (${['none', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'][compression] ?? compression}) isn’t supported.`);
  if (channels.some(c => c.xs !== 1 || c.ys !== 1)) throw new Error('Subsampled OpenEXR channels aren’t supported.');
  const width = box[2] - box[0] + 1, height = box[3] - box[1] + 1; checkSize(width, height);
  channels.sort((a, b) => a.name < b.name ? -1 : 1);
  const sizeOf = (t: number) => t === 1 ? 2 : 4, lineBytes = channels.reduce((sum, c) => sum + sizeOf(c.type) * width, 0), blocks = Math.ceil(height / lines), table = r.pos;
  const pick = (names: string[]) => channels.findIndex(c => names.includes(c.name) || names.some(n => c.name.endsWith('.' + n)));
  const ri = pick(['R']), gi = pick(['G']), bi = pick(['B']), ai = pick(['A']), yi = pick(['Y']), gray = ri < 0 && yi >= 0;
  if (!gray && (ri < 0 || gi < 0 || bi < 0)) throw new Error('This OpenEXR image has no RGB or luminance channels.');
  const rgb = new Float32Array(width * height * 3), alpha = ai >= 0 ? new Float32Array(width * height) : null;
  for (let block = 0; block < blocks; block++) {
    const offset = Number(r.view.getBigUint64(table + block * 8, true)); r.need(8, offset);
    const y0 = r.i32(offset) - box[1], size = r.u32(offset + 4), count = Math.min(lines, height - y0); r.need(size, offset + 8);
    let data = bytes.subarray(offset + 8, offset + 8 + size); const expected = lineBytes * count;
    if (compression !== 0 && size < expected) {
      let raw: Uint8Array;
      if (compression === 1) { raw = new Uint8Array(expected); for (let i = 0, o = 0; i < data.length && o < expected;) { const n = (data[i++] << 24) >> 24; if (n < 0) { for (let k = 0; k < -n && o < expected; k++) raw[o++] = data[i++]; } else { const v = data[i++]; for (let k = 0; k <= n && o < expected; k++) raw[o++] = v; } } }
      else raw = await inflate(data);
      for (let i = 1; i < raw.length; i++) raw[i] = (raw[i - 1] + raw[i] - 128) & 255;
      const half = Math.ceil(raw.length / 2), merged = new Uint8Array(raw.length);
      for (let i = 0, a = 0, b = half; i < raw.length; i += 2) { merged[i] = raw[a++]; if (i + 1 < raw.length) merged[i + 1] = raw[b++]; }
      data = merged;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let line = 0; line < count; line++) {
      let at = line * lineBytes; const y = y0 + line;
      for (let c = 0; c < channels.length; c++) {
        const type = channels[c].type, size = sizeOf(type);
        if (at + width * size > data.length) throw truncated();
        for (let x = 0; x < width; x++) {
          const v = type === 1 ? halfToFloat(view.getUint16(at + x * 2, true)) : type === 2 ? view.getFloat32(at + x * 4, true) : view.getUint32(at + x * 4, true) / 4294967295, i = y * width + x;
          if (c === ri || gray && c === yi) { rgb[i * 3] = v; if (gray) { rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v; } }
          else if (c === gi) rgb[i * 3 + 1] = v; else if (c === bi) rgb[i * 3 + 2] = v; else if (c === ai && alpha) alpha[i] = v;
        }
        at += width * size;
      }
    }
  }
  return { ...toneMap(rgb, alpha, width, height), details: [['Channels', channels.map(c => c.name).join(', ')], ['Compression', ['None', 'RLE', 'ZIPS', 'ZIP'][compression]], ['Dynamic range', 'High (tone mapped for display)']] };
}
