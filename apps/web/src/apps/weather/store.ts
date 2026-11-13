import { createOpenMeteoProvider, DEFAULT_LOCATION, validLocation, type WeatherData, type WeatherLocation, type WeatherProvider, type WeatherUnits } from './provider';

export interface WeatherSnapshot { status: 'idle' | 'loading' | 'ready' | 'error' | 'offline'; data: WeatherData | null; error: string | null; notice: string | null; location: WeatherLocation; units: WeatherUnits; refreshing: boolean }
const TTL = 15 * 60_000;
const COOLDOWN = 60_000;
const keyFor = (location: WeatherLocation, units: WeatherUnits) => `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)},${units}`;

export class WeatherStore {
  private listeners = new Set<() => void>();
  private cache = new Map<string, WeatherData>();
  private pending = new Map<string, Promise<WeatherData>>();
  private lastRequest = new Map<string, number>();
  private failures = new Map<string, number>();
  private users = 0;
  private autoRefresh = true;
  setAutoRefresh(enabled: boolean) { this.autoRefresh = enabled; }
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private cacheGeneration = 0;
  private snapshot: WeatherSnapshot = { status: 'idle', data: null, error: null, notice: null, location: DEFAULT_LOCATION, units: 'celsius', refreshing: false };
  constructor(private provider: WeatherProvider = createOpenMeteoProvider(), private now = Date.now) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<WeatherSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  configure(location: WeatherLocation, units: WeatherUnits) {
    if (!validLocation(location)) return;
    const same = keyFor(location, units) === keyFor(this.snapshot.location, this.snapshot.units);
    if (same && this.snapshot.location.name === location.name) return;
    this.generation++;
    const data = this.cache.get(keyFor(location, units)) || null;
    this.emit({ location, units, data, status: data ? 'ready' : 'idle', error: null, notice: null, refreshing: false });
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
  private offline = () => { this.emit({ status: 'offline', error: 'You are offline. Cached conditions may be out of date.', refreshing: false }); };
  search(query: string, signal?: AbortSignal) { return this.provider.search(query, signal); }
  clearCache() {
    this.cache.clear(); this.pending.clear(); this.cacheGeneration++; this.generation++;
    this.emit({ data: null, status: 'idle', error: null, notice: 'Weather cache cleared. Choose Refresh for new conditions.', refreshing: false });
    // Keep request cooldown/backoff when clearing data so provider limits still apply.
  }
  async refresh(force = false): Promise<void> {
    const { location, units } = this.snapshot;
    const key = keyFor(location, units); const generation = this.generation; const cacheGeneration = this.cacheGeneration;
    const cached = this.cache.get(key);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.offline(); return; }
    if (cached && !force && this.now() - cached.fetchedAt < TTL) { this.emit({ status: 'ready', data: cached, refreshing: false, error: null }); return; }
    let request = this.pending.get(key);
    const backoff = Math.min(TTL, COOLDOWN * 2 ** (this.failures.get(key) || 0));
    if (!request && this.now() - (this.lastRequest.get(key) ?? -Infinity) < backoff) {
      if (force) this.emit({ notice: `Please wait until ${new Date(this.lastRequest.get(key)! + backoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })} before refreshing again.` });
      return;
    }
    this.emit({ status: cached ? 'ready' : 'loading', data: cached || null, error: null, notice: null, refreshing: true });
    if (!request) {
      this.lastRequest.set(key, this.now());
      request = this.provider.forecast(location, units);
      this.pending.set(key, request);
    }
    try {
      const data = await request;
      if (cacheGeneration !== this.cacheGeneration) return;
      this.cache.set(key, data); this.failures.delete(key);
      while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
      if (generation === this.generation) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.emit({ data: { ...data, location }, status: offline ? 'offline' : 'ready', error: offline ? 'You are offline. Cached conditions may be out of date.' : null, refreshing: false });
      }
    } catch (error) {
      this.failures.set(key, (this.failures.get(key) || 0) + 1);
      if (generation === this.generation) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) this.offline();
        else this.emit({ status: 'error', error: error instanceof Error ? error.message : 'Weather could not be loaded.', refreshing: false });
      }
    } finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }
}
/** Imported by both Weather and the menu-bar widget so they share all requests/data. */
export const weatherStore = new WeatherStore();
