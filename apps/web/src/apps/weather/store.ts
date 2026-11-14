import { createOpenMeteoProvider, DEFAULT_LOCATION, validLocation, type WeatherData, type WeatherLocation, type WeatherProvider, type WeatherUnits } from './provider.ts';
import { MAX_WEATHER_LOCATIONS } from '../../../../../packages/contracts/src/preferences.ts';

export interface WeatherSnapshot { status: 'idle' | 'loading' | 'ready' | 'error' | 'offline'; data: WeatherData | null; error: string | null; notice: string | null; location: WeatherLocation; units: WeatherUnits; refreshing: boolean }
type CityState = Pick<WeatherSnapshot, 'status' | 'data' | 'error' | 'notice' | 'refreshing'>;
const TTL = 15 * 60_000;
const COOLDOWN = 60_000;
// Keep both unit variants of a full sidebar, plus a few recently removed cities.
const CACHE_CAPACITY = MAX_WEATHER_LOCATIONS * 2 + 4;
const OFFLINE_MESSAGE = 'You are offline. Cached conditions may be out of date.';
const CLEARED_MESSAGE = 'Weather cache cleared. Choose Refresh for new conditions.';
const keyFor = (location: WeatherLocation, units: WeatherUnits) => `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)},${units}`;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export class WeatherStore {
  private listeners = new Set<() => void>();
  private cityListeners = new Set<() => void>();
  private cache = new Map<string, WeatherData>();
  private cityStates = new Map<string, CityState>();
  private cityViews = new Map<string, { key: string; source: CityState; snapshot: WeatherSnapshot }>();
  private pending = new Map<string, Promise<void>>();
  private lastRequest = new Map<string, number>();
  private failures = new Map<string, number>();
  private provider: WeatherProvider;
  private now: () => number;
  private users = 0;
  private autoRefresh = true;
  private timer?: ReturnType<typeof setInterval>;
  private cacheGeneration = 0;
  private snapshot: WeatherSnapshot = { status: 'idle', data: null, error: null, notice: null, location: DEFAULT_LOCATION, units: 'celsius', refreshing: false };
  constructor(provider: WeatherProvider = createOpenMeteoProvider(), now = Date.now) { this.provider = provider; this.now = now; }
  setAutoRefresh(enabled: boolean) { this.autoRefresh = enabled; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeCities = (listener: () => void) => { this.cityListeners.add(listener); return () => { this.cityListeners.delete(listener); }; };
  private emit(patch: Partial<WeatherSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }

  private cityState(key: string): CityState {
    let state = this.cityStates.get(key);
    if (!state) {
      const data = this.cache.get(key) || null;
      state = { data, status: data ? 'ready' : 'idle', error: null, notice: null, refreshing: false };
      this.cityStates.set(key, state);
    }
    return state;
  }
  private cityView(state: CityState, location: WeatherLocation, units: WeatherUnits): WeatherSnapshot {
    return { ...state, location, units, data: state.data ? { ...state.data, location } : null };
  }
  /** Stable snapshots let independently mounted city cards use useSyncExternalStore. */
  getCitySnapshot = (location: WeatherLocation, units: WeatherUnits): WeatherSnapshot => {
    const key = keyFor(location, units);
    const source = this.cityState(key);
    // Two labels for the same coordinates share a request but retain their own names.
    const viewKey = JSON.stringify([location.latitude, location.longitude, units, location.name, location.country, location.timezone]);
    let view = this.cityViews.get(viewKey);
    if (!view || view.source !== source) {
      view = { key, source, snapshot: this.cityView(source, location, units) };
      this.cityViews.set(viewKey, view);
    }
    return view.snapshot;
  };
  private updateCity(key: string, patch: Partial<CityState>) {
    const previous = this.cityState(key);
    if (Object.entries(patch).every(([name, value]) => previous[name as keyof CityState] === value)) return;
    const next = { ...previous, ...patch };
    this.cityStates.set(key, next);
    for (const [viewKey, view] of this.cityViews) if (view.key === key) this.cityViews.delete(viewKey);
    // No captured location can overwrite a selection made while the request runs.
    if (key === keyFor(this.snapshot.location, this.snapshot.units)) {
      this.emit(this.cityView(next, this.snapshot.location, this.snapshot.units));
    }
    this.cityListeners.forEach(listener => listener());
  }
  configure(location: WeatherLocation, units: WeatherUnits) {
    if (!validLocation(location)) return;
    const current = this.snapshot.location;
    const same = keyFor(location, units) === keyFor(current, this.snapshot.units);
    if (same && current.name === location.name && current.country === location.country && current.timezone === location.timezone) return;
    this.emit(this.cityView(this.cityState(keyFor(location, units)), location, units));
    if (this.users) void this.refresh();
  }
  retain = () => {
    if (++this.users === 1) {
      void this.refresh();
      this.timer = setInterval(() => { if (this.autoRefresh && (typeof document === 'undefined' || !document.hidden)) void this.refresh(); }, TTL);
      if (typeof window !== 'undefined') { window.addEventListener('online', this.online); window.addEventListener('offline', this.offline); }
    }
    let released = false;
    return () => {
      if (released) return; released = true;
      if (--this.users === 0) {
        clearInterval(this.timer);
        if (typeof window !== 'undefined') { window.removeEventListener('online', this.online); window.removeEventListener('offline', this.offline); }
      }
    };
  };
  private online = () => { if (this.autoRefresh) void this.refresh(); };
  private offline = () => {
    this.cityState(keyFor(this.snapshot.location, this.snapshot.units));
    for (const key of this.cityStates.keys()) this.updateCity(key, { status: 'offline', error: OFFLINE_MESSAGE, refreshing: false });
  };
  search(query: string, signal?: AbortSignal) { return this.provider.search(query, signal); }
  clearCache() {
    this.cache.clear(); this.pending.clear(); this.cityStates.clear(); this.cityViews.clear(); this.cacheGeneration++;
    this.updateCity(keyFor(this.snapshot.location, this.snapshot.units), { notice: CLEARED_MESSAGE });
    // Keep request cooldown/backoff when clearing data so provider limits still apply.
  }
  refresh(force = false): Promise<void> {
    return this.refreshCity(this.snapshot.location, this.snapshot.units, force);
  }
  /** Refresh a sidebar city through the same cache, pending request and retry budget. */
  refreshCity(location: WeatherLocation, units: WeatherUnits, force = false): Promise<void> {
    if (!validLocation(location)) return Promise.resolve();
    const key = keyFor(location, units);
    const cached = this.cache.get(key) || null;
    if (isOffline()) {
      this.updateCity(key, { data: cached, status: 'offline', error: OFFLINE_MESSAGE, refreshing: false });
      return Promise.resolve();
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (cached && !force && this.now() - cached.fetchedAt < TTL) {
      this.updateCity(key, { status: 'ready', data: cached, refreshing: false, error: null, notice: null });
      return Promise.resolve();
    }
    const backoff = Math.min(TTL, COOLDOWN * 2 ** (this.failures.get(key) || 0));
    if (this.now() - (this.lastRequest.get(key) ?? -Infinity) < backoff) {
      if (force) this.updateCity(key, { notice: `Please wait until ${new Date(this.lastRequest.get(key)! + backoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })} before refreshing again.` });
      return Promise.resolve();
    }
    this.lastRequest.set(key, this.now());
    const cacheGeneration = this.cacheGeneration;
    let forecast: Promise<WeatherData>;
    try { forecast = this.provider.forecast(location, units); }
    catch (error) { forecast = Promise.reject(error); }
    let request!: Promise<void>;
    request = (async () => {
      try {
        const data = await forecast;
        if (cacheGeneration !== this.cacheGeneration) return;
        this.cache.set(key, data); this.failures.delete(key);
        this.updateCity(key, { data, status: isOffline() ? 'offline' : 'ready', error: isOffline() ? OFFLINE_MESSAGE : null, notice: null, refreshing: false });
        while (this.cache.size > CACHE_CAPACITY) {
          const activeKey = keyFor(this.snapshot.location, this.snapshot.units);
          const oldest = [...this.cache.keys()].find(candidate => candidate !== activeKey)!;
          this.cache.delete(oldest);
          this.updateCity(oldest, { data: null, status: 'idle', error: null, notice: null, refreshing: false });
        }
      } catch (error) {
        if (cacheGeneration !== this.cacheGeneration) return;
        // Count one provider failure, even when the active view and several cards await it.
        this.failures.set(key, (this.failures.get(key) || 0) + 1);
        this.updateCity(key, { status: isOffline() ? 'offline' : 'error', error: isOffline() ? OFFLINE_MESSAGE : error instanceof Error ? error.message : 'Weather could not be loaded.', refreshing: false });
      } finally { if (this.pending.get(key) === request) this.pending.delete(key); }
    })();
    this.pending.set(key, request);
    this.updateCity(key, { status: cached ? 'ready' : 'loading', data: cached, error: null, notice: null, refreshing: true });
    return request;
  }
}
/** Imported by Weather, its city cards and the menu-bar widget to share all requests/data. */
export const weatherStore = new WeatherStore();
