/** Every image container Preview recognizes, how it is decoded, and whether it can be written back. */
export type Decoder = 'browser' | 'svg' | 'tiff' | 'photo' | 'tga' | 'pnm' | 'qoi' | 'hdr' | 'pcx' | 'xbm' | 'wbmp' | 'farbfeld' | 'ico' | 'icns' | 'dds' | 'exr';
export interface ImageFormat {
  id: string; label: string; extensions: string[]; mime?: string;
  decoder: Decoder;
  /** The encoded file can hold transparency. */
  alpha: boolean;
  /** Preview can write this format (Save, Export). */
  writable: boolean;
  /** Decoding depends on the browser rather than code bundled with LopeOS. */
  conditional?: boolean;
}
const raw = (id: string, label: string): ImageFormat => ({ id, label: `${label} raw image`, extensions: [id], decoder: 'photo', alpha: false, writable: false });
export const formats: ImageFormat[] = [
  { id: 'png', label: 'PNG image', extensions: ['png', 'apng'], mime: 'image/png', decoder: 'browser', alpha: true, writable: true },
  { id: 'jpeg', label: 'JPEG image', extensions: ['jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp'], mime: 'image/jpeg', decoder: 'browser', alpha: false, writable: true },
  { id: 'webp', label: 'WebP image', extensions: ['webp'], mime: 'image/webp', decoder: 'browser', alpha: true, writable: true },
  { id: 'tiff', label: 'TIFF image', extensions: ['tif', 'tiff'], mime: 'image/tiff', decoder: 'tiff', alpha: true, writable: true },
  { id: 'gif', label: 'GIF image', extensions: ['gif'], mime: 'image/gif', decoder: 'browser', alpha: true, writable: false },
  { id: 'bmp', label: 'BMP image', extensions: ['bmp', 'dib'], mime: 'image/bmp', decoder: 'browser', alpha: true, writable: true },
  { id: 'svg', label: 'SVG vector image', extensions: ['svg', 'svgz'], mime: 'image/svg+xml', decoder: 'svg', alpha: true, writable: false },
  { id: 'heic', label: 'HEIF image', extensions: ['heic', 'heif', 'hif', 'heics', 'heifs'], mime: 'image/heic', decoder: 'browser', alpha: true, writable: false, conditional: true },
  { id: 'avif', label: 'AVIF image', extensions: ['avif', 'avifs'], mime: 'image/avif', decoder: 'browser', alpha: true, writable: false, conditional: true },
  { id: 'jxl', label: 'JPEG XL image', extensions: ['jxl'], mime: 'image/jxl', decoder: 'browser', alpha: true, writable: false, conditional: true },
  { id: 'jp2', label: 'JPEG 2000 image', extensions: ['jp2', 'j2k', 'j2c', 'jpx', 'jpf', 'jpm'], mime: 'image/jp2', decoder: 'browser', alpha: true, writable: false, conditional: true },
  { id: 'ico', label: 'Windows icon', extensions: ['ico', 'cur'], mime: 'image/x-icon', decoder: 'ico', alpha: true, writable: true },
  { id: 'icns', label: 'Apple icon image', extensions: ['icns'], mime: 'image/icns', decoder: 'icns', alpha: true, writable: false },
  { id: 'tga', label: 'Targa image', extensions: ['tga', 'icb', 'vda', 'vst', 'tpic'], mime: 'image/x-tga', decoder: 'tga', alpha: true, writable: true },
  { id: 'qoi', label: 'QOI image', extensions: ['qoi'], decoder: 'qoi', alpha: true, writable: true },
  { id: 'pnm', label: 'Netpbm image', extensions: ['pbm', 'pgm', 'ppm', 'pnm', 'pam', 'pfm'], mime: 'image/x-portable-anymap', decoder: 'pnm', alpha: true, writable: true },
  { id: 'hdr', label: 'Radiance HDR image', extensions: ['hdr', 'pic', 'rgbe'], mime: 'image/vnd.radiance', decoder: 'hdr', alpha: false, writable: false },
  { id: 'exr', label: 'OpenEXR image', extensions: ['exr'], mime: 'image/x-exr', decoder: 'exr', alpha: true, writable: false },
  { id: 'dds', label: 'DirectDraw Surface', extensions: ['dds'], mime: 'image/vnd-ms.dds', decoder: 'dds', alpha: true, writable: false },
  { id: 'pcx', label: 'PCX image', extensions: ['pcx', 'pcc'], mime: 'image/x-pcx', decoder: 'pcx', alpha: false, writable: false },
  { id: 'xbm', label: 'X BitMap', extensions: ['xbm'], mime: 'image/x-xbitmap', decoder: 'xbm', alpha: false, writable: false },
  { id: 'wbmp', label: 'Wireless bitmap', extensions: ['wbmp'], mime: 'image/vnd.wap.wbmp', decoder: 'wbmp', alpha: false, writable: false },
  { id: 'farbfeld', label: 'Farbfeld image', extensions: ['ff'], decoder: 'farbfeld', alpha: true, writable: false },
  { id: 'psd', label: 'Photoshop document', extensions: ['psd'], mime: 'image/vnd.adobe.photoshop', decoder: 'photo', alpha: true, writable: false },
  { id: 'lopeimage', label: 'Prism document', extensions: ['lopeimage'], decoder: 'photo', alpha: true, writable: false },
  ...[['dng', 'DNG'], ['cr2', 'Canon'], ['cr3', 'Canon'], ['crw', 'Canon'], ['nef', 'Nikon'], ['nrw', 'Nikon'], ['arw', 'Sony'], ['srf', 'Sony'], ['sr2', 'Sony'], ['raf', 'Fujifilm'], ['rw2', 'Panasonic'], ['orf', 'OM System'], ['pef', 'Pentax'], ['srw', 'Samsung'], ['3fr', 'Hasselblad'], ['fff', 'Hasselblad'], ['iiq', 'Phase One'], ['mos', 'Leaf'], ['mrw', 'Minolta'], ['x3f', 'Sigma'], ['erf', 'Epson'], ['kdc', 'Kodak'], ['dcr', 'Kodak'], ['rwl', 'Leica']].map(([id, label]) => raw(id, label)),
  { id: 'pdf', label: 'PDF document', extensions: ['pdf'], mime: 'application/pdf', decoder: 'browser', alpha: false, writable: true },
];
/** The formats offered by Export, in menu order. PDF is write-only. */
export const exportFormats = ['png', 'jpeg', 'webp', 'tiff', 'pdf', 'bmp', 'tga', 'ico', 'qoi', 'pnm'].map(id => formats.find(format => format.id === id)).filter((format): format is ImageFormat => !!format);
export const readableFormats = formats.filter(format => format.id !== 'pdf');
export const previewExtensions = readableFormats.flatMap(format => format.extensions.map(ext => '.' + ext));
export const previewAssociations = [...previewExtensions, ...new Set(readableFormats.map(format => format.mime).filter((mime): mime is string => !!mime))];
export const formatById = (id: string) => formats.find(format => format.id === id)!;
export const extensionOf = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
export const formatForExtension = (name: string) => readableFormats.find(format => format.extensions.includes(extensionOf(name)));
export const defaultExtension = (format: ImageFormat) => format.id === 'pnm' ? 'ppm' : format.extensions[0];
export const isRawFormat = (format: ImageFormat) => format.decoder === 'photo' && !['psd', 'lopeimage'].includes(format.id);

/** Identify a file by its signature first, so a misnamed file still opens with the right decoder. */
export function identify(bytes: Uint8Array, name: string): ImageFormat {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
  const byExtension = formatForExtension(name);
  if (byExtension?.decoder === 'photo') return byExtension;
  const id = (() => {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes[0] === 0x89 && text(1, 4) === 'PNG') return 'png';
    if (text(0, 3) === 'GIF') return 'gif';
    if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
    if (text(0, 2) === 'BM') return 'bmp';
    if (text(0, 2) === 'II' && bytes[2] === 42 || text(0, 2) === 'MM' && bytes[3] === 42) return 'tiff';
    if (text(0, 4) === '8BPS') return 'psd';
    if (text(4, 8) === 'ftyp') { const brand = text(8, 12); return ['avif', 'avis'].includes(brand) ? 'avif' : ['crx '].includes(brand) ? 'cr3' : brand.startsWith('jp2') || brand === 'jpx ' ? 'jp2' : 'heic'; }
    if (bytes[0] === 0xff && bytes[1] === 0x0a || text(4, 8) === 'JXL ') return 'jxl';
    if (text(4, 8) === 'jP  ' || bytes[0] === 0xff && bytes[1] === 0x4f && bytes[2] === 0xff && bytes[3] === 0x51) return 'jp2';
    if (text(0, 4) === 'icns') return 'icns';
    if (text(0, 4) === 'qoif') return 'qoi';
    if (text(0, 4) === 'DDS ') return 'dds';
    if (text(0, 8) === 'farbfeld') return 'farbfeld';
    if (bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return 'exr';
    if (text(0, 2) === '#?') return 'hdr';
    if (bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0 && ['ico', 'cur'].includes(extensionOf(name))) return 'ico';
    if (/^P[1-7F]\s|^Pf\s/.test(text(0, 3))) return 'pnm';
    if (bytes[0] === 0x0a && bytes[2] === 1 && extensionOf(name).startsWith('pc')) return 'pcx';
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && extensionOf(name) === 'svgz') return 'svg';
    if (/<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)))) return 'svg';
    if (text(0, 5) === '%PDF-') return 'pdf';
    if (/#define\s+\S+_width/.test(text(0, 512))) return 'xbm';
    return byExtension?.id;
  })();
  if (!id) throw new Error('This file isn’t an image format Preview recognizes.');
  if (id === 'pdf') throw new Error('PDF documents aren’t images. Open PDFs in Lope Browser.');
  return formatById(id);
}
