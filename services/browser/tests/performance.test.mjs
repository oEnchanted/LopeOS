import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCachedLookup, publicDestination } from '../src/network.mjs';
import { BrowserEngine } from '../src/engine.mjs';
import { createBrowserServer } from '../src/server.mjs';

test('parallel cold connections share DNS work, expire answers and retry failed lookups', async () => {
  let calls = 0, time = 0, release;
  const addresses = [{ address: '8.8.8.8', family: 4 }];
  const lookup = createCachedLookup({ now: () => time, ttl: 100, resolve: async () => {
    calls++; if (calls === 1) await new Promise(resolve => { release = resolve; });
    if (calls === 3) throw new Error('Temporary DNS failure');
    return addresses;
  } });
  const options = { resolve: lookup };
  const connections = Array.from({ length: 12 }, () => publicDestination('example.com', 443, options));
  await Promise.resolve(); assert.equal(calls, 1); release();
  assert.deepEqual(await Promise.all(connections), Array(12).fill({ ...addresses[0], port: 443 }));
  await publicDestination('example.com', 443, options); assert.equal(calls, 1);
  time = 101; await publicDestination('example.com', 443, options); assert.equal(calls, 2);
  time = 202; await assert.rejects(publicDestination('example.com', 443, options), /Temporary DNS failure/);
  await publicDestination('example.com', 443, options); assert.equal(calls, 4);
  // Cached answers still pass the destination policy on every connection.
  await assert.rejects(publicDestination('example.com', 22, options), /unavailable/);
  const mixed = createCachedLookup({ resolve: async () => [...addresses, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(publicDestination('mixed.example', 443, { resolve: mixed }), /unavailable/);
  await assert.rejects(publicDestination('mixed.example', 443, { resolve: mixed }), /unavailable/);
});

test('worker readiness probes use the graphics report captured at startup', async t => {
  let probes = 0;
  const graphics = { accelerated: true, renderer: 'Test renderer' };
  const engine = { normal: { status: 'ready' }, version: 'test', streamUrl: '/stream/', graphics,
    cdp: { graphics: async () => { probes++; throw new Error('GPU process busy'); } } };
  const token = 't'.repeat(64), server = createBrowserServer(engine, { token, origins: [] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/browser/health`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).graphics, graphics);
  }
  assert.equal(probes, 0);
});

test('restoration stays responsive and rapid navigation/stop retain the last committed page', {
  skip: process.env.LOPE_TEST_CHROMIUM !== '1', timeout: 45000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-browser-restore-'));
  const requests = [], waiting = new Set();
  const fixture = createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/slow')) waiting.add(res);
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Background page</title><h1>Loaded on demand</h1>'); }
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const profile = join(root, 'profile'); await mkdir(profile);
  await writeFile(join(profile, 'session.json'), JSON.stringify({ version: 1, activeIndex: 0,
    tabs: [{ url: origin + '/slow', pinned: true }, { url: origin + '/background', pinned: false }],
    history: [{ id: 'saved', url: origin + '/background', title: 'Saved background title', visitedAt: 1 }],
  }));
  const executable = process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
  const engine = new BrowserEngine({ executable, dataRoot: profile, headless: true, testOrigins: [origin.slice(7)] });
  let startupTimer;
  t.after(async () => {
    clearTimeout(startupTimer);
    for (const res of waiting) res.end('<title>Slow page</title>');
    await engine.close().catch(() => {}); fixture.closeAllConnections(); fixture.close();
    await rm(root, { recursive: true, force: true });
  });
  // The server deliberately withholds the selected page's first response.
  // Readiness must complete anyway; the old serial restore cannot pass this.
  await Promise.race([engine.start(), new Promise((_, reject) => {
    startupTimer = setTimeout(() => reject(new Error('Website response blocked browser startup')), 15000);
  })]); clearTimeout(startupTimer);
  assert.equal(engine.normal.status, 'ready');
  assert.equal(engine.normal.tabs.length, 2);
  assert.equal(requests.includes('/background'), false);
  const dormant = engine.normal.tabs[1];
  assert.equal(dormant.url, origin + '/background'); assert.equal(dormant.title, 'Saved background title');
  assert.equal(engine.snapshot('normal').tabs.some(tab => '_pendingUrl' in tab), false);
  await engine.command('normal', { type: 'tab.activate', tabId: dormant.id });
  const until = Date.now() + 5000;
  while (dormant.title !== 'Background page' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(dormant.title, 'Background page');
  assert.equal(requests.filter(path => path === '/background').length, 1);

  const waitForRequest = async path => {
    const deadline = Date.now() + 5000;
    while (!requests.includes(path) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(requests.includes(path), `${path} reached the fixture`);
  };
  // Neither request commits. Metadata refreshes must keep the provisional
  // address, and stopping the second must restore the actual background page.
  const first = engine.command('normal', { type: 'navigate', tabId: dormant.id, input: origin + '/slow?first' });
  await waitForRequest('/slow?first');
  await engine.refresh(dormant); await engine.syncActiveTitles();
  assert.equal(dormant.url, origin + '/slow?first'); assert.equal(dormant.loading, true);
  const second = engine.command('normal', { type: 'navigate', tabId: dormant.id, input: origin + '/slow?second' });
  await waitForRequest('/slow?second'); await first;
  assert.equal(dormant.url, origin + '/slow?second');
  await engine.command('normal', { type: 'stop', tabId: dormant.id }); await second;
  assert.equal(dormant.url, origin + '/background');
  assert.equal(dormant.title, 'Background page'); assert.equal(dormant.loading, false); assert.equal(dormant.error, undefined);
});

test('a metadata reply started before a newer navigation cannot overwrite its address', async () => {
  const engine = new BrowserEngine({ dataRoot: '/tmp/unused-browser-refresh-test' });
  const session = engine.normal = engine.makeSession('normal', 'normal');
  const tab = { id: 'tab', _session: session.id, url: 'https://old.example/', title: 'Old page' };
  session.tabs.push(tab); engine.targets.set(tab.id, tab);
  let release;
  engine.send = async () => new Promise(resolve => { release = resolve; });
  const oldRefresh = engine.refresh(tab);
  tab._navigation = 'newer'; tab._navigationUrl = tab.url = 'https://new.example/';
  release({ currentIndex: 0, entries: [{ url: 'https://old.example/', title: 'Old page' }] });
  await oldRefresh;
  assert.equal(tab.url, 'https://new.example/');
  assert.equal(session.revision, 0);
});
