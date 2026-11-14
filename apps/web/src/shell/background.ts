import type { Preferences } from '../../../../packages/contracts/src/preferences';
import type { Wallpaper } from '../../../../packages/contracts/src';
import { isWallpaperAvailable, type PersonalWallpaper } from '../apps/settings/wallpaper-policy';
import { wallpapers } from './wallpapers';
import './background.css';

export const skyOptions = [
  { id: 'automatic', name: 'Automatic', backgroundImage: 'var(--sky-automatic)' },
  { id: 'morning', name: 'Morning', backgroundImage: 'var(--sky-morning)' },
  { id: 'afternoon', name: 'Afternoon', backgroundImage: 'var(--sky-afternoon)' },
  { id: 'blue-hour', name: 'Blue hour', backgroundImage: 'var(--sky-blue-hour)' },
  { id: 'midnight', name: 'Midnight', backgroundImage: 'var(--sky-midnight)' },
] as const;
export type SkyId = Preferences['background'];
export function automaticSky(hour = new Date().getHours()): Exclude<SkyId, 'automatic'> {
  return hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'blue-hour' : 'midnight';
}
export interface DesktopBackground {
  id: string;
  name: string;
  backgroundImage: string;
  wallpaper?: Wallpaper | PersonalWallpaper;
}
/**
 * Personal wallpapers are persisted and account-synced, so treat them as untrusted.
 * Only a plain base64 raster data URL may reach CSS url(): quotes, parentheses or
 * whitespace could otherwise add extra image layers that fetch remote URLs.
 */
export function isSafeImageDataURL(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4 * 1024 * 1024 && /^data:image\/(?:png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function resolveDesktopBackground(p: Preferences, personal?: PersonalWallpaper | null): DesktopBackground {
  if (p.wallpaper === 'sky') {
    const sky = p.background === 'automatic' ? automaticSky() : p.background;
    return { id: `sky-${sky}`, name: skyOptions.find(option => option.id === p.background)!.name, backgroundImage: `var(--sky-${sky})` };
  }
  const wallpaper = p.wallpaper === 'personal' && isSafeImageDataURL(personal?.asset) ? personal
    : wallpapers.find(wallpaper => wallpaper.id === p.wallpaper && isWallpaperAvailable(wallpaper)) ?? wallpapers[0];
  return { id: wallpaper.id, name: wallpaper.name, backgroundImage: `url("${wallpaper.asset}")`, wallpaper };
}
