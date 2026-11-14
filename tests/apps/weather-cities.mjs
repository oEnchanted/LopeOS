/** Saved-city UI and real encrypted account sync; all accounts/data are temporary. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { createAccountServer } from '../../services/accounts/server.mjs';
import { seedSession } from '../setup/seed-session.mjs';

const directory = await mkdtemp(join(tmpdir(), 'lope-weather-cities-'));
const output = process.env.WEATHER_CITIES_OUTPUT || join(tmpdir(), 'lope-weather-cities-qa');
const port = Number(process.env.WEATHER_CITIES_PORT || 5213);
const origin = `http://127.0.0.1:${port}`;
const locations = [
  { name: 'Denver', latitude: 39.7392, longitude: -104.9903, country: 'United States', timezone: 'America/Denver' },
  { name: 'Boulder', latitude: 40.015, longitude: -105.2705, country: 'United States', timezone: 'America/Denver' },
  { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, country: 'Japan', timezone: 'Asia/Tokyo' },
  { name: 'Paris', latitude: 48.8566, longitude: 2.3522, country: 'France', timezone: 'Europe/Paris' },
];
const checks = [], errors = [], screenshots = [];
let accounts, vite, browser;
const pass = message => { checks.push(message); console.log(`PASS ${message}`); };

function forecast(url) {
  const fahrenheit = url.searchParams.get('temperature_unit') === 'fahrenheit';
  const temp = value => fahrenheit ? value * 1.8 + 32 : value;
  const night = Number(url.searchParams.get('longitude')) > 100;
  const dates = Array.from({ length: 10 }, (_, i) => `2026-11-${13 + i}`);
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-${13 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
  return {
    timezone: night ? 'Asia/Tokyo' : 'America/Denver', utc_offset_seconds: night ? 32400 : -25200,
    current: { time: `2026-11-13T${night ? '21' : '11'}:15`, temperature_2m: temp(night ? 9 : 13), apparent_temperature: temp(11), relative_humidity_2m: 45, wind_speed_10m: 13, wind_direction_10m: 235, wind_gusts_10m: 24, weather_code: night ? 0 : 2, is_day: night ? 0 : 1, visibility: 24000, uv_index: night ? 0 : 3.5 },
    daily: { time: dates, temperature_2m_min: [4, 5, 8, 7, 4, 2, 3, 1, 2, 5].map(temp), temperature_2m_max: [17, 19, 22, 16, 15, 10, 12, 9, 14, 17].map(temp), weather_code: [2, 0, 2, 61, 3, 71, 2, 3, 0, 2], precipitation_probability_max: [10, 0, 15, 75, 20, 65, 20, 10, 5, 0], sunrise: dates.map(day => `${day}T06:42`), sunset: dates.map(day => `${day}T16:47`) },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => temp(10 + i % 8)), weather_code: hours.map(() => 2), is_day: hours.map((_, i) => i % 24 > 6 && i % 24 < 18 ? 1 : 0), precipitation_probability: hours.map(() => 10) },
  };
}

async function routes(page, realAccounts = false) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (realAccounts && path.startsWith('/api/accounts/')) return route.continue();
    const body = path === '/api/accounts/session' ? { account: null, quotaBytes: 1_000_000_000, usedBytes: 0 } : path === '/api/identity' ? { userId: 'weather-cities-test', workspaceId: 'weather-cities-test' } : { error: { code: 'UNAVAILABLE', message: 'Workspace intentionally offline in Weather test.' } };
    return route.fulfill({ status: path === '/api/accounts/session' || path === '/api/identity' ? 200 : 503, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast(new URL(route.request().url()))) }));
  await page.route('https://geocoding-api.open-meteo.com/**', route => {
    const query = new URL(route.request().url()).searchParams.get('name')?.toLowerCase() || '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: locations.filter(city => city.name.toLowerCase().includes(query)) }) });
  });
}

async function weatherPreferences(page) {
  return page.evaluate(async () => {
    const { preferences } = await import('/packages/sdk/src/preferences.ts');
    return { cities: preferences.get('weather.locations', []).map(city => city.name), active: preferences.get('weather.location', null)?.name, units: preferences.get('weather.units', '') };
  });
}

async function launchWeather(page) {
  const existing = page.getByTestId('weather-app');
  if (await existing.isVisible()) return existing;
  const dock = page.getByRole('button', { name: 'Open Weather', exact: true });
  if (await dock.isVisible()) await dock.click();
  else {
    await page.getByRole('button', { name: 'All applications', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search LopeOS', exact: true }).fill('Weather');
    await page.getByRole('option', { name: /^Weather / }).click();
  }
  await expect(existing).toBeVisible();
  await expect(existing.locator('.weather-temperature')).toBeVisible();
  return existing;
}

async function screenshot(page, name) {
  const path = join(output, `${name}.png`);
  await page.locator('[data-app-id="lope.weather"]').screenshot({ path });
  screenshots.push(path);
}

async function assertNoOverflow(page) {
  const geometry = await page.getByTestId('weather-app').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth }));
  assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.pageScroll <= geometry.pageWidth + 1, JSON.stringify(geometry));
}

async function openCities(app) {
  const sidebar = app.locator('.weather-city-sidebar');
  if (!await sidebar.isVisible()) await app.getByRole('button', { name: 'Show cities', exact: true }).click();
  await expect(sidebar).toBeVisible();
  return sidebar;
}

async function addCity(page, name) {
  const app = page.getByTestId('weather-app');
  const sidebar = await openCities(app);
  await sidebar.getByRole('button', { name: 'Add a city', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a city', exact: true });
  await dialog.getByRole('textbox', { name: 'City or postal code', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await dialog.locator('.location-results').getByRole('button', { name: new RegExp(`^${name} `) }).click();
  await expect(dialog).toHaveCount(0);
  await expect(app.locator('.weather-place')).toHaveText(name);
}

async function localAndUI() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await seedSession(page);
  await routes(page);
  await page.addInitScript(() => { localStorage.setItem('lope.theme', 'light'); localStorage.setItem('lope.reduceMotion', 'true'); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.desktop')).toBeVisible();
  const welcome = page.getByRole('button', { name: 'Minimize Welcome', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  const app = await launchWeather(page);
  await expect(app.locator('.weather-city-sidebar')).toBeVisible();
  assert.deepEqual(await weatherPreferences(page), { cities: ['Denver'], active: 'Denver', units: 'celsius' });
  await addCity(page, 'Boulder');
  await addCity(page, 'Tokyo');
  await addCity(page, 'Boulder');
  assert.deepEqual(await weatherPreferences(page), { cities: ['Denver', 'Boulder', 'Tokyo'], active: 'Boulder', units: 'celsius' });
  await expect(app.getByRole('button', { name: 'Show weather for Boulder', exact: true })).toHaveAttribute('aria-current', 'location');
  await app.getByRole('button', { name: 'Show weather for Tokyo', exact: true }).click();
  await expect(app.locator('.weather-place')).toHaveText('Tokyo');
  await app.getByRole('button', { name: 'Use Fahrenheit', exact: true }).click();
  await expect(app.locator('.weather-temperature')).toHaveAttribute('aria-label', '48°F');
  await app.locator('.weather-city-sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
  await app.getByRole('button', { name: 'Move Tokyo up', exact: true }).click();
  assert.deepEqual((await weatherPreferences(page)).cities, ['Denver', 'Tokyo', 'Boulder']);
  await app.getByRole('button', { name: 'Remove Tokyo', exact: true }).click();
  assert.deepEqual(await weatherPreferences(page), { cities: ['Denver', 'Boulder'], active: 'Boulder', units: 'fahrenheit' });
  await app.locator('.weather-city-sidebar').getByRole('button', { name: 'Done', exact: true }).click();
  await screenshot(page, 'weather-cities-light');
  await assertNoOverflow(page);
  pass('add, deduplicate, switch, reorder, and remove selected city with units retained');

  await page.reload();
  await launchWeather(page);
  assert.deepEqual(await weatherPreferences(page), { cities: ['Denver', 'Boulder'], active: 'Boulder', units: 'fahrenheit' });
  await expect(app.getByRole('button', { name: 'Show weather for Boulder', exact: true })).toHaveAttribute('aria-current', 'location');
  const roundTrip = await page.evaluate(async () => {
    const { preferences, PreferenceStore, validatePreferenceImport } = await import('/packages/sdk/src/preferences.ts');
    const backend = { data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); }, removeItem(key) { this.data.delete(key); } };
    const store = new PreferenceStore(backend);
    const imported = validatePreferenceImport(preferences.export());
    store.activateUser('city-alex'); store.apply(imported.values);
    const first = store.getSnapshot();
    store.activateUser('city-sam');
    const second = store.getSnapshot();
    store.set('weather.location', { name: 'Paris', latitude: 48.8566, longitude: 2.3522 });
    store.activateUser('city-alex');
    return { first: first['weather.locations'].map(city => city.name), second: second['weather.locations'].map(city => city.name), restored: store.get('weather.locations', []).map(city => city.name), active: store.get('weather.location', null).name, units: store.get('weather.units', '') };
  });
  assert.deepEqual(roundTrip, { first: ['Denver', 'Boulder'], second: ['Denver'], restored: ['Denver', 'Boulder'], active: 'Boulder', units: 'fahrenheit' });
  pass('reload, validated settings export/import, and local account isolation');

  await page.evaluate(async () => { const { preferences } = await import('/packages/sdk/src/preferences.ts'); preferences.set('theme', 'dark'); });
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'dark');
  await screenshot(page, 'weather-cities-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(app.locator('.weather-city-sidebar')).toBeHidden();
  await openCities(app);
  await expect(app.getByRole('button', { name: 'Show weather for Boulder', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(app.locator('.weather-city-sidebar')).toBeHidden();
  await expect(app.getByRole('button', { name: 'Show cities', exact: true })).toBeFocused();
  await openCities(app);
  await assertNoOverflow(page);
  await screenshot(page, 'weather-cities-mobile-list');
  await app.getByRole('button', { name: 'Show weather for Denver', exact: true }).click();
  await expect(app.locator('.weather-place')).toHaveText('Denver');
  await expect(app.locator('.weather-city-sidebar')).toBeHidden();
  await assertNoOverflow(page);
  await screenshot(page, 'weather-cities-mobile-forecast');
  pass('light/dark desktop and narrow sidebar navigation without horizontal overflow');

  await page.setViewportSize({ width: 1440, height: 960 });
  await openCities(app);
  await app.locator('.weather-city-sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
  await app.getByRole('button', { name: 'Remove Boulder', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Show weather for Denver', exact: true })).toBeFocused();
  await expect(app.getByRole('button', { name: 'Remove Denver', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const { preferences } = await import('/packages/sdk/src/preferences.ts');
    const cities = Array.from({ length: 20 }, (_, index) => ({ name: `Saved city ${index + 1}`, latitude: index, longitude: index }));
    preferences.apply({ 'weather.locations': cities, 'weather.location': cities[0] });
  });
  await expect(app.getByRole('button', { name: /^Show weather for / })).toHaveCount(20);
  await expect(app.getByRole('button', { name: 'City list is full', exact: true })).toBeDisabled();
  pass('last-city removal and 20-city limit enforced in UI');
  await context.close();
}

async function encryptedSync() {
  const contextA = await browser.newContext(), contextB = await browser.newContext();
  async function open(context) {
    const page = await context.newPage(); await routes(page, true);
    await page.goto(origin + '/tests/accounts/harness.html');
    await page.waitForFunction(() => !!window.accountTest);
    await page.evaluate(() => window.accountTest.cloudAccount.initialize());
    return page;
  }
  const a = await open(contextA), b = await open(contextB);
  await a.evaluate(async cities => {
    const { preferences, cloudAccount } = window.accountTest;
    const { addWeatherLocation, reorderWeatherLocations, weatherLocationKey } = await import('/apps/web/src/apps/weather/locations.ts');
    for (const city of cities.slice(1, 3)) addWeatherLocation(preferences, city);
    reorderWeatherLocations(preferences, [cities[2], cities[0], cities[1]].map(weatherLocationKey));
    addWeatherLocation(preferences, cities[1]); preferences.set('weather.units', 'fahrenheit');
    await cloudAccount.register({ displayName: 'Weather Tester', accountName: 'weathertester', password: 'temporary-weather-passphrase' });
    await cloudAccount.syncNow();
  }, locations);
  await b.evaluate(async () => { const { cloudAccount } = window.accountTest; await cloudAccount.signIn('weathertester', 'temporary-weather-passphrase'); await cloudAccount.syncNow(); });
  assert.deepEqual(await weatherPreferences(b), { cities: ['Tokyo', 'Denver', 'Boulder'], active: 'Boulder', units: 'fahrenheit' });
  assert.equal(await b.evaluate(() => window.accountTest.cloudAccount.getSnapshot().encryption), 'unlocked');
  pass('real encrypted account sync restores saved cities, order, active city, and units on second device');

  await b.evaluate(async () => {
    const { preferences, cloudAccount } = window.accountTest;
    const { removeWeatherLocation, reorderWeatherLocations, weatherLocationKey } = await import('/apps/web/src/apps/weather/locations.ts');
    removeWeatherLocation(preferences, weatherLocationKey(preferences.get('weather.location', null)));
    reorderWeatherLocations(preferences, [...preferences.get('weather.locations', [])].reverse().map(weatherLocationKey));
    await cloudAccount.syncNow();
  });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.deepEqual(await weatherPreferences(a), { cities: ['Denver', 'Tokyo'], active: 'Denver', units: 'fahrenheit' });
  pass('second-device removal and reordering sync back without reviving removed city');

  await contextA.setOffline(true);
  await a.evaluate(async () => {
    const { preferences } = window.accountTest;
    const { reorderWeatherLocations, weatherLocationKey } = await import('/apps/web/src/apps/weather/locations.ts');
    preferences.set('weather.units', 'celsius');
    reorderWeatherLocations(preferences, [...preferences.get('weather.locations', [])].reverse().map(weatherLocationKey));
  });
  await contextA.setOffline(false);
  await expect.poll(async () => { await b.evaluate(() => window.accountTest.cloudAccount.syncNow()); return weatherPreferences(b); }, { timeout: 15_000, intervals: [500, 1000] }).toEqual({ cities: ['Tokyo', 'Denver'], active: 'Denver', units: 'celsius' });
  pass('offline city-order edit and unit change sync automatically after reconnect');

  await a.reload();
  await a.waitForFunction(() => !!window.accountTest);
  await a.evaluate(() => window.accountTest.cloudAccount.initialize());
  assert.equal(await a.evaluate(() => window.accountTest.cloudAccount.getSnapshot().encryption), 'locked');
  await a.evaluate(async () => { const { cloudAccount } = window.accountTest; await cloudAccount.unlock('temporary-weather-passphrase'); await cloudAccount.syncNow(); });
  assert.deepEqual(await weatherPreferences(a), { cities: ['Tokyo', 'Denver'], active: 'Denver', units: 'celsius' });
  pass('encrypted reload unlock preserves the synced city list');
  await contextA.close(); await contextB.close();
}

try {
  await mkdir(output, { recursive: true });
  accounts = await createAccountServer({ directory, origins: [origin] });
  await new Promise(resolve => accounts.server.listen(0, '127.0.0.1', resolve));
  // Separate Vite cache/config prevents changing the user's running development server.
  vite = await createServer({ configFile: false, root: resolve('.'), plugins: [react()], cacheDir: join(directory, '.vite'), server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api/accounts': `http://127.0.0.1:${accounts.server.address().port}` } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  if (process.env.WEATHER_CITIES_ONLY !== 'sync') await localAndUI();
  if (process.env.WEATHER_CITIES_ONLY !== 'ui') await encryptedSync();
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  await writeFile(join(output, process.env.WEATHER_CITIES_ONLY ? `results-${process.env.WEATHER_CITIES_ONLY}.json` : 'results.json'), JSON.stringify({ checks, screenshots, errors }, null, 2));
  console.log(`PASS ${checks.length} groups; screenshots and results: ${output}`);
} finally {
  await browser?.close(); await vite?.close(); await accounts?.dispose();
  await rm(directory, { recursive: true, force: true });
}
