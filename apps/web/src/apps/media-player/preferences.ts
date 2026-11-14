// VLC's Simple Preferences that apply to this player, persisted per user.
// Self-contained so Node's test runner can import it directly.

export interface Preferences {
  /** VLC 3 "Continue playback?": ask, always resume, or never. */
  resume: 'ask' | 'always' | 'never';
  osd: boolean;
  /** The Qt interface's volume ceiling: 125% by default, 200% when raised. */
  maxVolume: 1.25 | 2;
  jumps: { veryShort: number; short: number; medium: number; long: number };
  autoSubtitles: boolean;
  subtitleScale: number;
  subtitleColor: string;
  subtitleBackground: boolean;
  outputDevice: string;
}
export const DEFAULT_PREFERENCES: Preferences = {
  resume: 'ask', osd: true, maxVolume: 1.25, jumps: { veryShort: 3, short: 10, medium: 60, long: 300 }, autoSubtitles: true,
  subtitleScale: 1, subtitleColor: '#ffffff', subtitleBackground: false, outputDevice: '',
};
export const SUBTITLE_SIZES: [number, string][] = [[0.6, 'Smaller'], [0.8, 'Small'], [1, 'Normal'], [1.3, 'Large'], [1.6, 'Larger']];

/** Merge stored values over defaults, dropping anything malformed. */
export function readPreferences(stored: unknown): Preferences {
  const value = stored && typeof stored === 'object' ? stored as Partial<Preferences> : {};
  const jumps = { ...DEFAULT_PREFERENCES.jumps };
  for (const key of Object.keys(jumps) as (keyof Preferences['jumps'])[]) {
    const seconds = Number(value.jumps?.[key]);
    if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600) jumps[key] = Math.round(seconds);
  }
  return {
    resume: value.resume === 'always' || value.resume === 'never' ? value.resume : 'ask',
    osd: value.osd !== false,
    maxVolume: value.maxVolume === 2 ? 2 : 1.25,
    jumps,
    autoSubtitles: value.autoSubtitles !== false,
    subtitleScale: SUBTITLE_SIZES.some(([scale]) => scale === value.subtitleScale) ? value.subtitleScale! : 1,
    subtitleColor: typeof value.subtitleColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.subtitleColor) ? value.subtitleColor : '#ffffff',
    subtitleBackground: value.subtitleBackground === true,
    outputDevice: typeof value.outputDevice === 'string' ? value.outputDevice : '',
  };
}

export interface Bookmark { name: string; time: number }
/** Insert a bookmark, keeping the list in time order with VLC's "Bookmark N" naming. */
export function addBookmark(list: Bookmark[], time: number): Bookmark[] {
  const used = new Set(list.map(item => item.name));
  let index = list.length + 1;
  while (used.has(`Bookmark ${index}`)) index++;
  return [...list, { name: `Bookmark ${index}`, time: Math.max(0, Math.round(time * 1000) / 1000) }].sort((a, b) => a.time - b.time);
}
