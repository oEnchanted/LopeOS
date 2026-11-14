import assert from 'node:assert/strict';
import test from 'node:test';
import { PreferenceStore, userPreferenceKey } from '../../packages/sdk/src/preferences.ts';
import { preferenceDefaults, validatePreferenceImport, validPreference, type WeatherLocationPreference } from '../../packages/contracts/src/preferences.ts';
import { addWeatherLocation, getWeatherLocations, MAX_WEATHER_LOCATIONS, removeWeatherLocation, reorderWeatherLocations, selectWeatherLocation, weatherLocationKey } from '../../apps/web/src/apps/weather/locations.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const denver = preferenceDefaults['weather.location'];
const boulder: WeatherLocationPreference = { name: 'Boulder', latitude: 40.015, longitude: -105.2705 };
const paris: WeatherLocationPreference = { name: 'Paris', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' };
const tokyo: WeatherLocationPreference = { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' };
const saved = (preferences: unknown) => JSON.stringify({ version: 2, preferences });

test('saved weather locations reject duplicates, unsafe metadata, empty and oversized lists', () => {
  assert.equal(validPreference('weather.locations', [denver, boulder]), true);
  for (const value of [[], [denver, denver], [denver, { ...denver, latitude: denver.latitude + .000001 }], [{ ...denver, name: '  ' }], [{ ...denver, name: 'city\nname' }], [{ ...denver, latitude: NaN }], [{ ...denver, token: 'secret' }], Array.from({ length: 21 }, (_, index) => ({ name: String(index), latitude: index, longitude: index }))]) {
    assert.equal(validPreference('weather.locations', value), false);
    assert.throws(() => validatePreferenceImport({ version: 2, preferences: { 'weather.locations': value } }));
  }
});

test('legacy weather preferences migrate the selected city instead of injecting the default city', () => {
  const backend = new MemoryStorage();
  backend.setItem('lope.preferences.v2', saved({ 'weather.location': boulder, 'weather.units': 'fahrenheit' }));
  const store = new PreferenceStore(backend);
  assert.deepEqual(getWeatherLocations(store), [boulder]);
  assert.equal(store.getSnapshot()['weather.units'], 'fahrenheit');
  const legacy = new MemoryStorage();
  legacy.setItem('lope.weather.location', JSON.stringify(paris));
  assert.deepEqual(getWeatherLocations(new PreferenceStore(legacy)), [paris]);
  assert.deepEqual(validatePreferenceImport({ version: 2, preferences: { 'weather.location': tokyo } }).values['weather.locations'], [tokyo]);
});

test('city mutations update active selection, order and persistence in one notification', () => {
  const backend = new MemoryStorage(); const store = new PreferenceStore(backend);
  let notifications = 0; store.subscribe(() => { notifications++; });
  const first = getWeatherLocations(store);
  assert.equal(first, getWeatherLocations(store));
  addWeatherLocation(store, boulder);
  assert.equal(notifications, 1);
  assert.deepEqual(getWeatherLocations(store), [denver, boulder]);
  assert.deepEqual(store.getSnapshot()['weather.location'], boulder);
  addWeatherLocation(store, paris, { select: false });
  assert.equal(notifications, 2);
  assert.deepEqual(store.getSnapshot()['weather.location'], boulder);
  reorderWeatherLocations(store, [paris, boulder, denver].map(weatherLocationKey));
  assert.equal(notifications, 3);
  assert.deepEqual(getWeatherLocations(store), [paris, boulder, denver]);
  assert.deepEqual(store.getSnapshot()['weather.location'], boulder);
  removeWeatherLocation(store, weatherLocationKey(boulder));
  assert.equal(notifications, 4);
  assert.deepEqual(store.getSnapshot()['weather.location'], denver);
  selectWeatherLocation(store, paris);
  assert.equal(notifications, 5);
  assert.deepEqual(getWeatherLocations(store), [paris, denver]);
  assert.deepEqual(getWeatherLocations(new PreferenceStore(backend)), [paris, denver]);
  assert.throws(() => reorderWeatherLocations(store, [weatherLocationKey(paris), weatherLocationKey(paris)]), /changed/);
  removeWeatherLocation(store, weatherLocationKey(denver));
  assert.throws(() => removeWeatherLocation(store, weatherLocationKey(paris)), /at least one/);
});

test('legacy active-location writes save new cities and respect the list limit without partial changes', () => {
  const store = new PreferenceStore(new MemoryStorage());
  store.set('weather.location', boulder);
  assert.deepEqual(getWeatherLocations(store), [denver, boulder]);
  store.set('weather.location', { ...boulder, name: 'Boulder, Colorado' });
  assert.equal(getWeatherLocations(store).length, 2);
  assert.equal(getWeatherLocations(store)[1].name, 'Boulder, Colorado');
  const locations = Array.from({ length: MAX_WEATHER_LOCATIONS }, (_, index) => ({ name: `City ${index}`, latitude: index, longitude: index }));
  store.apply({ 'weather.locations': locations, 'weather.location': locations[0] });
  const before = store.getSnapshot();
  assert.throws(() => store.set('weather.location', tokyo), /20 locations/);
  assert.throws(() => addWeatherLocation(store, tokyo), /20 locations/);
  assert.equal(store.getSnapshot(), before);
  store.set('weather.locations', [paris]);
  assert.deepEqual(store.getSnapshot()['weather.location'], paris);
});

test('saved cities are isolated between account records, including legacy account migration', () => {
  const backend = new MemoryStorage();
  backend.setItem(userPreferenceKey('alice'), saved({ 'weather.location': paris }));
  backend.setItem(userPreferenceKey('bob'), saved({ 'weather.location': boulder }));
  const store = new PreferenceStore(backend);
  store.activateUser('alice');
  assert.deepEqual(getWeatherLocations(store), [paris]);
  addWeatherLocation(store, tokyo);
  store.activateUser('bob');
  assert.deepEqual(getWeatherLocations(store), [boulder]);
  addWeatherLocation(store, denver);
  store.activateUser('alice');
  assert.deepEqual(getWeatherLocations(store), [paris, tokyo]);
  assert.deepEqual(store.getSnapshot()['weather.location'], tokyo);
  store.activateUser('bob');
  assert.deepEqual(getWeatherLocations(store), [boulder, denver]);
  assert.deepEqual(store.getSnapshot()['weather.location'], denver);
});

test('the account import path restores saved city order, selection and units on another device', () => {
  const source = new PreferenceStore(new MemoryStorage());
  source.activateUser('alice');
  addWeatherLocation(source, paris); addWeatherLocation(source, tokyo);
  reorderWeatherLocations(source, [tokyo, denver, paris].map(weatherLocationKey));
  source.set('weather.units', 'fahrenheit');
  const remoteRecord = JSON.parse(JSON.stringify({ version: 2, preferences: source.getSnapshot() }));
  const backend = new MemoryStorage(); const destination = new PreferenceStore(backend);
  destination.activateUser('alice');
  destination.apply(validatePreferenceImport(remoteRecord).values);
  assert.deepEqual(getWeatherLocations(destination), [tokyo, denver, paris]);
  assert.deepEqual(destination.getSnapshot()['weather.location'], tokyo);
  assert.equal(destination.getSnapshot()['weather.units'], 'fahrenheit');
  const reopened = new PreferenceStore(backend); reopened.activateUser('alice');
  assert.deepEqual(getWeatherLocations(reopened), [tokyo, denver, paris]);
  destination.apply(validatePreferenceImport({ version: 2, preferences: { 'weather.location': boulder } }).values);
  assert.deepEqual(getWeatherLocations(destination), [boulder]);
  assert.throws(() => validatePreferenceImport({ version: 2, preferences: { 'weather.location': tokyo, 'weather.locations': [paris] } }), /active weather location/);
});

test('legacy settings adapters receive a stable fallback city list without writes on read', () => {
  const values = new Map<string, unknown>([['weather.location', boulder]]);
  let writes = 0;
  const settings = { get<T>(key: string, fallback: T): T { return values.has(key) ? values.get(key) as T : fallback; }, set<T>(key: string, value: T) { writes++; values.set(key, value); }, subscribe() { return () => {}; } };
  const first = getWeatherLocations(settings);
  assert.deepEqual(first, [boulder]);
  assert.equal(first, getWeatherLocations(settings));
  assert.equal(writes, 0);
  addWeatherLocation(settings, paris);
  assert.deepEqual(getWeatherLocations(settings), [boulder, paris]);
  assert.deepEqual(values.get('weather.location'), paris);
});
