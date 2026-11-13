/** TEST ONLY: deterministic HTTP/WebSocket contract fixture, never imported by product code.
 * These tests exercise real application UIs and the real runtime-client adapter.
 * They do not claim to run bash, Docker, Chromium streaming, or a live provider.
 */
import type { Page, WebSocketRoute } from '@playwright/test';
import { seedSession } from '../setup/seed-session.mjs';

type Entry = { path: string; name: string; type: 'file' | 'directory'; data: Buffer; size: number; version: string; modifiedAt: string };
export const forecastFixture = {
  current: { time: '2026-11-12T11:00', temperature_2m: 12.5, apparent_temperature: 11.2, relative_humidity_2m: 45, wind_speed_10m: 8.5, weather_code: 2, is_day: 1 },
  daily: { time: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'], temperature_2m_min: [4, 5, 6, 7, 4], temperature_2m_max: [17, 18, 19, 20, 16], weather_code: [2, 0, 3, 61, 2], precipitation_probability_max: [10, 0, 15, 65, 20] },
};
export async function installContractRuntime(page: Page, options: { signedIn?: boolean } = {}) {
  if (options.signedIn !== false) await seedSession(page);
  const entries = new Map<string, Entry>(); const sockets = new Set<WebSocketRoute>();
  let revision = 0; let offline = false; let weatherFailure = false; let forecastRequests = 0;
  let storageUnavailable = false;
  let nextFailure: { endpoint: string; code: string; message: string } | undefined;
  const mutations: { operation: string; path: string; destination?: string }[] = [];
  const parent = (path: string) => path.split('/').slice(0, -1).join('/') || '/';
  const changed = () => { for (const socket of sockets) { try { socket.send(JSON.stringify({ type: 'files.changed' })); } catch {} } };
  function put(path: string, data = '', type: 'file' | 'directory' = 'file') {
    const buffer = Buffer.from(data);
    entries.set(path, { path, name: path.split('/').pop() || 'Home', type, data: buffer, size: type === 'file' ? buffer.length : 0, version: `test-version-${++revision}`, modifiedAt: '2026-11-12T17:00:00.000Z' });
  }
  ['/', '/Documents', '/Downloads'].forEach(path => put(path, '', 'directory'));
  put('/Documents/hello.txt', 'Hello from the shared workspace.\n');
  put('/Documents/ideas.md', '# A little possibility\n');
  await page.routeWebSocket('**/api/ws', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'auth' && message.channel === 'files') { sockets.add(socket); socket.send(JSON.stringify({ type: 'files.ready' })); }
      else socket.close({ code: 4401, reason: 'No real terminal in the contract fixture.' });
    });
    socket.onClose(() => { sockets.delete(socket); });
  });
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const endpoint = url.pathname.replace('/api', '');
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const fail = (code: string, message: string, status = 400) => reply(status, { error: { code, message } });
    if (endpoint === '/accounts/session') return reply(200, { account: null, quotaBytes: 1_000_000_000, usedBytes: 0 });
    if (offline) return fail('UNAVAILABLE', 'Test runtime is disconnected.', 503);
    // The runtime client establishes visitor identity before opening file events.
    if (endpoint === '/identity') return reply(200, { userId: 'contract-user', workspaceId: 'contract-workspace' });
    if (!endpoint.startsWith('/fs/')) return fail('UNAVAILABLE', 'No terminal or Linux workspace is provided by this contract fixture.', 503);
    const body = request.postDataJSON() || {};
    const path = url.searchParams.get('path') || body.path;
    if (nextFailure?.endpoint === endpoint) { const failure = nextFailure; nextFailure = undefined; return fail(failure.code, failure.message, 503); }
    if (endpoint === '/fs/storage') {
      if (storageUnavailable) return fail('UNAVAILABLE', 'Disk usage is temporarily unavailable.', 503);
      const totalBytes = 256 * 1024 ** 3;
      const usedBytes = 80 * 1024 ** 3 + [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
      return reply(200, { totalBytes, usedBytes, availableBytes: totalBytes - usedBytes, scope: 'runtime-volume' });
    }
    if (endpoint === '/fs/list') {
      if (entries.get(path)?.type !== 'directory') return fail('NOT_FOUND', 'Folder not found.', 404);
      return reply(200, { entries: [...entries.values()].filter(entry => entry.path !== '/' && parent(entry.path) === path).map(({ data: _data, ...entry }) => entry) });
    }
    if (endpoint === '/fs/stat') { const entry = entries.get(path); return entry ? reply(200, entry) : fail('NOT_FOUND', 'File not found.', 404); }
    if (endpoint === '/fs/read') { const entry = entries.get(path); return entry?.type === 'file' ? reply(200, { data: entry.data.toString('base64'), version: entry.version }) : fail('NOT_FOUND', 'File not found.', 404); }
    if (endpoint === '/fs/write') {
      const existing = entries.get(path);
      if ((body.createOnly && existing) || (body.version !== undefined && body.version !== existing?.version)) return fail('CONFLICT', 'Version conflict or destination exists.', 409);
      if (!entries.has(parent(path))) return fail('NOT_FOUND', 'Parent folder not found.', 404);
      const data = Buffer.from(body.data, 'base64'); put(path, '');
      const entry = entries.get(path)!; entry.data = data; entry.size = data.length; changed(); return reply(200, entry);
    }
    if (endpoint === '/fs/mkdir') {
      if (entries.has(path)) return fail('CONFLICT', 'Destination exists.', 409);
      put(path, '', 'directory'); changed(); return reply(200, entries.get(path));
    }
    if (endpoint === '/fs/move') {
      if (!entries.has(path)) return fail('NOT_FOUND', 'File not found.', 404);
      if (entries.has(body.destination)) return fail('CONFLICT', 'Destination exists.', 409);
      for (const [key, value] of [...entries]) if (key === path || key.startsWith(path + '/')) { entries.delete(key); const target = body.destination + key.slice(path.length); entries.set(target, { ...value, path: target, name: target.split('/').pop() }); }
      mutations.push({ operation: 'move', path, destination: body.destination });
      changed(); return reply(200, entries.get(body.destination));
    }
    if (endpoint === '/fs/copy') {
      if (!entries.has(path)) return fail('NOT_FOUND', 'File not found.', 404);
      if (entries.has(body.destination)) return fail('CONFLICT', 'Destination exists.', 409);
      if (body.destination.startsWith(path + '/')) return fail('INVALID', 'Cannot copy a folder inside itself.');
      if (entries.get(parent(body.destination))?.type !== 'directory') return fail('NOT_FOUND', 'Parent folder not found.', 404);
      for (const [key, value] of [...entries]) if (key === path || key.startsWith(path + '/')) {
        const target = body.destination + key.slice(path.length);
        entries.set(target, { ...value, path: target, name: target.split('/').pop()!, data: Buffer.from(value.data), version: `test-version-${++revision}` });
      }
      mutations.push({ operation: 'copy', path, destination: body.destination });
      changed(); return reply(200, entries.get(body.destination));
    }
    if (endpoint === '/fs/delete') { for (const key of entries.keys()) if (key === path || key.startsWith(path + '/')) entries.delete(key); changed(); return reply(200, { ok: true }); }
    return fail('NOT_FOUND', 'Unknown test fixture endpoint.', 404);
  });
  await page.route('https://api.open-meteo.com/**', route => {
    forecastRequests++;
    const data = structuredClone(forecastFixture);
    if (new URL(route.request().url()).searchParams.get('temperature_unit') === 'fahrenheit') { data.current.temperature_2m = 54.5; data.current.apparent_temperature = 52.2; data.daily.temperature_2m_min = data.daily.temperature_2m_min.map(value => value * 1.8 + 32); data.daily.temperature_2m_max = data.daily.temperature_2m_max.map(value => value * 1.8 + 32); }
    return route.fulfill({ status: weatherFailure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(weatherFailure ? { error: true } : data) });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Boulder', admin1: 'Colorado', country: 'United States', latitude: 40.015, longitude: -105.2705 }] }) }));
  return {
    text: (path: string) => entries.get(path)?.data.toString('utf8'),
    exists: (path: string) => entries.has(path),
    externalWrite(path: string, data: string) { put(path, data); changed(); },
    externalMkdir(path: string) { put(path, '', 'directory'); changed(); },
    setStorageUnavailable(value: boolean) { storageUnavailable = value; changed(); },
    failNextOperation(endpoint: string, message = 'The operation was interrupted. Try again.', code = 'UNAVAILABLE') { nextFailure = { endpoint, message, code }; },
    mutations: () => [...mutations],
    setDisconnected(value: boolean) { offline = value; changed(); },
    setWeatherFailure(value: boolean) { weatherFailure = value; },
    forecastRequests: () => forecastRequests,
  };
}
