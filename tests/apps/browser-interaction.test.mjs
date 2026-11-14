import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const newTab = id => ({ id, url: 'about:blank', title: 'New Tab', pinned: false,
  loading: false, canGoBack: false, canGoForward: false, zoom: 1 });
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};

// Run with `node --test tests/apps/browser-interaction.test.mjs`. This renders the
// production Browser component; no remote worker, Selkies or external website is needed.
test('browser responds during connection delays and preserves an interactive stream', { timeout: 120000 }, async t => {
  const { chromium, expect } = await import('@playwright/test');
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const cache = await mkdtemp(join(tmpdir(), 'lope-browser-interaction-'));
  const createReady = deferred(); const pendingNavigations = []; const commands = [];
  const clients = new Set(); let creates = 0; let streamLoads = 0;
  const session = {
    id: 'interaction-session', generation: 'interaction-generation', revision: 1,
    mode: 'normal', status: 'ready', tabs: [newTab('tab-1')], activeTabId: 'tab-1',
    history: [], bookmarks: [], downloads: [], uploads: [], permissions: [],
    searchProvider: 'duckduckgo', engineVersion: 'Chromium interaction fixture',
    streamUrl: '/api/browser/stream/interaction-worker/',
    capabilities: { stream: true, audio: true, deviceForwarding: false, workspaceFiles: false, webgl: true },
  };
  const publish = () => { for (const client of clients) client.write('data: ' + JSON.stringify(session) + '\n\n'); };
  let web; let browser;
  t.after(async () => {
    createReady.resolve(); for (const pending of pendingNavigations) pending.resolve();
    await browser?.close(); for (const client of clients) client.end();
    await web?.close(); await rm(cache, { recursive: true, force: true });
  });
  web = await createServer({
    configFile: false, cacheDir: cache, logLevel: 'error', plugins: [react(), {
      name: 'browser-interaction-fixture',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0];
          if (!path?.startsWith('/api/')) return next();
          void (async () => {
            if (path === '/api/browser/stream/interaction-worker/') {
              streamLoads++;
              response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
              response.end(`<!doctype html><html><body style="margin:0;background:#fff;font:16px system-ui">
                <main style="padding:48px"><h1>Connected website</h1><p>A trusted interactive surface.</p>
                <textarea id="overlayInput" aria-label="Website input" placeholder="Type on the website" style="width:80%;height:180px"></textarea>
                <video id="videoStream"></video></main><script>
                window.fixtureFps = 0; window.fixtureMessages = []; window.fixtureRemoteKeys = [];
                const remoteKey = event => { if (!event.defaultPrevented) window.fixtureRemoteKeys.push(event.key.toLowerCase()); };
                window.webrtcInput = {
                  inputAttached: false,
                  detach_context() { removeEventListener('keydown', remoteKey, true); this.inputAttached = false; },
                  attach_context() { addEventListener('keydown', remoteKey, true); this.inputAttached = true; },
                };
                window.webrtcInput.attach_context();
                window.reportStats = () => parent.postMessage({type:'stats',data:{isVideoPipelineActive:true,clientFps:window.fixtureFps}}, location.origin);
                addEventListener('message', event => {
                  window.fixtureMessages.push(event.data);
                  if (event.data?.type === 'getStats') window.reportStats();
                });
                </script></body></html>`);
              return;
            }
            if (path === '/api/browser/sessions' && request.method === 'POST') {
              creates++; await createReady.promise; json(response, session); return;
            }
            if (path === '/api/browser/sessions/interaction-session/events') {
              response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
              response.write('data: ' + JSON.stringify(session) + '\n\n'); clients.add(response);
              const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 1000);
              response.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
              return;
            }
            if (path === '/api/browser/sessions/interaction-session/activity') { json(response, { alive: true }); return; }
            if (path === '/api/browser/sessions/interaction-session/commands') {
              let body = ''; for await (const chunk of request) body += chunk;
              const command = JSON.parse(body); commands.push(command);
              if (command.type === 'navigate') {
                const ready = deferred(); pendingNavigations.push(ready); await ready.promise;
                const tab = session.tabs.find(item => item.id === command.tabId);
                Object.assign(tab, { url: command.input, title: new URL(command.input).hostname, loading: false });
              } else if (command.type === 'tab.create') {
                const tab = newTab('tab-' + (session.tabs.length + 1)); session.tabs.push(tab); session.activeTabId = tab.id;
              } else if (command.type === 'tab.activate') session.activeTabId = command.tabId;
              else if (command.type === 'tab.close') {
                session.tabs = session.tabs.filter(tab => tab.id !== command.tabId);
                if (session.activeTabId === command.tabId) session.activeTabId = session.tabs[0]?.id ?? null;
              }
              else { json(response, { error: 'Unexpected fixture command: ' + command.type }, 400); return; }
              session.revision++; publish(); json(response, session); return;
            }
            json(response, { error: { message: 'Fixture service unavailable.' } }, 503);
          })().catch(error => { if (!response.headersSent) json(response, { error: String(error) }, 500); else response.end(); });
        });
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
  });
  await web.listen();
  const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.fixtureOpenedUrls = [];
    window.open = url => { window.fixtureOpenedUrls.push(String(url)); return null; };
  });
  const failures = [];
  context.on('page', page => page.on('pageerror', error => failures.push(error.message)));

  // Native opening needs neither a connected worker nor an active network.
  const offline = await context.newPage();
  await offline.goto(origin + '/services/browser/tests/host.html');
  const offlineAddress = offline.getByRole('combobox', { name: 'Search or enter address', exact: true });
  await expect(offlineAddress).toBeVisible(); await expect.poll(() => creates).toBe(1);
  await context.setOffline(true);
  await offlineAddress.fill('example.com/device?q=hello');
  await offline.getByRole('button', { name: 'Open on this device', exact: true }).click();
  await expect.poll(() => offline.evaluate(() => window.fixtureOpenedUrls)).toEqual(['https://example.com/device?q=hello']);
  await offline.getByRole('textbox', { name: 'Search the web', exact: true }).fill('swift canvas examples');
  await offline.getByRole('button', { name: 'Search on this device', exact: true }).click();
  await expect.poll(() => offline.evaluate(() => window.fixtureOpenedUrls)).toEqual([
    'https://example.com/device?q=hello', 'https://duckduckgo.com/?q=swift%20canvas%20examples',
  ]);
  assert.equal(commands.length, 0);
  await offline.screenshot({ path: '/tmp/lope-browser-rework-start.png' });
  await offline.close(); await context.setOffline(false);

  const page = await context.newPage(); await page.clock.install();
  await page.goto(origin + '/services/browser/tests/host.html');
  const address = page.getByRole('combobox', { name: 'Search or enter address', exact: true });
  await expect(address).toBeVisible();
  await address.fill('queued.example/path'); await address.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Opening queued.example/path when connected' })).toBeVisible();
  assert.equal(commands.length, 0);
  createReady.resolve();
  await expect.poll(() => commands[0]).toEqual({ type: 'navigate', tabId: 'tab-1', input: 'https://queued.example/path' });
  await expect(address).toHaveValue('queued.example/path');
  await expect(page.getByRole('progressbar', { name: 'Page loading', exact: true })).toBeVisible();
  assert.equal(session.tabs[0].url, 'about:blank', 'UI acknowledges navigation before the worker response');
  await expect(page.locator('.lope-browser')).toBeFocused();
  assert.equal(await page.evaluate(() => {
    window.fixtureHostShortcuts = [];
    window.addEventListener('keydown', event => { if (event.metaKey && ['f', 'w'].includes(event.key)) window.fixtureHostShortcuts.push(event.key); });
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event); return event.defaultPrevented;
  }), true);
  await expect(page.getByRole('textbox', { name: 'Find in page', exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.fixtureHostShortcuts), []);
  await page.getByRole('button', { name: 'Close find', exact: true }).click();

  const iframe = page.locator('.lb-stream iframe');
  const child = page.frameLocator('.lb-stream iframe');
  await expect(child.locator('#overlayInput')).toBeAttached();
  await expect.poll(() => child.locator('body').evaluate(() => window.fixtureMessages.some(message => message.type === 'getStats'))).toBe(true);
  await page.evaluate(() => { window.fixtureStreamElement = document.querySelector('.lb-stream iframe'); });
  await page.clock.fastForward(8500);
  await expect(page.locator('.lb-stream-cover')).toBeVisible();
  await expect(page.locator('.lb-status')).not.toContainText('Streaming');
  await child.locator('body').evaluate(() => { window.fixtureFps = 60; window.reportStats(); });
  await expect(page.locator('.lb-stream-cover')).toHaveCount(0, { timeout: 1000 });
  await expect(page.locator('.lb-status')).toContainText('Streaming');
  await expect(child.locator('#overlayInput')).toBeFocused();
  pendingNavigations.shift().resolve();
  await expect(page.getByRole('progressbar', { name: 'Page loading', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/lope-browser-rework-page.png' });

  // Shortcuts from inside the same-origin stream reach the local browser chrome.
  await page.keyboard.press('Meta+l'); await expect(address).toBeFocused();
  await child.locator('body').evaluate(() => {
    window.fixtureFps = 0; parent.postMessage({ type: 'pipelineStatusUpdate', video: false }, location.origin);
  });
  await expect(page.locator('.lb-stream-cover')).toBeVisible();
  await child.locator('body').evaluate(() => { window.fixtureFps = 60; window.reportStats(); });
  await expect(page.locator('.lb-stream-cover')).toHaveCount(0);
  await expect(address).toBeFocused(); // Recovering media must not interrupt address editing.
  await child.locator('#overlayInput').focus(); await page.keyboard.press('Meta+t');
  await expect(page.getByRole('heading', { name: 'New Tab', exact: true })).toBeVisible();
  await expect(address).toBeFocused();
  assert.equal(await child.locator('body').evaluate(() => window.fixtureRemoteKeys.includes('t') || window.fixtureRemoteKeys.includes('l')), false,
    'browser shortcuts are intercepted before the pre-existing remote input listener');
  assert.equal(commands.filter(command => command.type === 'tab.create').length, 1);
  assert.equal(await page.evaluate(() => window.fixtureStreamElement === document.querySelector('.lb-stream iframe')), true);
  assert.equal(streamLoads, 1, 'switching to New Tab preserves the warm stream');
  await page.getByRole('tab', { name: 'queued.example', exact: true }).click();
  await expect(child.locator('#overlayInput')).toBeFocused();
  assert.equal(await page.evaluate(() => window.fixtureStreamElement === document.querySelector('.lb-stream iframe')), true);
  await page.keyboard.press('Meta+l'); await expect(address).toBeFocused();
  await address.fill('next.example/instant'); await address.press('Enter');
  await expect(address).toHaveValue('next.example/instant');
  await expect(page.getByRole('progressbar', { name: 'Page loading', exact: true })).toBeVisible();
  await expect(child.locator('#overlayInput')).toBeFocused();
  await expect.poll(() => pendingNavigations.length).toBe(1); pendingNavigations.shift().resolve();
  await expect(page.getByRole('progressbar', { name: 'Page loading', exact: true })).toHaveCount(0);
  assert.equal(await iframe.count(), 1); assert.equal(streamLoads, 1);
  await page.setViewportSize({ width: 420, height: 820 });
  await page.screenshot({ path: '/tmp/lope-browser-rework-narrow.png' });
  await page.locator('.lope-browser').focus();
  assert.equal(await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event); return event.defaultPrevented;
  }), true);
  await expect.poll(() => commands.filter(command => command.type === 'tab.close').length).toBe(1);
  await expect(page.getByRole('heading', { name: 'New Tab', exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.fixtureHostShortcuts), [], 'handled shortcuts never reach the host window listener');
  assert.deepEqual(failures, []);
});
