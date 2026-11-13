import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../public/lope-sw.js', import.meta.url), 'utf8');
const origin = 'https://lope.test';
const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
class MemoryCache {
  values = new Map();
  constructor(name, beforePut) { this.name = name; this.beforePut = beforePut; }
  async match(request) { return this.values.get(key(request))?.clone(); }
  async put(request, response) { await this.beforePut?.(this.name, new URL(key(request)).pathname); this.values.set(key(request), response.clone()); }
  async delete(request) { return this.values.delete(key(request)); }
  async keys() { return [...this.values.keys()].map(url => new Request(url)); }
}
function fixture(build, content = build) {
  const files = new Map([['/index.html', `<html>${content}</html>`], ['/assets/lazy.js', `export default ${JSON.stringify(content)}`], ['/wallpapers/test.svg', '<svg>unchanged</svg>']]);
  files.set(`/assets/worker-${createHash('sha256').update(build).digest('hex').slice(0, 8)}.js`, `import './lazy.js'; // ${build}`);
  const assets = [...files].map(([url, text]) => { const bytes = Buffer.from(text); return { url, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
  return { files, release: { format: 1, version: '0.1.0', build, releasedAt: '2026-11-13T10:00:00Z', assets, totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0) } };
}
function harness(initial) {
  const stores = new Map();
  const handlers = new Map();
  const requests = [];
  let deployment = initial, offline = false;
  let beforePut;
  const clients = [{ id: 'one', type: 'window', url: origin + '/' }, { id: 'two', type: 'window', url: origin + '/' }];
  vm.runInNewContext(source, {
    self: { location: { origin }, clients: { get: async id => clients.find(client => client.id === id), matchAll: async () => clients, claim: async () => {} }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { has: async name => stores.has(name), open: async name => { if (!stores.has(name)) stores.set(name, new MemoryCache(name, (cacheName, path) => beforePut?.(cacheName, path))); return stores.get(name); }, delete: async name => stores.delete(name), keys: async () => [...stores.keys()] },
    fetch: async request => { const path = new URL(typeof request === 'string' ? request : request.url, origin).pathname; requests.push(path); if (offline) throw new TypeError('Offline'); const text = deployment.files.get(path); return new Response(text ?? 'missing', { status: text === undefined ? 404 : 200, headers: { 'Content-Type': path.endsWith('html') ? 'text/html' : 'text/javascript' } }); },
    Response, Request, Headers, URL, AbortController, Uint8Array, Date, Set, Map, setTimeout, clearTimeout, crypto: webcrypto,
  });
  return {
    stores, requests,
    beforePut(handler) { beforePut = handler; },
    addClient(client) { clients.push(client); },
    deploy(next) { deployment = next; },
    offline(value) { offline = value; },
    async message(data, client = 'one') {
      const messages = [];
      let done;
      handlers.get('message')({ data, source: { id: client }, ports: [{ postMessage: message => messages.push(message) }], waitUntil: promise => { done = promise; } });
      await done;
      return { final: messages.at(-1), messages };
    },
    async fetch(path = '/', clientId = 'one', navigation = false) {
      let response;
      handlers.get('fetch')({ request: { url: origin + path, method: 'GET', mode: navigation ? 'navigate' : 'cors' }, clientId, resultingClientId: navigation ? clientId : '', respondWith: promise => { response = promise; } });
      return response ? await response : null;
    },
  };
}

test('installed release remains cached across deployments and offline navigation; update commits only on explicit activation', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  assert.equal((await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true })).final.type, 'COMPLETE');
  await h.message({ type: 'LOPE_PIN', build: a.release.build });
  h.deploy(b);
  assert.match(await (await h.fetch('/', 'one', true)).text(), /build-A/);
  const result = await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false });
  assert.equal(result.final.type, 'COMPLETE');
  assert.equal(result.messages.at(-2).receivedBytes, b.release.totalBytes);
  assert.equal(result.messages.at(-2).downloadedBytes, b.release.totalBytes - b.release.assets.find(asset => asset.url.includes('wallpapers')).size);
  assert.equal((await h.message({ type: 'LOPE_STATUS', build: 'build-A' })).final.release.build, 'build-A');
  assert.equal((await h.message({ type: 'LOPE_ACTIVATE', build: 'build-B' })).final.type, 'COMPLETE');
  h.offline(true);
  assert.match(await (await h.fetch('/assets/lazy.js', 'one')).text(), /build-A/);
  assert.match(await (await h.fetch('/', 'two', true)).text(), /build-B/);
  assert.match(await (await h.fetch('/assets/lazy.js', 'two')).text(), /build-B/);
  assert.equal(await h.fetch('/api/files'), null);
  assert.equal(await h.fetch('/__lope/version.json'), null);
});

test('corrupt downloads leave installed release intact and remove incomplete staged cache', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  b.files.set('/assets/lazy.js', 'export default "corrupt"'); h.deploy(b);
  const result = await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false });
  assert.equal(result.final.type, 'ERROR');
  assert.equal((await h.message({ type: 'LOPE_STATUS' })).final.release.build, 'build-A');
  assert.equal(h.stores.has('lope.os.release.v1:build-B'), false);
  assert.equal((await h.message({ type: 'LOPE_ACTIVATE', build: 'build-B' })).final.type, 'ERROR');
});

test('baseline caching cannot silently activate a newer release', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  h.deploy(b);
  assert.equal((await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: true })).final.type, 'ERROR');
  assert.equal((await h.message({ type: 'LOPE_STATUS' })).final.release.build, 'build-A');
});

test('release validation rejects cross-origin URLs, API paths, duplicate assets and size mismatches before download', async () => {
  const a = fixture('build-A');
  for (const mutate of [release => release.assets[0].url = 'https://evil.test/index.html', release => release.assets[0].url = '/api/files', release => release.assets[1].url = release.assets[0].url, release => release.totalBytes++, release => release.assets[1].url = '/assets/%2e%2e/api/files']) {
    const h = harness(a), release = structuredClone(a.release); mutate(release);
    assert.equal((await h.message({ type: 'LOPE_CACHE_RELEASE', release, activate: true })).final.type, 'ERROR');
    assert.deepEqual(h.requests, []);
  }
});

test('missing cached assets never fall back to different published bytes', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  await h.stores.get('lope.os.release.v1:build-A').delete('/assets/lazy.js');
  h.deploy(b);
  assert.equal((await h.message({ type: 'LOPE_STATUS', build: 'build-A' })).final.currentCached, false);
  assert.equal((await h.fetch('/assets/lazy.js')).status, 503);
});

test('partially evicted installed release can be repaired from matching published bytes', async () => {
  const a = fixture('build-A');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  await h.stores.get('lope.os.release.v1:build-A').delete('/assets/lazy.js');
  assert.equal((await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true })).final.type, 'COMPLETE');
  assert.equal((await h.message({ type: 'LOPE_STATUS', build: 'build-A' })).final.currentCached, true);
});

test('reusing a build identifier for different bytes fails without switching the installed release', async () => {
  const a = fixture('build-A'), changed = fixture('build-A', 'different content');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  h.deploy(changed);
  const result = await h.message({ type: 'LOPE_CACHE_RELEASE', release: changed.release, activate: true });
  assert.equal(result.final.type, 'ERROR');
  assert.match(result.final.message, /build identifier/);
  assert.match(await (await h.fetch('/', 'one', true)).text(), /build-A/);
});


test('workers from an older tab keep their original module imports after another tab updates', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  await h.message({ type: 'LOPE_PIN', build: a.release.build });
  h.deploy(b);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false });
  await h.message({ type: 'LOPE_ACTIVATE', build: b.release.build });
  const path = a.release.assets.find(asset => asset.url.includes('/worker-')).url;
  h.addClient({ id: 'old-worker', type: 'worker', url: origin + path });
  h.offline(true);
  assert.match(await (await h.fetch(path, '')).text(), /build-A/);
  assert.match(await (await h.fetch('/assets/lazy.js', 'old-worker')).text(), /build-A/);
});


test('cancelling while the completed release marker is being written preserves the installed version and permits reset', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  h.deploy(b);
  let writing;
  const reachedMarker = new Promise(resolve => { writing = resolve; });
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  h.beforePut(async (name, path) => {
    if (name === 'lope.os.release.v1:build-B' && path === '/__lope/cache/release') { writing(); await gate; }
  });
  const download = h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false });
  await reachedMarker;
  const cancel = h.message({ type: 'LOPE_CANCEL' });
  resume();
  const result = await download;
  assert.equal(result.final.type, 'ERROR');
  assert.match(result.final.message, /cancelled/);
  assert.equal((await cancel).final.release.build, 'build-A');
  assert.equal(h.stores.has('lope.os.release.v1:build-B'), false);
  h.offline(true);
  assert.match(await (await h.fetch('/', 'one', true)).text(), /build-A/);
  // Factory reset deletes the caches only after cancellation has settled. No
  // pending writer can restore the installed pointer or staged release afterward.
  h.stores.clear();
  assert.equal((await h.message({ type: 'LOPE_STATUS' })).final.release, null);
});

test('browser quota failure during a new release write preserves the installed release and allows retry', async () => {
  const a = fixture('build-A'), b = fixture('build-B');
  const h = harness(a);
  await h.message({ type: 'LOPE_CACHE_RELEASE', release: a.release, activate: true });
  h.deploy(b);
  h.beforePut((name, path) => {
    if (name === 'lope.os.release.v1:build-B' && path === '/assets/lazy.js') throw new DOMException('Storage quota exhausted', 'QuotaExceededError');
  });
  const result = await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false });
  assert.equal(result.final.type, 'ERROR');
  assert.match(result.final.message, /not enough browser storage/);
  assert.equal(h.stores.has('lope.os.release.v1:build-B'), false);
  assert.equal((await h.message({ type: 'LOPE_STATUS', build: 'build-A' })).final.currentCached, true);
  h.offline(true);
  assert.match(await (await h.fetch('/', 'one', true)).text(), /build-A/);
  h.offline(false); h.beforePut(undefined);
  assert.equal((await h.message({ type: 'LOPE_CACHE_RELEASE', release: b.release, activate: false })).final.type, 'COMPLETE');
  assert.equal((await h.message({ type: 'LOPE_ACTIVATE', build: 'build-B' })).final.type, 'COMPLETE');
});
