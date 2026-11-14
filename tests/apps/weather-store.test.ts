import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOCATION, type WeatherData, type WeatherLocation, type WeatherUnits } from '../../apps/web/src/apps/weather/provider.ts';
import { WeatherStore } from '../../apps/web/src/apps/weather/store.ts';
import { MAX_WEATHER_LOCATIONS } from '../../packages/contracts/src/preferences.ts';

const BOULDER: WeatherLocation = { name: 'Boulder', latitude: 40.015, longitude: -105.2705, timezone: 'America/Denver' };
const NEW_YORK: WeatherLocation = { name: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };
type Request = { location: WeatherLocation; units: WeatherUnits; resolve: (data: WeatherData) => void; reject: (error: Error) => void };

function fixture() {
  let now = 1_000_000;
  const requests: Request[] = [];
  const store = new WeatherStore({
    forecast(location, units) { return new Promise<WeatherData>((resolve, reject) => requests.push({ location, units, resolve, reject })); },
    search: async () => [],
  }, () => now);
  function result(request: Request, temperature = 13): WeatherData {
    return {
      location: request.location, units: request.units, fetchedAt: now, time: '2026-11-13T12:00',
      temperature, feelsLike: temperature - 1, humidity: 45, wind: 8, code: 2, isDay: true,
      forecast: [{ date: '2026-11-13', low: temperature - 5, high: temperature + 3, code: 2, precipitation: 10 }],
    };
  }
  return { store, requests, result, advance(milliseconds: number) { now += milliseconds; } };
}

test('active weather and multiple city cards share one request and stable city snapshots', async () => {
  const { store, requests, result } = fixture();
  const idle = store.getCitySnapshot(DEFAULT_LOCATION, 'celsius');
  assert.equal(idle.status, 'idle');
  assert.strictEqual(store.getCitySnapshot({ ...DEFAULT_LOCATION }, 'celsius'), idle);
  let notifications = 0;
  const unsubscribe = store.subscribeCities(() => notifications++);
  const active = store.refresh();
  const firstCard = store.refreshCity(DEFAULT_LOCATION, 'celsius');
  const secondCard = store.refreshCity({ ...DEFAULT_LOCATION }, 'celsius');
  assert.strictEqual(active, firstCard);
  assert.strictEqual(firstCard, secondCard);
  assert.equal(requests.length, 1);
  assert.equal(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius').refreshing, true);
  requests[0].resolve(result(requests[0]));
  await Promise.all([active, firstCard, secondCard]);
  const ready = store.getCitySnapshot(DEFAULT_LOCATION, 'celsius');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.data?.temperature, 13);
  assert.equal(store.getSnapshot().data?.temperature, 13);
  assert.notStrictEqual(ready, idle);
  await store.refreshCity(DEFAULT_LOCATION, 'celsius');
  await store.refresh();
  assert.equal(requests.length, 1);
  assert.strictEqual(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius'), ready);
  assert.equal(notifications, 2);
  unsubscribe();
});

test('sidebar responses never select a city or replace a newer active location', async () => {
  const { store, requests, result } = fixture();
  const denver = store.refresh();
  const boulder = store.refreshCity(BOULDER, 'celsius');
  assert.equal(store.getSnapshot().location.name, 'Denver');
  store.configure(NEW_YORK, 'celsius');
  const newYork = store.refresh();
  requests[2].resolve(result(requests[2], 21));
  await newYork;
  const selected = store.getSnapshot();
  requests[1].resolve(result(requests[1], 8));
  requests[0].resolve(result(requests[0], 13));
  await Promise.all([denver, boulder]);
  assert.strictEqual(store.getSnapshot(), selected);
  assert.equal(store.getSnapshot().location.name, 'New York');
  assert.equal(store.getSnapshot().data?.temperature, 21);
  assert.equal(store.getCitySnapshot(BOULDER, 'celsius').data?.temperature, 8);
  assert.equal(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius').data?.temperature, 13);
  store.configure(BOULDER, 'celsius');
  await store.refresh();
  assert.equal(requests.length, 3);
  assert.equal(store.getSnapshot().data?.temperature, 8);
});

test('units and city aliases share only compatible requests without stale active metadata', async () => {
  const { store, requests, result } = fixture();
  const alias = { ...DEFAULT_LOCATION, name: 'Home' };
  const celsius = store.refreshCity(alias, 'celsius');
  const original = store.refresh();
  assert.equal(requests.length, 1);
  store.configure(DEFAULT_LOCATION, 'fahrenheit');
  const fahrenheit = store.refresh();
  assert.equal(requests.length, 2);
  requests[1].resolve(result(requests[1], 55));
  await fahrenheit;
  requests[0].resolve(result(requests[0], 13));
  await Promise.all([celsius, original]);
  assert.equal(store.getSnapshot().units, 'fahrenheit');
  assert.equal(store.getSnapshot().data?.temperature, 55);
  const named = store.getCitySnapshot(alias, 'celsius');
  const originalName = store.getCitySnapshot(DEFAULT_LOCATION, 'celsius');
  assert.equal(named.location.name, 'Home');
  assert.equal(named.data?.location.name, 'Home');
  assert.equal(originalName.data?.location.name, 'Denver');
  assert.strictEqual(store.getCitySnapshot(alias, 'celsius'), named);
  assert.strictEqual(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius'), originalName);
});

test('clearing cache invalidates all city snapshots and ignores pending success and failure', async () => {
  const { store, requests, result, advance } = fixture();
  const denver = store.refresh();
  requests[0].resolve(result(requests[0]));
  await denver;
  const previousCity = store.getCitySnapshot(DEFAULT_LOCATION, 'celsius');
  const boulder = store.refreshCity(BOULDER, 'celsius');
  const newYork = store.refreshCity(NEW_YORK, 'celsius');
  let changes = 0;
  store.subscribeCities(() => changes++);
  store.clearCache();
  assert.equal(changes, 1);
  assert.equal(store.getSnapshot().data, null);
  assert.equal(store.getSnapshot().status, 'idle');
  assert.notStrictEqual(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius'), previousCity);
  assert.equal(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius').data, null);
  assert.equal(store.getCitySnapshot(BOULDER, 'celsius').refreshing, false);
  requests[1].resolve(result(requests[1], 8));
  requests[2].reject(new Error('A discarded failure'));
  await Promise.all([boulder, newYork]);
  assert.equal(store.getCitySnapshot(BOULDER, 'celsius').data, null);
  assert.equal(store.getCitySnapshot(NEW_YORK, 'celsius').error, null);
  await store.refreshCity(BOULDER, 'celsius', true);
  assert.equal(requests.length, 3);
  advance(60_001);
  const retry = store.refreshCity(NEW_YORK, 'celsius', true);
  assert.equal(requests.length, 4, 'Discarded failures must not double the remaining cooldown.');
  requests[3].resolve(result(requests[3], 19));
  await retry;
  assert.equal(store.getCitySnapshot(NEW_YORK, 'celsius').data?.temperature, 19);
});

test('one failed shared request incurs one backoff and retains cached conditions', async () => {
  const { store, requests, result, advance } = fixture();
  const initial = store.refresh();
  requests[0].resolve(result(requests[0]));
  await initial;
  advance(16 * 60_000);
  const active = store.refresh();
  const card = store.refreshCity(DEFAULT_LOCATION, 'celsius', true);
  const anotherCard = store.refreshCity(DEFAULT_LOCATION, 'celsius');
  requests[1].reject(new Error('Provider unavailable'));
  await Promise.all([active, card, anotherCard]);
  assert.equal(requests.length, 2);
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().data?.temperature, 13);
  assert.equal(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius').error, 'Provider unavailable');
  advance(119_999);
  await store.refreshCity(DEFAULT_LOCATION, 'celsius', true);
  assert.equal(requests.length, 2);
  advance(2);
  const retry = store.refresh();
  assert.equal(requests.length, 3, 'Two waiting cards must not count the same failure twice.');
  requests[2].resolve(result(requests[2], 15));
  await retry;
  assert.equal(store.getSnapshot().data?.temperature, 15);
  assert.equal(store.getCitySnapshot(DEFAULT_LOCATION, 'celsius').error, null);
});

test('offline city refresh keeps cached data without starting a provider request', async () => {
  const { store, requests, result } = fixture();
  const initial = store.refreshCity(BOULDER, 'celsius');
  requests[0].resolve(result(requests[0], 8));
  await initial;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    await store.refreshCity(BOULDER, 'celsius', true);
    assert.equal(requests.length, 1);
    const offline = store.getCitySnapshot(BOULDER, 'celsius');
    assert.equal(offline.status, 'offline');
    assert.equal(offline.data?.temperature, 8);
    assert.equal(offline.refreshing, false);
    assert.equal(store.getSnapshot().location.name, 'Denver');
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('a full saved-city list keeps both unit variants available during request cooldown', async () => {
  const { store, requests, result } = fixture();
  const locations = Array.from({ length: MAX_WEATHER_LOCATIONS }, (_, index) => index === 0 ? DEFAULT_LOCATION : {
    ...DEFAULT_LOCATION, name: `City ${index}`, latitude: DEFAULT_LOCATION.latitude + index / 1000,
  });
  for (const units of ['celsius', 'fahrenheit'] as const) {
    store.configure(DEFAULT_LOCATION, units);
    for (const location of locations) {
      const pending = store.refreshCity(location, units);
      const request = requests.at(-1)!;
      request.resolve(result(request, units === 'celsius' ? 13 : 55));
      await pending;
    }
  }
  assert.equal(requests.length, MAX_WEATHER_LOCATIONS * 2);
  // No time advances: an evicted entry cannot be refetched because cooldown is active.
  for (const units of ['celsius', 'fahrenheit'] as const) {
    store.configure(DEFAULT_LOCATION, units);
    for (const location of locations) {
      const city = store.getCitySnapshot(location, units);
      assert.equal(city.status, 'ready', `${location.name} ${units} should remain cached.`);
      assert.equal(city.data?.temperature, units === 'celsius' ? 13 : 55);
      await store.refreshCity(location, units);
      assert.strictEqual(store.getCitySnapshot(location, units), city);
    }
    assert.equal(store.getSnapshot().data?.temperature, units === 'celsius' ? 13 : 55);
  }
  assert.equal(requests.length, MAX_WEATHER_LOCATIONS * 2);
});
