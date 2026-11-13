import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createAccountServer } from '../../services/accounts/server.mjs';

const directory = await mkdtemp(join(tmpdir(), 'lope-accounts-browser-'));
const origin = 'http://127.0.0.1:5207';
let accounts, vite, browser;
try {
  accounts = await createAccountServer({ directory, origins: [origin] });
  await new Promise(resolve => accounts.server.listen(0, '127.0.0.1', resolve));
  // This fixture uses a different Vite config; never invalidate a running desktop's dependency cache.
  vite = await createServer({ configFile: false, cacheDir: join(directory, '.vite'), server: { host: '127.0.0.1', port: 5207, strictPort: true, proxy: { '/api/accounts': `http://127.0.0.1:${accounts.server.address().port}` } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext(), contextB = await browser.newContext();
  async function open(context) {
    const page = await context.newPage();
    await page.route('**/api/**', route => route.request().url().includes('/api/accounts/') ? route.continue() : route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Workspace offline in account test' } }) }));
    await page.goto(origin + '/tests/accounts/harness.html');
    await page.waitForFunction(() => !!window.accountTest);
    return page;
  }
  const a = await open(contextA), b = await open(contextB);
  const local = await a.evaluate(async () => {
    const { drive, moveToTrash, listTrash, restoreTrashItem, DRIVE_TRASH_PATH, preferences } = window.accountTest;
    await drive.mkdir('/LopeDrive/Documents');
    const first = await drive.write('/LopeDrive/Documents/hello.txt', 'guest content');
    await drive.write('/LopeDrive/Documents/hello.txt', 'guest edits', first.version);
    let stale = false;
    try { await drive.write('/LopeDrive/Documents/hello.txt', 'lost update', first.version); } catch (e) { stale = e.code === 'CONFLICT'; }
    const race = await Promise.allSettled([drive.create('/LopeDrive/race.txt', 'one'), drive.create('/LopeDrive/race.txt', 'two')]);
    const trash = await moveToTrash(drive, '/LopeDrive/Documents/hello.txt');
    const trashed = await listTrash(drive, DRIVE_TRASH_PATH);
    await restoreTrashItem(drive, trash);
    await drive.remove('/LopeDrive/race.txt');
    preferences.set('theme', 'dark'); preferences.set('calculator.mode', 'scientific');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lope.writer.recovery.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('documents', 'readwrite');
      tx.objectStore('documents').put({ id: 'guest-draft', title: 'My guest draft', data: new Uint8Array([0, 1, 127, 255]), updatedAt: '2026-11-13T00:00:00Z' });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); database.close();
    const photos = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lope.photo-library.v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('assets', { keyPath: 'id' }).createIndex('hash', 'hash');
        request.result.createObjectStore('originals');
        request.result.createObjectStore('albums', { keyPath: 'id' });
        request.result.createObjectStore('jobs', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = photos.transaction(['assets', 'originals'], 'readwrite');
      tx.objectStore('assets').put({ id: 'guest-photo', hash: 'photo-hash', title: 'Guest photo' });
      tx.objectStore('originals').put(new Blob([new Uint8Array([137, 80, 78, 71, 255])], { type: 'image/png' }), 'guest-photo');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); photos.close();
    localStorage.setItem('lope.accounts.v1', 'sensitive legacy password hashes are excluded');
    return { stale, winners: race.filter(r => r.status === 'fulfilled').length, trashed: trashed.length, restored: (await drive.read('/LopeDrive/Documents/hello.txt')).content };
  });
  assert.deepEqual(local, { stale: true, winners: 1, trashed: 1, restored: 'guest edits' });
  console.log('PASS guest persistence, version conflicts, concurrent writes, recoverable Trash');

  await a.evaluate(async () => { const { cloudAccount } = window.accountTest; await cloudAccount.register({ displayName: 'Cloud Tester', accountName: 'cloudtester', password: 'correct-horse-battery' }); await cloudAccount.syncNow(); });
  const manifest = await a.evaluate(async () => (await fetch('/api/accounts/manifest')).json());
  assert.ok(manifest.entries.some(entry => entry.key === 'drive:file:/LopeDrive/Documents/hello.txt'));
  assert.ok(!manifest.entries.some(entry => entry.key.includes('lope.accounts') || entry.key.includes('password')));
  assert.equal(manifest.quotaBytes, 1_000_000_000);
  console.log('PASS signup backs up existing guest files and app settings; credentials excluded');

  await b.evaluate(async () => { const { cloudAccount } = window.accountTest; await cloudAccount.signIn('cloudtester', 'correct-horse-battery'); await cloudAccount.syncNow(); });
  assert.equal(await b.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/Documents/hello.txt')).content), 'guest edits');
  assert.equal(await b.evaluate(() => window.accountTest.preferences.getSnapshot().theme), 'dark');
  assert.equal(await b.evaluate(() => window.accountTest.preferences.get('calculator.mode', '')), 'scientific');
  assert.deepEqual(await b.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lope.writer.recovery.v1'); request.onsuccess = () => resolve(request.result); });
    const draft = await new Promise(resolve => { const request = db.transaction('documents').objectStore('documents').get('guest-draft'); request.onsuccess = () => resolve(request.result); });
    db.close(); return { title: draft.title, data: [...draft.data] };
  }), { title: 'My guest draft', data: [0, 1, 127, 255] });
  assert.deepEqual(await b.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lope.photo-library.v1'); request.onsuccess = () => resolve(request.result); });
    const photo = await new Promise(resolve => { const request = db.transaction('originals').objectStore('originals').get('guest-photo'); request.onsuccess = () => resolve(request.result); });
    db.close(); return { type: photo.type, data: [...new Uint8Array(await photo.arrayBuffer())] };
  }), { type: 'image/png', data: [137, 80, 78, 71, 255] });
  console.log('PASS second device restores files, settings, app preferences, Writer binary draft, and photo Blob');

  await b.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/Documents/hello.txt', 'second device'); await window.accountTest.cloudAccount.syncNow(); });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await a.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/Documents/hello.txt')).content), 'second device');
  await b.evaluate(async () => { await window.accountTest.drive.remove('/LopeDrive/Documents/hello.txt'); await window.accountTest.cloudAccount.syncNow(); });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await a.evaluate(async () => { try { await window.accountTest.drive.stat('/LopeDrive/Documents/hello.txt'); return true; } catch { return false; } }), false);
  console.log('PASS two-way updates and deletions');

  await a.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/conflict.txt', 'original'); await window.accountTest.cloudAccount.syncNow(); });
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await a.evaluate(() => window.accountTest.drive.write('/LopeDrive/conflict.txt', 'first local edit'));
  await b.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/conflict.txt', 'second remote edit'); await window.accountTest.cloudAccount.syncNow(); });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await a.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/conflict.txt')).content), 'second remote edit');
  assert.equal(await a.evaluate(async () => {
    const { drive } = window.accountTest;
    for (const entry of await drive.list('/LopeDrive/Conflicts')) if ((await drive.read(entry.path)).content === 'first local edit') return true;
    return false;
  }), true);
  console.log('PASS concurrent edits retain the other version in LopeDrive/Conflicts');

  await a.evaluate(async () => { await window.accountTest.drive.mkdir('/LopeDrive/Concurrent'); await window.accountTest.cloudAccount.syncNow(); });
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await a.evaluate(async () => { await window.accountTest.drive.remove('/LopeDrive/Concurrent'); await window.accountTest.cloudAccount.syncNow(); });
  await b.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/Concurrent/new.txt', 'child survives parent deletion'); await window.accountTest.cloudAccount.syncNow(); });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await a.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/Concurrent/new.txt')).content), 'child survives parent deletion');
  console.log('PASS new children preserve concurrently deleted parent folders');

  await a.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/type-conflict', 'original file'); await window.accountTest.cloudAccount.syncNow(); });
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await a.evaluate(async () => { const { drive, cloudAccount } = window.accountTest; await drive.remove('/LopeDrive/type-conflict'); await drive.mkdir('/LopeDrive/type-conflict'); await drive.write('/LopeDrive/type-conflict/child.txt', 'folder child'); await cloudAccount.syncNow(); });
  await b.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/type-conflict', 'edited file survives'); await window.accountTest.cloudAccount.syncNow(); });
  assert.equal(await b.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/type-conflict/child.txt')).content), 'folder child');
  assert.equal(await b.evaluate(async () => {
    const { drive } = window.accountTest;
    for (const entry of await drive.list('/LopeDrive/Conflicts')) if ((await drive.read(entry.path)).content === 'edited file survives') return true;
    return false;
  }), true);
  console.log('PASS file-versus-folder conflicts preserve both versions');

  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await a.evaluate(async () => { const { drive, cloudAccount } = window.accountTest; await drive.remove('/LopeDrive/Conflicts', { recursive: true }); await drive.write('/LopeDrive/Conflicts', 'user file called Conflicts'); await cloudAccount.syncNow(); });
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await b.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/Conflicts')).content), 'user file called Conflicts');
  await a.evaluate(() => window.accountTest.drive.write('/LopeDrive/conflict.txt', 'third local edit'));
  await b.evaluate(async () => { await window.accountTest.drive.write('/LopeDrive/conflict.txt', 'third remote edit'); await window.accountTest.cloudAccount.syncNow(); });
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.deepEqual(await a.evaluate(async () => {
    const values = [], { drive } = window.accountTest;
    for (const entry of await drive.list('/LopeDrive/Conflicts')) values.push((await drive.read(entry.path)).content);
    return { original: values.includes('user file called Conflicts'), conflict: values.includes('third local edit') };
  }), { original: true, conflict: true });
  console.log('PASS folder-to-file replacement and a user file named Conflicts preserve all contents');

  await contextA.setOffline(true);
  await a.evaluate(() => window.accountTest.drive.write('/LopeDrive/offline.txt', 'offline survives'));
  await contextA.setOffline(false);
  await a.evaluate(() => window.accountTest.cloudAccount.syncNow());
  await b.evaluate(() => window.accountTest.cloudAccount.syncNow());
  assert.equal(await b.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/offline.txt')).content), 'offline survives');
  await a.reload(); await a.waitForFunction(() => !!window.accountTest);
  await a.evaluate(async () => { await window.accountTest.cloudAccount.initialize(); await window.accountTest.cloudAccount.syncNow(); });
  assert.equal(await a.evaluate(() => window.accountTest.cloudAccount.getSnapshot().account.accountName), 'cloudtester');
  await a.evaluate(() => window.accountTest.drive.write('/LopeDrive/automatic.txt', 'saved without pressing sync'));
  await a.waitForFunction(async () => {
    const manifest = await (await fetch('/api/accounts/manifest')).json();
    return manifest.entries.some(entry => entry.key === 'drive:file:/LopeDrive/automatic.txt');
  }, undefined, { timeout: 15_000 });
  console.log('PASS file changes automatically upload without a manual sync');
  console.log('PASS offline changes and cookie session survive reconnect/reload');

  await a.evaluate(() => window.accountTest.cloudAccount.signOut());
  assert.equal(await a.evaluate(async () => (await fetch('/api/accounts/session')).json().then(value => value.account)), null);
  assert.equal(await a.evaluate(async () => (await window.accountTest.drive.read('/LopeDrive/offline.txt')).content), 'offline survives');
  console.log('PASS signout revokes session and preserves local files');

  await a.evaluate(() => window.accountTest.cloudAccount.signIn('cloudtester', 'correct-horse-battery'));
  await contextA.setOffline(true);
  assert.equal(await a.evaluate(async () => { try { await window.accountTest.cloudAccount.signOut(); return false; } catch { return localStorage.getItem('lope.cloud.signout-pending.v1') === '1'; } }), true);
  await a.evaluate(() => window.accountTest.drive.write('/LopeDrive/signed-out-local.txt', 'keep local until explicitly signed back in'));
  await contextA.setOffline(false);
  await a.waitForFunction(() => window.accountTest.cloudAccount.getSnapshot().account === null, undefined, { timeout: 10_000 });
  assert.equal(await a.evaluate(() => localStorage.getItem('lope.cloud.signout-pending.v1')), null);
  assert.equal(await a.evaluate(async () => (await fetch('/api/accounts/session')).json().then(value => value.account)), null);
  assert.equal(await b.evaluate(async () => (await fetch('/api/accounts/manifest')).json().then(value => value.entries.some(entry => entry.key === 'drive:file:/LopeDrive/signed-out-local.txt'))), false);
  console.log('PASS failed offline signout pauses uploads and revokes the session on reconnect');

} finally {
  await browser?.close();
  await vite?.close();
  await accounts?.dispose();
  await rm(directory, { recursive: true, force: true });
}
