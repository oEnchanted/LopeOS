import type { Wallpaper } from '../../../../../packages/contracts/src';

export function isPerfectHue(wallpaper: Wallpaper) {
  return /perfect\s*hue/i.test(wallpaper.creator) || [wallpaper.sourceURL, wallpaper.creditURL].some(value => {
    try { const host = new URL(value || '').hostname; return host === 'perfecthue.com' || host.endsWith('.perfecthue.com'); } catch { return false; }
  });
}
export function isWallpaperAvailable(wallpaper: Wallpaper): boolean {
  if (wallpaper.permission === 'pending') return false;
  if (!isPerfectHue(wallpaper)) return wallpaper.permission === 'original' || wallpaper.permission === 'authorized';
  try {
    const credit = new URL(wallpaper.creditURL || '');
    return wallpaper.permission === 'authorized' && credit.protocol === 'https:' && (credit.hostname === 'perfecthue.com' || credit.hostname.endsWith('.perfecthue.com'));
  } catch { return false; }
}
export interface PersonalWallpaper { id: 'personal'; name: string; asset: string; creator: string; sourceURL: null; creditURL: null; permission: 'original'; kind: 'light'; originalName: string; importedAt: string }
export async function readPersonalWallpaper(file: File): Promise<PersonalWallpaper> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or AVIF image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image smaller than 2 MB so it can be saved on this device.');
  const asset = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('The image could not be read.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
  await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => { if (image.naturalWidth && image.naturalHeight) resolve(); else reject(new Error('The image has no dimensions.')); }; image.onerror = () => reject(new Error('The selected file is not a supported image.')); image.src = asset; });
  return { id: 'personal', name: file.name, originalName: file.name, asset, creator: 'Personal image', sourceURL: null, creditURL: null, permission: 'original', kind: 'light', importedAt: new Date().toISOString() };
}
