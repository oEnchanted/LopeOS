/** Normalize to a small raster image, stripping metadata before account sync. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(file.type)) throw new Error('Choose a JPG, PNG, WebP, GIF, AVIF, or BMP image.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', .88);
  } catch { throw new Error('This image could not be opened. Try another image.'); }
  finally { URL.revokeObjectURL(url); }
}
