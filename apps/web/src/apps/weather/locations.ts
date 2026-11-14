import type { SettingsService } from '../../../../../packages/contracts/src';
import { MAX_WEATHER_LOCATIONS, preferenceDefaults, validPreference, validWeatherLocationPreference, weatherLocationKey, type Preferences, type WeatherLocationPreference } from '../../../../../packages/contracts/src/preferences.ts';

export { MAX_WEATHER_LOCATIONS, weatherLocationKey };
const EMPTY_LOCATIONS: WeatherLocationPreference[] = [];
const fallbackSnapshots = new WeakMap<SettingsService, { active: WeatherLocationPreference; saved: WeatherLocationPreference[]; locations: WeatherLocationPreference[] }>();

/** Stable snapshot for useSyncExternalStore, including older SettingsService adapters. */
export function getWeatherLocations(settings: SettingsService): WeatherLocationPreference[] {
  const active = settings.get('weather.location', preferenceDefaults['weather.location']);
  const saved = settings.get('weather.locations', EMPTY_LOCATIONS);
  if (validPreference('weather.locations', saved) && saved.some(location => weatherLocationKey(location) === weatherLocationKey(active))) return saved;
  const previous = fallbackSnapshots.get(settings);
  if (previous?.active === active && previous.saved === saved) return previous.locations;
  const locations: WeatherLocationPreference[] = [];
  const seen = new Set<string>();
  for (const location of (Array.isArray(saved) ? saved : [])) {
    if (!validWeatherLocationPreference(location) || seen.has(weatherLocationKey(location))) continue;
    seen.add(weatherLocationKey(location)); locations.push(location);
    if (locations.length === MAX_WEATHER_LOCATIONS) break;
  }
  if (validWeatherLocationPreference(active) && !seen.has(weatherLocationKey(active))) {
    if (locations.length === MAX_WEATHER_LOCATIONS) locations.pop();
    locations.push(active);
  }
  if (!locations.length) locations.push(preferenceDefaults['weather.location']);
  fallbackSnapshots.set(settings, { active, saved, locations });
  return locations;
}

function save(settings: SettingsService, locations: WeatherLocationPreference[], active: WeatherLocationPreference): void {
  const values = { 'weather.locations': locations, 'weather.location': active };
  const batch = settings as SettingsService & { apply?: (values: Partial<Preferences>) => void };
  if (typeof batch.apply === 'function') batch.apply(values);
  else { settings.set('weather.locations', locations); settings.set('weather.location', active); }
}

export function addWeatherLocation(settings: SettingsService, location: WeatherLocationPreference, options: { select?: boolean } = {}): void {
  if (!validWeatherLocationPreference(location)) throw new Error('Choose a valid weather location.');
  const locations = getWeatherLocations(settings);
  const key = weatherLocationKey(location);
  const existing = locations.findIndex(item => weatherLocationKey(item) === key);
  if (existing < 0 && locations.length >= MAX_WEATHER_LOCATIONS) throw new Error(`You can save up to ${MAX_WEATHER_LOCATIONS} locations. Remove a city first.`);
  const next = existing < 0 ? [...locations, location] : locations.map((item, index) => index === existing ? location : item);
  const current = settings.get('weather.location', preferenceDefaults['weather.location']);
  save(settings, next, options.select !== false || weatherLocationKey(current) === key ? location : current);
}

export function selectWeatherLocation(settings: SettingsService, location: WeatherLocationPreference): void {
  addWeatherLocation(settings, location);
}

export function removeWeatherLocation(settings: SettingsService, key: string): void {
  const locations = getWeatherLocations(settings);
  const index = locations.findIndex(location => weatherLocationKey(location) === key);
  if (index < 0) throw new Error('This location is no longer saved.');
  if (locations.length === 1) throw new Error('Keep at least one saved location.');
  const next = locations.filter((_, at) => at !== index);
  const active = settings.get('weather.location', preferenceDefaults['weather.location']);
  save(settings, next, weatherLocationKey(active) === key ? next[Math.min(index, next.length - 1)] : active);
}

export function reorderWeatherLocations(settings: SettingsService, keys: string[]): void {
  const locations = getWeatherLocations(settings);
  const byKey = new Map(locations.map(location => [weatherLocationKey(location), location]));
  if (keys.length !== locations.length || new Set(keys).size !== keys.length || keys.some(key => !byKey.has(key))) throw new Error('The saved locations changed. Try moving the city again.');
  save(settings, keys.map(key => byKey.get(key)!), settings.get('weather.location', preferenceDefaults['weather.location']));
}
