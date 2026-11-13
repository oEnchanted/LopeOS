import type { CSSProperties } from 'react';
import type { Preferences } from '../../../../packages/contracts/src/preferences';
import { preferences } from '../../../../packages/sdk/src/preferences';
import { wallpapers } from './wallpapers';
export function interfaceScale() { return preferences.getSnapshot().interfaceScale / 100; }
export function viewport() { const scale = interfaceScale(); return { width: innerWidth / scale, height: innerHeight / scale }; }
/** Floating windows can overlap the Dock; only arranged windows reserve its space. */
export function desktopArea() {
  const { width, height } = viewport();
  return { x: 8, y: 42, width: Math.max(240, width - 16), height: Math.max(180, height - 54) };
}
export function workArea() {
  const { width, height } = viewport(); const p = preferences.getSnapshot();
  const clearance = p.dockAutoHide ? 12 : p.dockSize + 38;
  const left = p.dockPosition === 'left' ? clearance : 8, right = p.dockPosition === 'right' ? clearance : 8;
  return { x: left, y: 42, width: Math.max(240, width - left - right), height: Math.max(180, height - 42 - (p.dockPosition === 'bottom' ? clearance : 12)) };
}
export function appearanceAttributes(p: Preferences) {
  return { 'data-theme': p.theme === 'system' ? matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' : p.theme,
    'data-reduce-transparency': p.reduceTransparency, 'data-reduce-motion': p.reduceMotion,
    'data-increase-contrast': p.increaseContrast, 'data-icon-style': p.iconStyle, 'data-density': p.density,
    'data-effects': p.effectsQuality, 'data-noncolor': p.nonColorIndicators, 'data-strong-focus': p.strongFocus,
    'data-window-animation': p.windowAnimation, 'data-menubar': p.menuBarVisibility,
    'data-compact': viewport().width < 700, 'data-dock-position': p.dockPosition,
  };
}
export function appearanceStyle(p: Preferences): CSSProperties {
  const channels = [1,3,5].map(i=>parseInt(p.accent.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  const luminance=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  const ink=luminance>.179?'#112c3d':'#ffffff';
  const wallpaperKind = wallpapers.find(wallpaper => wallpaper.id === p.wallpaper)?.kind;
  return { '--accent': p.accent, '--accent-ink': ink, '--selection': p.selection, '--folder-color': p.folderColor,
    '--glass-clarity': p.glassClarity, '--glass-alpha': String(.88 - p.glassClarity * .0068), '--chrome-alpha': String(.86 - p.glassClarity * .0045),
    '--menu-alpha': String(.23 + p.menuBarStrength * .007), '--wallpaper-tint': p.wallpaperTinting ? (wallpaperKind === 'dark' ? '#468997' : wallpaperKind === 'light' ? '#63b7cd' : p.accent) : '#a8b6c0',
    '--sidebar-icon-size': p.sidebarIconSize + 'px', '--ui-text-scale': p.textSize / 100, '--ui-scale': p.interfaceScale / 100,
    '--density-space': p.density === 'compact' ? '9px' : p.density === 'comfortable' ? '17px' : '13px',
  } as CSSProperties;
}

/** Keep first-run screens, dialogs, and the desktop on the same accessibility settings. */
export function syncDocumentAppearance(p: Preferences) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(appearanceAttributes(p))) root.setAttribute(key, String(value));
  for (const [key, value] of Object.entries(appearanceStyle(p))) root.style.setProperty(key, String(value));
  // Setup uses rem units; existing desktop chrome scales its pixel text with --ui-text-scale.
  root.style.fontSize = `${p.textSize}%`;
}
