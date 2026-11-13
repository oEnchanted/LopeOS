/** Decode and shrink photos before saving them to the local account record. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
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
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', .88);
  } catch { throw new Error('Choose an image smaller than 15 MB.'); }
  finally { URL.revokeObjectURL(url); }
}
