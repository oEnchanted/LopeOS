import { useSyncExternalStore } from 'react';
import type { SettingsService } from '../../contracts/src';
import { preferenceDefaults, preferenceSchema, validPreference, validatePreferenceImport, SETTINGS_VERSION, MAX_WEATHER_LOCATIONS, weatherLocationKey, type PreferenceKey, type Preferences } from '../../contracts/src/preferences.ts';
import { PROFILE_PICTURE_KEY, PROFILE_STORAGE_KEY, isProfilePicture } from '../../contracts/src/profile.ts';
export { preferenceSchema, preferenceDefaults, validatePreferenceImport, SETTINGS_VERSION };
export type { PreferenceKey, Preferences };
const PREFS = 'lope.preferences.v2', APPS = 'lope.preferences.apps.v1', HISTORY = 'lope.history.apps.v1', DOCUMENTS = 'lope.session.documents.v1', ASSETS = 'lope.assets.wallpapers.v1';
type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const secret = /token|password|secret|credential|authorization|api.?key|access.?key|private.?key|(^|[._-])auth([._-]|$)/i;
const alias = (key: string) => key === 'reducedTransparency' ? 'reduceTransparency' : key;
export const userPreferenceKey = (id: string) => `lope.preferences.user.${encodeURIComponent(id)}.v2`;
export class PreferenceStore implements SettingsService {
  private values: Preferences = { ...preferenceDefaults };
  private systemValues: Preferences = { ...preferenceDefaults };
  private activeUser: string | null = null;
  private namespaces = new Map<string, Record<string, unknown>>();
  private listeners = new Set<() => void>();
  private status = { persistent: true, message: '' };
  private backend?: Backend;
  constructor(backend?: Backend) {
    this.backend = backend;
    if (!backend) this.status = { persistent: false, message: 'Browser storage is unavailable. Preferences apply for this session only.' };
    try {
      const saved = backend?.getItem(PREFS);
      if (saved) { const parsed = validatePreferenceImport(JSON.parse(saved)); this.values = { ...preferenceDefaults, ...parsed.values }; }
      else {
        for (const [key, spec] of Object.entries(preferenceSchema)) {
          const raw = backend?.getItem('lope.' + key) ?? (key === 'reduceTransparency' ? backend?.getItem('lope.reducedTransparency') : null);
          if (raw == null) continue;
          let value; try { value = JSON.parse(raw); } catch { value = raw; }
          if (spec.valid(value)) (this.values as Record<string, unknown>)[key] = value;
        }
        if (!backend?.getItem('lope.weather.locations')) this.values = { ...this.values, 'weather.locations': [this.values['weather.location']] };
        else if (!this.values['weather.locations'].some(location => weatherLocationKey(location) === weatherLocationKey(this.values['weather.location']))) this.values = { ...this.values, 'weather.location': this.values['weather.locations'][0] };
      }
      // Restore the temporary original-art fallback once bundling was authorized.
      // Keep uploads and later, deliberate gallery choices unchanged.
      if (backend && !backend.getItem('lope.migration.perfecthue.v1')) {
        if (this.values.wallpaper === 'aurora') this.values = { ...this.values, wallpaper: 'perfecthue-light' };
        if (this.values.wallpaper === 'night') this.values = { ...this.values, wallpaper: 'perfecthue-dark' };
        backend.setItem(PREFS, JSON.stringify({ version: SETTINGS_VERSION, preferences: this.values }));
        backend.setItem('lope.migration.perfecthue.v1', '1');
      }
      if (backend && !backend.getItem('lope.migration.photo-studio.v1')) {
        if (!this.values.pinned.includes('lope.lightroom')) this.values = { ...this.values, pinned: [...this.values.pinned, 'lope.lightroom'] };
        backend.setItem(PREFS, JSON.stringify({ version: SETTINGS_VERSION, preferences: this.values }));
        backend.setItem('lope.migration.photo-studio.v1', '1');
      }
    } catch { this.status = { persistent: false, message: 'Browser storage is unavailable or contains an unreadable preference file. Changes will apply for this session.' }; }
    this.systemValues = this.values;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.values;
  getStatus = () => this.status;
  getActiveUser = () => this.activeUser;
  private preferenceKey() { return this.activeUser ? userPreferenceKey(this.activeUser) : PREFS; }
  private savePreferences() {
    if (!this.activeUser) this.systemValues = this.values;
    this.persist(this.preferenceKey(), { version: SETTINGS_VERSION, preferences: this.values });
  }
  private updatedPreferences(patch: Partial<Preferences>): Preferences {
    const next = { ...this.values, ...patch };
    if (Object.hasOwn(patch, 'weather.location')) {
      const selected = next['weather.location'];
      const locations = next['weather.locations'];
      const key = weatherLocationKey(selected);
      if (locations.some(location => weatherLocationKey(location) === key)) next['weather.locations'] = locations.map(location => weatherLocationKey(location) === key ? selected : location);
      else {
        if (Object.hasOwn(patch, 'weather.locations')) throw new Error('The active weather location must be in the saved locations.');
        if (locations.length >= MAX_WEATHER_LOCATIONS) throw new Error(`You can save up to ${MAX_WEATHER_LOCATIONS} locations. Remove a city first.`);
        next['weather.locations'] = [...locations, selected];
      }
    } else if (Object.hasOwn(patch, 'weather.locations')) {
      next['weather.location'] = next['weather.locations'].find(location => weatherLocationKey(location) === weatherLocationKey(next['weather.location'])) || next['weather.locations'][0];
    }
    return next;
  }
  /** Switches the shared settings service between setup defaults and a local account. */
  activateUser(id: string | null) {
    this.activeUser = id;
    this.values = this.systemValues;
    try {
      const system = this.backend?.getItem(PREFS);
      if (system) this.systemValues = { ...preferenceDefaults, ...validatePreferenceImport(JSON.parse(system)).values };
      this.values = this.systemValues;
      const own = id ? this.backend?.getItem(userPreferenceKey(id)) : null;
      if (own) this.values = { ...this.systemValues, ...validatePreferenceImport(JSON.parse(own)).values };
    } catch { this.status = { persistent: false, message: 'Saved preferences could not be read. System defaults are active for this session.' }; }
    this.namespaces.clear();
    this.emit();
  }
  /** Setup must know whether both writes succeeded, unlike best-effort live previews. */
  copyToUser(id: string) {
    if (!id) throw new Error('An account is required to save preferences.');
    try {
      if (!this.backend) throw new Error('Browser storage is unavailable.');
      const document = JSON.stringify({ version: SETTINGS_VERSION, preferences: this.values });
      this.backend.setItem(PREFS, document);
      this.systemValues = this.values;
      this.backend.setItem(userPreferenceKey(id), document);
      this.status = { persistent: true, message: '' };
    } catch {
      this.status = { persistent: false, message: 'Setup preferences could not be saved in this browser.' };
      this.emit();
      throw new Error(this.status.message);
    }
    this.emit();
  }
  private emit() { this.listeners.forEach(listener => listener()); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lope:preferences-updated')); }
  private persist(key: string, value: unknown) {
    try { if (!this.backend) throw new Error(); this.backend.setItem(key, JSON.stringify(value)); this.status = { persistent: true, message: '' }; }
    catch { this.status = { persistent: false, message: 'Changes are active for this session, but could not be saved in this browser. Free some browser storage and retry before closing LopeOS.' }; }
  }
  private namespace(key: string) { return key === PROFILE_PICTURE_KEY ? PROFILE_STORAGE_KEY : key === 'personalWallpaper' ? ASSETS : /(^|\.)(history|recent)$/.test(key) ? HISTORY : /\.document\./.test(key) ? DOCUMENTS : APPS; }
  private readNamespace(name: string) {
    if (!this.namespaces.has(name)) { let data = {}; try { const raw = this.backend?.getItem(name); if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed; } } catch {} this.namespaces.set(name, data); }
    return this.namespaces.get(name)!;
  }
  get<T>(rawKey: string, fallback: T): T {
    const key = alias(rawKey);
    if (Object.hasOwn(preferenceSchema, key)) return this.values[key as PreferenceKey] as T;
    if (secret.test(key) || ['__proto__','constructor','prototype'].includes(key)) return fallback;
    const namespace = this.namespace(key); const data = this.readNamespace(namespace);
    if (Object.hasOwn(data, key)) return data[key] as T;
    try { const raw = this.backend?.getItem('lope.' + key); if (raw != null) { let value; try { value = JSON.parse(raw); } catch { value = raw; } data[key] = value; this.persist(namespace, data); return value as T; } } catch {}
    return fallback;
  }
  set<T>(rawKey: string, value: T) {
    const key = alias(rawKey);
    if (key === PROFILE_PICTURE_KEY && value !== null && !isProfilePicture(value)) throw new Error('Choose a valid profile picture.');
    if (Object.hasOwn(preferenceSchema, key)) {
      if (!validPreference(key, value)) throw new Error('Invalid preference: ' + key);
      this.values = this.updatedPreferences({ [key]: value }); this.savePreferences();
    } else {
      if (!/^[a-z0-9][a-z0-9._-]{0,160}$/i.test(key) || secret.test(key) || ['__proto__','constructor','prototype'].includes(key)) throw new Error('This key cannot be stored in preferences.');
      const namespace = this.namespace(key); const data = { ...this.readNamespace(namespace), [key]: value }; this.namespaces.set(namespace, data); this.persist(namespace, data);
    }
    this.emit();
  }
  apply(values: Partial<Preferences>) {
    for (const [key, value] of Object.entries(values)) if (!validPreference(key, value)) throw new Error('Invalid preference: ' + key);
    this.values = this.updatedPreferences(values); this.savePreferences(); this.emit();
  }
  reset() { this.values = { ...preferenceDefaults }; this.savePreferences(); this.emit(); }
  /** Forget the erased account and cached app data without writing old values back. */
  resetForSetup() {
    this.activeUser = null;
    this.namespaces.clear();
    this.systemValues = { ...preferenceDefaults };
    this.values = this.systemValues;
    this.status = this.backend ? { persistent: true, message: '' }
      : { persistent: false, message: 'Browser storage is unavailable. Preferences apply for this session only.' };
    this.emit();
  }
  export() { return { application: 'LopeOS', version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), preferences: this.values }; }
  clearAppHistory() { this.namespaces.set(HISTORY, {}); this.persist(HISTORY, {}); for (const key of ['calculator.history','writer.recent']) try { this.backend?.removeItem('lope.' + key); } catch {} this.emit(); }
  removePersonalWallpaper() { this.namespaces.set(ASSETS, {}); this.persist(ASSETS, {}); try { this.backend?.removeItem('lope.personalWallpaper'); } catch {} this.set('wallpaper', preferenceDefaults.wallpaper); }
  refresh() { this.activateUser(this.activeUser); }
}
let backend: Storage | undefined; try { backend = globalThis.localStorage; } catch {}
export const preferences = new PreferenceStore(backend);
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key?.startsWith('lope.')) preferences.refresh(); });
export const usePreferences = () => useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
export const usePreferenceStatus = () => useSyncExternalStore(preferences.subscribe, preferences.getStatus, preferences.getStatus);
export function downloadJSON(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
