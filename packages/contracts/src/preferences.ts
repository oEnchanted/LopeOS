export const SETTINGS_VERSION = 2;
export type PreferenceSpec<T> = { default: T; valid: (value: unknown) => value is T };
const bool = (value: boolean): PreferenceSpec<boolean> => ({ default: value, valid: (v): v is boolean => typeof v === 'boolean' });
const number = (value: number, min: number, max: number): PreferenceSpec<number> => ({ default: value, valid: (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max });
const text = (value: string, max = 100): PreferenceSpec<string> => ({ default: value, valid: (v): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v) });
const choice = <T extends string>(value: T, options: readonly T[]): PreferenceSpec<T> => ({ default: value, valid: (v): v is T => typeof v === 'string' && options.includes(v as T) });
const color = (value: string): PreferenceSpec<string> => ({ default: value, valid: (v): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) });
const list = (value: string[]): PreferenceSpec<string[]> => ({ default: value, valid: (v): v is string[] => Array.isArray(v) && v.length <= 50 && v.every(s => typeof s === 'string' && s.length <= 256 && !/[\u0000-\u001f]/.test(s)) });
const statusIds = ['weather','search','notifications','focus','sound','runtime','clock'];
const statusList = (all = false): PreferenceSpec<string[]> => ({ default: [...statusIds], valid: (v): v is string[] => Array.isArray(v) && v.every(x => statusIds.includes(x)) && new Set(v).size === v.length && (!all || v.length === statusIds.length) });
const paths: PreferenceSpec<string[]> = { default: ['/Documents','/Downloads'], valid: (v): v is string[] => list([]).valid(v) && v.length > 0 && v.every(x => x.startsWith('/') && !x.split('/').includes('..') && !x.includes('\\')) };
const flags = (): PreferenceSpec<Record<string, boolean>> => ({ default: {}, valid: (v): v is Record<string, boolean> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, val]) => /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(k) && !['__proto__','constructor','prototype'].includes(k) && typeof val === 'boolean') });
export interface WeatherLocationPreference { name: string; latitude: number; longitude: number; country?: string; timezone?: string }
export const preferenceSchema = {
  theme: choice('light', ['light','dark','system']),
  accent: color('#167bac'), selection: color('#73c9ec'), glassClarity: number(64, 0, 100),
  iconStyle: choice('default', ['default','dark','clear','tinted']), folderColor: color('#62b9df'),
  sidebarIconSize: number(17, 14, 24), wallpaperTinting: bool(true),
  wallpaper: text('perfecthue-light'), background: choice('automatic', ['automatic','morning','afternoon','blue-hour','midnight']), wallpaperFit: choice('fill', ['fill','fit','center']), wallpaperRotation: number(0, 0, 1440),
  dockSize: number(52, 36, 68), dockMagnification: bool(true), dockPosition: choice('bottom', ['bottom','left','right']),
  dockAutoHide: bool(false), windowAnimation: choice('gentle', ['gentle','none']), runningIndicators: bool(true),
  pinned: list(['lope.welcome','lope.files','lope.browser','lope.editor','lope.weather','lope.calculator','lope.settings','lope.writer','lope.image-editor','lope.lightroom']),
  showRecentApps: bool(true), minimizeDestination: choice('app', ['app','dock']),
  titlebarDoubleClick: choice('maximize', ['maximize','minimize','none']), desktopItems: bool(true),
  showDesktopBehavior: choice('toggle', ['toggle','minimize']),
  interfaceScale: number(100, 80, 150), textSize: number(100, 85, 150), density: choice('default', ['compact','default','comfortable']),
  effectsQuality: choice('high', ['high','balanced','low']),
  menuBarVisibility: choice('always', ['always','auto']), menuBarStrength: number(45, 15, 100),
  statusItems: statusList(),
  statusOrder: statusList(true),
  clock24: bool(false), clockDate: bool(true), clockWeekday: bool(true), clockSeconds: bool(false), recentItemCount: number(5, 0, 12),
  region: choice('en-US', ['en-US','en-GB','de-DE','fr-FR','ja-JP']), dateStyle: choice('medium', ['short','medium','long']),
  startupApps: list([]), restoreLayout: bool(true), profileName: text('Your workspace', 40),
  searchApps: bool(true), searchCommands: bool(true), searchFiles: bool(false),
  searchRoots: paths, searchExclusions: list(['.git','node_modules']),
  searchHistoryDays: number(0, 0, 30), searchShortcut: choice('Mod+K', ['Mod+K','Alt+Space']),
  dnd: bool(false), presentationMode: bool(false), notificationPreviews: choice('always', ['always','when-active','never']),
  notificationHistoryDays: number(1, 0, 30), notificationBadges: bool(true), browserAlerts: bool(false),
  appAlerts: flags(), appBadges: flags(), appSounds: flags(),
  soundVolume: number(70, 0, 100), soundMuted: bool(false), alertVolume: number(55, 0, 100),
  alertSound: choice('glass', ['glass','drop','soft']), interfaceSounds: bool(false),
  reduceMotion: bool(false), reduceTransparency: bool(false), increaseContrast: bool(false),
  nonColorIndicators: bool(false), strongFocus: bool(false), hoverText: bool(false),
  speechRate: number(1, 0.5, 1.5), mediaCaptions: bool(false),
  idlePrivacyMinutes: number(0, 0, 60), privacyOnHidden: bool(false),
  cameraTools: bool(true), microphoneTools: bool(true), screenTools: bool(true), locationAccess: bool(true),
  clipboardHistory: bool(false), clipboardRetentionMinutes: number(15, 1, 60), diagnostics: bool(false),
  fileAccess: flags(), appLaunch: flags(),
  'weather.location': { default: { name: 'Denver', latitude: 39.7392, longitude: -104.9903, country: 'United States', timezone: 'America/Denver' }, valid: (v: unknown): v is WeatherLocationPreference => !!v && typeof v === 'object' && Object.keys(v).every(k => ['name','latitude','longitude','country','timezone'].includes(k)) && ['country','timezone'].every(k => !(k in v) || text('',100).valid((v as Record<string,unknown>)[k])) && typeof (v as WeatherLocationPreference).name === 'string' && (v as WeatherLocationPreference).name.length <= 100 && Number.isFinite((v as WeatherLocationPreference).latitude) && Math.abs((v as WeatherLocationPreference).latitude) <= 90 && Number.isFinite((v as WeatherLocationPreference).longitude) && Math.abs((v as WeatherLocationPreference).longitude) <= 180 } as PreferenceSpec<WeatherLocationPreference>,
  'weather.units': choice('celsius', ['celsius','fahrenheit']), weatherAutoRefresh: bool(true),
  'defaults.browser': text('lope.browser'), 'defaults.text': text('lope.editor'),
};
export type PreferenceKey = keyof typeof preferenceSchema;
export type Preferences = { [K in PreferenceKey]: (typeof preferenceSchema)[K]['default'] };
export const preferenceDefaults = Object.fromEntries(Object.entries(preferenceSchema).map(([key, spec]) => [key, spec.default])) as Preferences;
export function validPreference(key: string, value: unknown): key is PreferenceKey {
  return Object.hasOwn(preferenceSchema, key) && preferenceSchema[key as PreferenceKey].valid(value);
}
export function validatePreferenceImport(input: unknown): { values: Partial<Preferences>; count: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a LopeOS preferences JSON file.');
  const document = input as { version?: unknown; preferences?: unknown };
  if (document.version !== SETTINGS_VERSION || !document.preferences || typeof document.preferences !== 'object' || Array.isArray(document.preferences)) throw new Error('This file is not a supported version 2 preference export.');
  const entries = Object.entries(document.preferences);
  if (entries.length > 150) throw new Error('Too many preferences in this file.');
  for (const [key, value] of entries) if (!validPreference(key, value)) throw new Error('Invalid or unsupported preference: ' + key);
  return { values: Object.fromEntries(entries) as Partial<Preferences>, count: entries.length };
}
