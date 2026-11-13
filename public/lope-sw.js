/* LopeOS release storage. Deployments are discovered by the page; only an
   explicit LOPE_ACTIVATE changes the installed release after first use. */
'use strict';
const META = 'lope.os.metadata.v1';
const PREFIX = 'lope.os.release.v1:';
const INSTALLED = '/__lope/cache/installed';
const RELEASE = '/__lope/cache/release';
const PIN = '/__lope/cache/client/';
let downloadJob;
let activationJob;
const cacheName = build => PREFIX + encodeURIComponent(build);
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const errorText = error => error?.name === 'AbortError' ? 'The download was cancelled. Your installed version is unchanged.' : error?.name === 'QuotaExceededError' ? 'There is not enough browser storage for this update. Free some space and try again. Your installed version is unchanged.' : error?.message || 'The update could not finish. Your installed version is unchanged.';
const post = (port, value) => { try { port?.postMessage(value); } catch { /* A closed tab cannot receive progress. */ } };

function validateRelease(value) {
  if (!value || value.format !== 1 || typeof value.version !== 'string' || !value.version || value.version.length > 100 || typeof value.build !== 'string' || !value.build || value.build.length > 200 || typeof value.releasedAt !== 'string' || !Number.isFinite(Date.parse(value.releasedAt)) || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 1 || !Array.isArray(value.assets) || !value.assets.length || value.assets.length > 20000) throw new Error('This deployment does not publish a valid LopeOS release.');
  const seen = new Set();
  let total = 0;
  for (const asset of value.assets) {
    if (!asset || typeof asset.url !== 'string' || !/^\/(?:index\.html|assets\/[^?#]+|wallpapers\/[^?#]+|photos\/[^?#]+|[^/?.]+\.(?:ico|png|svg|webmanifest|json|txt))$/.test(asset.url) || /(?:^|\/)\.{1,2}(?:\/|$)|%2f|%5c|%2e|\\/i.test(asset.url) || seen.has(asset.url) || !Number.isSafeInteger(asset.size) || asset.size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The release contains an invalid or duplicate asset.');
    const url = new URL(asset.url, self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== asset.url || url.search || url.hash) throw new Error('The release contains an unsafe asset URL.');
    seen.add(asset.url); total += asset.size;
  }
  if (!seen.has('/index.html') || total !== value.totalBytes || !Number.isSafeInteger(total)) throw new Error('The release size does not match its files.');
  return value;
}
async function readJSON(cache, key) {
  const response = await cache.match(key);
  return response ? response.json() : null;
}
async function installed() { return readJSON(await caches.open(META), INSTALLED); }
async function releaseFor(build) {
  if (typeof build !== 'string' || !build || !await caches.has(cacheName(build))) return null;
  return readJSON(await caches.open(cacheName(build)), RELEASE);
}
async function pin(clientId, build) {
  if (clientId) await (await caches.open(META)).put(PIN + encodeURIComponent(clientId), jsonResponse({ build }));
}
async function releaseContaining(path) {
  const current = await installed();
  if (current?.assets.some(asset => asset.url === path)) return current;
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX)) continue;
    const release = await readJSON(await caches.open(name), RELEASE);
    if (release?.assets.some(asset => asset.url === path)) return release;
  }
  return null;
}
async function clientRelease(clientId) {
  const entry = clientId ? await readJSON(await caches.open(META), PIN + encodeURIComponent(clientId)) : null;
  if (entry) return releaseFor(entry.build);
  // A dedicated/shared worker has its own client ID. Its emitted script URL
  // identifies the owning release even after another document installs an update.
  const client = clientId && self.clients.get ? await self.clients.get(clientId) : null;
  if (client && client.type !== 'window' && client.url) {
    const url = new URL(client.url);
    if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
      const release = await releaseContaining(url.pathname);
      if (release) { await pin(clientId, release.build); return release; }
    }
  }
  return null;
}
async function verify(bytes, asset) {
  if (bytes.byteLength !== asset.size) throw new Error(`The download of ${asset.url} was incomplete. Try again when the deployment has finished.`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error(`The downloaded ${asset.url} did not match this release. The server may be publishing an update; try again shortly.`);
}
async function validateCache(release) {
  if (!await caches.has(cacheName(release.build))) throw new Error('The downloaded release is no longer in browser storage. Download it again.');
  const cache = await caches.open(cacheName(release.build));
  const keys = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
  if (!release.assets.every(asset => keys.has(asset.url))) throw new Error('Some downloaded files are missing from browser storage. Download the update again.');
}
async function activate(build, clientId, signal) {
  const release = await releaseFor(build);
  if (!release) throw new Error('Download this release before installing it.');
  await validateCache(release);
  signal?.throwIfAborted();
  // A single metadata write is the commit point. Old releases remain available
  // for existing documents until they close or explicitly reload.
  const metadata = await caches.open(META);
  signal?.throwIfAborted();
  await metadata.put(INSTALLED, jsonResponse(release));
  // Do not repin this document before reload: its code still belongs to the old release.
  return release;
}
async function prune(keepBuild) {
  const meta = await caches.open(META);
  const windows = await self.clients.matchAll({ type: 'all', includeUncontrolled: true });
  const ids = new Set(windows.map(client => client.id));
  const keep = new Set([keepBuild, (await installed())?.build].filter(Boolean));
  for (const request of await meta.keys()) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(PIN)) continue;
    const id = decodeURIComponent(path.slice(PIN.length));
    if (!ids.has(id)) await meta.delete(request);
    else {
      const entry = await readJSON(meta, request);
      if (entry?.build) keep.add(entry.build);
    }
  }
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && !keep.has(decodeURIComponent(name.slice(PREFIX.length)))) await caches.delete(name);
}
async function fetchAsset(asset, signal, progress) {
  const timeout = new AbortController();
  let timedOut = false;
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) timeout.abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, 120000);
  try {
  const response = await fetch(asset.url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: timeout.signal });
  if (!response.ok || response.type === 'opaque') throw new Error(`Could not download ${asset.url} (${response.status}). Check your connection and try again.`);
  const chunks = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > asset.size) throw new Error(`The download of ${asset.url} does not match this release.`);
        chunks.push(value); progress(value.byteLength);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    chunks.push(value); length = value.byteLength; progress(length);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  await verify(bytes, asset);
  const headers = new Headers(response.headers);
  // Fetch provides decoded bytes. Do not retain transfer-encoding metadata.
  headers.delete('Content-Encoding'); headers.delete('Transfer-Encoding');
  headers.set('Content-Length', String(length));
  return new Response(bytes, { status: 200, headers });  } catch (error) {
    if (timedOut) throw new Error('The download timed out. Check your connection and try again. Your installed version is unchanged.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function cacheRelease(release, shouldActivate, clientId, notify, signal) {
  signal.throwIfAborted();
  validateRelease(release);
  const current = await installed();
  if (shouldActivate && current && current.build !== release.build) throw new Error('Another version is already installed. Download the new release and choose Install to update.');
  const existing = await releaseFor(release.build);
  if (existing && (existing.version !== release.version || existing.totalBytes !== release.totalBytes || existing.assets.length !== release.assets.length || existing.assets.some(asset => !release.assets.some(next => next.url === asset.url && next.size === asset.size && next.sha256 === asset.sha256)))) throw new Error('This build identifier describes different files. Publish a new build identifier and try again.');
  if (existing) {
    try {
      await validateCache(existing);
      notify({ type: 'PROGRESS', phase: 'verifying', receivedBytes: release.totalBytes, totalBytes: release.totalBytes, downloadedBytes: 0, downloadBytes: 0, completedFiles: release.assets.length, totalFiles: release.assets.length });
      signal.throwIfAborted();
      if (shouldActivate) await activate(release.build, clientId, signal);
      return existing;
    } catch (error) {
      signal.throwIfAborted();
      // Storage eviction can leave a previously complete cache partial.
      if (error?.name === 'QuotaExceededError') throw error;
    }
  }
  await prune(release.build);
  const name = cacheName(release.build);
  if (current?.build !== release.build) await caches.delete(name);
  const target = await caches.open(name);
  const oldCache = current ? await caches.open(cacheName(current.build)) : null;
  const oldAssets = new Map(current?.assets.map(asset => [asset.url, asset]) || []);
  const reusable = new Map();
  for (const asset of release.assets) {
    const previous = oldAssets.get(asset.url);
    if (previous?.sha256 === asset.sha256 && previous.size === asset.size && oldCache) {
      const response = await oldCache.match(asset.url);
      if (response) reusable.set(asset.url, response);
    }
  }
  let receivedBytes = 0, downloadedBytes = 0, completedFiles = 0;
  let downloadBytes = release.assets.reduce((sum, asset) => sum + (reusable.has(asset.url) ? 0 : asset.size), 0);
  let lastNotification = 0;
  const progress = (phase = 'downloading', force = false) => {
    const now = Date.now();
    if (!force && now - lastNotification < 100) return;
    lastNotification = now;
    notify({ type: 'PROGRESS', phase, receivedBytes, totalBytes: release.totalBytes, downloadedBytes, downloadBytes, completedFiles, totalFiles: release.assets.length });
  };
  try {
    signal.throwIfAborted();
    progress('downloading', true);
    let index = 0;
    let firstFailure;
    const workers = Array.from({ length: Math.min(4, release.assets.length) }, async () => {
      try {
      while (index < release.assets.length) {
        if (firstFailure) return;
        signal.throwIfAborted();
        const asset = release.assets[index++];
        let response = reusable.get(asset.url);
        if (response) {
          try { await verify(await response.clone().arrayBuffer(), asset); }
          catch { response = undefined; downloadBytes += asset.size; }
        }
        if (response) receivedBytes += asset.size;
        else response = await fetchAsset(asset, signal, size => { receivedBytes += size; downloadedBytes += size; progress(); });
        signal.throwIfAborted();
        await target.put(asset.url, response);
        completedFiles++;
        progress();
      }
      } catch (error) { firstFailure ||= error; throw error; }
    });
    // Keep the cache alive until every writer has stopped, including failures.
    const results = await Promise.allSettled(workers);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    signal.throwIfAborted();
    progress('verifying', true);
    await validateCache(release);
    signal.throwIfAborted();
    await target.put(RELEASE, jsonResponse(release));
    signal.throwIfAborted();
    if (shouldActivate) {
      progress('installing', true);
      await activate(release.build, clientId, signal);
    }
    return release;
  } catch (error) {
    if ((await installed())?.build !== release.build) await caches.delete(name);
    throw error;
  }
}

self.addEventListener('install', () => {
  // No skipWaiting here: a changed worker script must not interrupt existing tabs.
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('message', event => {
  const port = event.ports[0];
  const message = event.data;
  if (!message || typeof message.type !== 'string' || !message.type.startsWith('LOPE_')) return;
  const run = async () => {
    const clientId = event.source?.id;
    if (message.type === 'LOPE_STATUS') {
      const release = await installed();
      const cached = await releaseFor(message.build);
      let currentCached = false;
      if (cached) { try { await validateCache(cached); currentCached = true; } catch {} }
      post(port, { type: 'STATUS', release, currentCached });
    } else if (message.type === 'LOPE_PIN') {
      const release = await releaseFor(message.build);
      if (!release) throw new Error('This release is not cached yet.');
      await pin(clientId, message.build);
      post(port, { type: 'COMPLETE', release });
    } else if (message.type === 'LOPE_CACHE_RELEASE') {
      if (activationJob) throw new Error('Wait for the current installation to finish before downloading.');
      const release = validateRelease(message.release);
      if (downloadJob) {
        if (downloadJob.build !== release.build || downloadJob.activate !== Boolean(message.activate)) throw new Error('Another LopeOS update is already downloading. Try again when it finishes.');
        downloadJob.ports.add(port);
        if (downloadJob.progress) post(port, downloadJob.progress);
        const result = await downloadJob.promise;
        post(port, { type: 'COMPLETE', release: result });
        return;
      }
      const controller = new AbortController();
      const job = { build: release.build, activate: Boolean(message.activate), controller, ports: new Set([port]), progress: null, promise: null };
      downloadJob = job;
      job.promise = cacheRelease(release, Boolean(message.activate), clientId, value => {
        job.progress = value;
        for (const observer of job.ports) post(observer, value);
      }, controller.signal);
      try { post(port, { type: 'COMPLETE', release: await job.promise }); }
      finally { if (downloadJob === job) downloadJob = undefined; }
    } else if (message.type === 'LOPE_ACTIVATE') {
      if (downloadJob || activationJob) throw new Error('Wait for the current update to finish before installing.');
      const controller = new AbortController();
      const job = { controller, promise: activate(message.build, clientId, controller.signal) };
      activationJob = job;
      try { post(port, { type: 'COMPLETE', release: await job.promise }); }
      finally { if (activationJob === job) activationJob = undefined; }
    } else if (message.type === 'LOPE_CANCEL') {
      const jobs = [downloadJob, activationJob].filter(Boolean);
      for (const job of jobs) job.controller.abort();
      await Promise.allSettled(jobs.map(job => job.promise));
      post(port, { type: 'COMPLETE', release: await installed() });
    } else throw new Error('This LopeOS worker does not support that update action.');
  };
  event.waitUntil(run().catch(error => post(port, { type: 'ERROR', message: errorText(error) })));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/__lope/') || url.pathname === '/lope-sw.js' || url.pathname.startsWith('/models/')) return;
  const navigation = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  event.respondWith((async () => {
    let release = navigation ? await installed() : await clientRelease(event.clientId) || await installed();
    const path = navigation ? '/index.html' : url.pathname;
    // Worker boot requests can have no source client. Content-addressed Vite
    // URLs are safe to retrieve from an older complete cache in that case.
    if (!navigation && !event.clientId && /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path) && !release?.assets.some(item => item.url === path)) release = await releaseContaining(path);
    const asset = release?.assets.find(item => item.url === path);
    if (!release || !asset) return fetch(request);
    const cache = await caches.open(cacheName(release.build));
    let response = await cache.match(path);
    if (!response) {
      // Eviction must never silently mix a new deployment into an old release.
      try { response = await fetchAsset(asset, undefined, () => {}); await cache.put(path, response.clone()); }
      catch { return new Response('This cached LopeOS file is unavailable. Reconnect and try again. If another LopeOS tab is open, install the latest release from Settings → Software Update.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    }
    if (navigation && event.resultingClientId) await pin(event.resultingClientId, release.build);
    return response;
  })());
});
