import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('LopeDrive aborts an invoked download write when identity changes before its IndexedDB commit', {
  skip: process.env.LOPE_TEST_CHROMIUM !== '1', timeout: 30000,
}, async t => {
  const { chromium } = await import('@playwright/test');
  const { createServer } = await import('vite');
  const cacheDir = await mkdtemp(join(tmpdir(), 'lope-drive-guard-'));
  let web, browser;
  t.after(async () => { await browser?.close(); await web?.close(); await rm(cacheDir, { recursive: true, force: true }); });
  web = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0 } });
  await web.listen();
  const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
  browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  const page = await browser.newPage();
  await page.route('**/drive-guard.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>LopeDrive transaction guard</title>' }));
  await page.goto(origin + '/drive-guard.html');
  const result = await page.evaluate(async () => {
    const { createLopeDriveService } = await import('/packages/runtime-client/src/lope-drive.ts');
    const { mountLopeDrive } = await import('/packages/runtime-client/src/mounted-files.ts');
    const database = 'lope.guard-test.' + crypto.randomUUID();
    const files = mountLopeDrive({}, createLopeDriveService(database));
    await files.mkdir('/LopeDrive/Downloads');
    let current = true, checks = 0;
    const pending = files.writeBinary('/LopeDrive/Downloads/old-account.bin', new Uint8Array([7, 11, 19]), {
      createOnly: true,
      assertCurrent: () => { checks++; if (!current) throw new Error('Account changed before commit'); },
    });
    // The write has started and is awaiting real IndexedDB, beyond the app's outer guard.
    current = false;
    let failure;
    try { await pending; } catch (error) { failure = error.message; }
    let missing = false;
    try { await files.stat('/LopeDrive/Downloads/old-account.bin'); }
    catch (error) { missing = error.code === 'NOT_FOUND'; }
    await new Promise((resolve, reject) => { const deletion = indexedDB.deleteDatabase(database); deletion.onsuccess = resolve; deletion.onerror = () => reject(deletion.error); });
    return { failure, checks, missing };
  });
  assert.equal(result.failure, 'Account changed before commit');
  assert.equal(result.checks, 2);
  assert.equal(result.missing, true);
});
