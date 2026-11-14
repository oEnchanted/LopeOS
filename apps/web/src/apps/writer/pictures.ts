import { assertReceipt, type WriterEngine } from '../../../../../packages/document-engine/src';

export type WriterPicture = Awaited<ReturnType<WriterEngine['api']['images']['get']>>;
export type PictureWrap = 'inline' | 'square' | 'topAndBottom' | 'behind' | 'front';

export function pictureWrap(image: WriterPicture): PictureWrap {
  if (image.properties.placement === 'inline') return 'inline';
  if (image.properties.wrap.type === 'TopAndBottom') return 'topAndBottom';
  if (image.properties.wrap.type === 'None') return 'front';
  return 'square';
}

export async function setPictureWrap(engine: WriterEngine, imageId: string, wrap: PictureWrap) {
  const image = await engine.api.images.get({ imageId });
  if (wrap === 'inline') {
    if (image.properties.placement !== 'inline') assertReceipt(await engine.api.images.convertToInline({ imageId }));
    return;
  }
  if (image.properties.placement === 'inline') assertReceipt(await engine.api.images.convertToFloating({ imageId }));
  assertReceipt(await engine.api.images.setWrapType({ imageId, type: wrap === 'square' ? 'Square' : wrap === 'topAndBottom' ? 'TopAndBottom' : 'None' }));
  assertReceipt(await engine.api.images.setAnchorOptions({ imageId, options: { behindDoc: wrap === 'behind', allowOverlap: true } }));
}

export async function readPictureFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF picture.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a picture smaller than 8 MB.');
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('The picture could not be read.')); reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = src;
  try { await image.decode(); } catch { throw new Error('The picture could not be decoded. Choose another file.'); }
  const scale = Math.min(1, 520 / image.naturalWidth, 600 / image.naturalHeight);
  return { src, width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) };
}

export async function insertPicture(engine: WriterEngine, file: File, options?: { alt?: string; width?: number; height?: number; wrap?: PictureWrap }) {
  const picture = await readPictureFile(file), before = new Set((await engine.api.images.list({})).items.map(image => image.sdImageId));
  const width = options?.width ?? (options?.height ? options.height * picture.width / picture.height : picture.width);
  const height = options?.height ?? (options?.width ? options.width * picture.height / picture.width : picture.height);
  await engine.command('image', { src: picture.src, alt: options?.alt || file.name, size: { width, height } });
  const inserted = (await engine.api.images.list({})).items.filter(image => !before.has(image.sdImageId));
  if (inserted.length !== 1) throw new Error('The inserted picture could not be selected.');
  const id = inserted[0].sdImageId;
  if (options?.wrap && options.wrap !== 'inline') await setPictureWrap(engine, id, options.wrap);
  return id;
}
