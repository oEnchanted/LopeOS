import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserEngine } from '../src/engine.mjs';
import { createBrowserServer } from '../src/server.mjs';
import { createFixture } from './fixture.mjs';

test('browser controls operate real tabs and expose unavailable streaming honestly', {
  skip: process.env.LOPE_TEST_CHROMIUM !== '1', timeout: 60000,
}, async t => {
  const { chromium } = await import('@playwright/test');
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { default: sharedConfig } = await import('../../../vite.config.ts');
  const executable = process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
  const root = await mkdtemp(join(tmpdir(), 'lope-ui-')); const fixture = await createFixture();
  const engine = new BrowserEngine({ executable, dataRoot: root, headless: true, testOrigins: [fixture.origin.replace('http://', '')] });
  let worker, web, host;
  t.after(async () => { await host?.close(); await web?.close(); worker?.closeAllConnections(); worker?.close();
    await engine.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); });
  await engine.start(); const token = randomBytes(32).toString('hex'); const origins = [];
  worker = createBrowserServer(engine, { token, origins, hosts: ['127.0.0.1'] }); worker.listen(0,'127.0.0.1'); await once(worker,'listening');
  web = await createServer({ configFile: false, cacheDir: join(root, 'vite-cache'), plugins: [react()], server: { fs: sharedConfig.server.fs, host: '127.0.0.1', port: 0, proxy: {
    '/api/browser': { target: `http://127.0.0.1:${worker.address().port}`, configure: proxy => proxy.on('proxyReq', req => req.setHeader('Authorization', `Bearer ${token}`)) },
  } } });
  await web.listen(); const origin = `http://127.0.0.1:${web.httpServer.address().port}`; origins.push(origin);
  const deniedName = `browser-test-${randomBytes(12).toString('hex')}`;
  const deniedPaths = ['.runtime', '.browser-data'].map(directory => join(process.cwd(), directory, deniedName));
  for (const directory of ['.runtime', '.browser-data']) await mkdir(directory,{recursive:true,mode:0o700});
  for (const path of deniedPaths) await writeFile(path,'Test-only denial fixture',{flag:'wx',mode:0o600});
  t.after(()=>Promise.all(deniedPaths.map(path=>rm(path,{force:true}))));
  for (const path of [`/.runtime/${deniedName}`, `/.browser-data/${deniedName}`, `/@fs${deniedPaths[0]}`]) {
    const response = await fetch(origin + path); assert.equal(response.status,403,path);
  }
  host = await chromium.launch({ executablePath: executable, headless: true, chromiumSandbox: true });
  const page = await host.newPage({ viewport: { width: 1440, height: 1000 } }); const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(origin + '/services/browser/tests/host.html');
  await page.locator('.lb-status').filter({ hasText: 'Engine connected' }).waitFor();
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.lb-tab[draggable]').length === 2);
  const address = page.getByRole('textbox', { name: 'Search or enter address', exact: true });
  await address.fill(fixture.origin); await address.press('Enter');
  await page.getByRole('heading', { name: 'Interactive browsing is unavailable', exact: true }).waitFor();
  await page.locator('.lb-tab.active').filter({ hasText: 'Lope Browser test application' }).waitFor();
  await page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
  await page.getByRole('button', { name: 'Remove bookmark', exact: true }).waitFor();
  assert.equal(engine.normal.bookmarks.length, 1);
  await page.getByRole('button', { name: 'Start page', exact: true }).click();
  await page.getByRole('heading', { name: 'New Tab', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Downloads', exact: true }).click();
  await page.getByRole('complementary', { name: 'downloads panel', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Browser preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Clear browsing data…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear browsing data?', exact: true }); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.locator('.lb-session-chip').click();
  await page.locator('.lb-private-notice').waitFor(); assert.equal(engine.sessions.size, 2);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.locator('.lb-private-notice').waitFor({ state: 'detached' }); assert.equal(engine.sessions.size, 1);
  assert.deepEqual(failures, []);
});
