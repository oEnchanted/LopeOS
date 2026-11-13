import { test, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { settings, review, password, seedWorkspace, openBackup, exportFile, chooseBackup } from './helpers';

test('a downloaded backup restores accounts, passwords, appearance, binary files, and browser drafts during setup', async ({ page, browser }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const original = await seedWorkspace(page, true);
  original.externalWrite('/Documents/greeting.txt', 'A portable workspace\n');
  await page.evaluate(async () => {
    const response = await fetch('/api/fs/write', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/Documents/raw.bin', data: btoa(String.fromCharCode(0, 1, 255, 128)), createOnly: true }) });
    if (!response.ok) throw new Error('Could not seed binary workspace file.');
  });
  await openBackup(page);
  await settings(page).screenshot({ path: testInfo.outputPath('settings-desktop.png') });
  const buffer = await exportFile(page);
  const archive = JSON.parse(buffer.toString());
  expect(archive.local.storage).not.toHaveProperty('unrelated-application');
  expect(archive.local.storage).not.toHaveProperty('lope.account.session.v1');
  expect(archive.local.databases.map((database: { name: string }) => database.name)).not.toContain('lope.photo-ai-models.v1');
  expect(JSON.parse(archive.local.storage['lope.accounts.v1']).accounts).toHaveLength(2);
  expect(buffer.toString()).not.toContain(password);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: new URL(page.url()).origin });
  try {
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
    const restoredFiles = await installContractRuntime(target, { signedIn: false });
    await target.goto('/');
    await expect(target.getByRole('button', { name: 'Import backup…', exact: true })).toBeVisible();
    await target.evaluate(() => localStorage.setItem('unrelated-application', 'target data'));
    await chooseBackup(target, buffer);
    await expect(review(target)).toBeVisible();
    const reviewBounds = await review(target).boundingBox();
    expect(reviewBounds).not.toBeNull(); expect(reviewBounds!.x).toBeGreaterThanOrEqual(0);
    expect(reviewBounds!.x + reviewBounds!.width).toBeLessThanOrEqual(390);
    expect(await target.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await target.screenshot({ path: testInfo.outputPath('setup-review-mobile.png') });
    await target.setViewportSize({ width: 1440, height: 900 });
    await target.screenshot({ path: testInfo.outputPath('setup-review-desktop.png') });
    await target.setViewportSize({ width: 390, height: 844 });
    await review(target).getByRole('button', { name: 'Import and restart', exact: true }).click();
    await expect(target.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    const restored = await target.evaluate(async () => {
      const read = (database: string, store: string, key: IDBValidKey) => new Promise<any>((resolve, reject) => {
        const opened = indexedDB.open(database);
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result, request = db.transaction(store).objectStore(store).get(key);
          request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => { db.close(); reject(request.error); };
        };
      });
      const original = await read('lope.photo-library.v1', 'originals', 'photo-1');
      const draft = await read('lope.writer.recovery.v1', 'documents', 'word-draft');
      const response = await fetch('/api/fs/read?path=/Documents/raw.bin');
      return {
        accounts: localStorage.getItem('lope.accounts.v1'), session: sessionStorage.getItem('lope.account.session.v1'),
        wallpaper: localStorage.getItem('lope.assets.wallpapers.v1'), layout: localStorage.getItem('lope.session.layout.v1'),
        preferences: localStorage.getItem('lope.preferences.user.backup-sam.v2'), unrelated: localStorage.getItem('unrelated-application'),
        photo: { blob: original instanceof Blob, type: original.type, bytes: [...new Uint8Array(await original.arrayBuffer())] },
        draft: { typed: draft.bytes instanceof Uint8Array, bytes: [...draft.bytes], title: draft.title },
        binary: (await response.json()).data,
      };
    });
    expect(restored.accounts).toBe(archive.local.storage['lope.accounts.v1']);
    expect(restored.wallpaper).toBe(archive.local.storage['lope.assets.wallpapers.v1']);
    expect(restored.layout).toBe(archive.local.storage['lope.session.layout.v1']);
    expect(restored.preferences).toBe(archive.local.storage['lope.preferences.user.backup-sam.v2']);
    expect(restored.session).toBeNull(); expect(restored.unrelated).toBe('target data');
    expect(restored.photo).toEqual({ blob: true, type: 'image/png', bytes: [0, 255, 128, 42] });
    expect(restored.draft).toEqual({ typed: true, bytes: [80, 75, 0, 255], title: 'Unsaved document' });
    expect(Buffer.from(restored.binary, 'base64')).toEqual(Buffer.from([0, 1, 255, 128]));
    expect(restoredFiles.text('/Documents/greeting.txt')).toBe('A portable workspace\n');
    await target.getByLabel('Password', { exact: true }).fill('incorrect');
    await target.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(target.getByRole('alert')).toContainText('incorrect');
    await target.getByLabel('Password', { exact: true }).fill(password);
    await target.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(target.locator('.desktop')).toHaveAttribute('data-theme', 'dark');
    await expect(target.locator('.desktop')).toHaveAttribute('data-wallpaper', 'personal');
    await expect(target.locator('.dock')).toHaveAttribute('data-position', 'left');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('malformed and unsupported backup files do not alter setup data', async ({ page }) => {
  await installContractRuntime(page, { signedIn: false }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  for (const buffer of [Buffer.from('{broken'), Buffer.from(JSON.stringify({ format: 'lopeos-backup', version: 99 })), Buffer.from(JSON.stringify({ version: 2, preferences: { theme: 'dark' } }))]) {
    await chooseBackup(page, buffer);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(review(page)).toHaveCount(0);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(before);
  }
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeEnabled();
});

test('canceling review leaves the current accounts and preferences intact', async ({ page }) => {
  await seedWorkspace(page); await openBackup(page);
  const buffer = await exportFile(page, false);
  const before = await page.evaluate(() => ({ accounts: localStorage.getItem('lope.accounts.v1'), preferences: localStorage.getItem('lope.preferences.user.backup-alex.v2'), session: sessionStorage.getItem('lope.account.session.v1') }));
  await chooseBackup(page, buffer); await expect(review(page)).toBeVisible();
  await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  expect(await page.evaluate(() => ({ accounts: localStorage.getItem('lope.accounts.v1'), preferences: localStorage.getItem('lope.preferences.user.backup-alex.v2'), session: sessionStorage.getItem('lope.account.session.v1') }))).toEqual(before);
});

test('conflicting workspace files abort restore without replacing local accounts or existing files', async ({ page }) => {
  const fs = await seedWorkspace(page); await openBackup(page);
  const buffer = await exportFile(page);
  fs.externalWrite('/Documents/hello.txt', 'New work created after the backup');
  await page.evaluate(() => {
    const key = 'lope.preferences.user.backup-alex.v2', value = JSON.parse(localStorage.getItem(key)!);
    value.preferences.profileName = 'Keep the current profile'; localStorage.setItem(key, JSON.stringify(value));
  });
  const before = await page.evaluate(() => ({ accounts: localStorage.getItem('lope.accounts.v1'), preferences: localStorage.getItem('lope.preferences.user.backup-alex.v2'), session: sessionStorage.getItem('lope.account.session.v1') }));
  await chooseBackup(page, buffer); await review(page).getByRole('button', { name: 'Import and restart', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/conflict|different|already exists/i);
  expect(fs.text('/Documents/hello.txt')).toBe('New work created after the backup');
  expect(await page.evaluate(() => ({ accounts: localStorage.getItem('lope.accounts.v1'), preferences: localStorage.getItem('lope.preferences.user.backup-alex.v2'), session: sessionStorage.getItem('lope.account.session.v1') }))).toEqual(before);
  await expect(page.locator('.desktop')).toHaveAttribute('data-account-name', 'alex');
});

test('an unavailable workspace prevents an incomplete export and allows an explicit browser-only backup', async ({ page }) => {
  const fs = await seedWorkspace(page); await openBackup(page); fs.setDisconnected(true);
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await settings(page).getByRole('button', { name: 'Export backup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/could not|unavailable|disconnected/i);
  expect(downloads).toEqual([]);
  const archive = JSON.parse((await exportFile(page, false)).toString());
  expect(archive.workspace).toBeNull(); expect(JSON.parse(archive.local.storage['lope.accounts.v1']).accounts).toHaveLength(2);
});

test('backup controls fit narrow Settings and setup screens', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 }); await seedWorkspace(page); await openBackup(page);
  await expect(settings(page).getByRole('button', { name: 'Export backup', exact: true })).toBeVisible();
  expect(await settings(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
  const context = await browser.newContext({ viewport: { width: 390, height: 600 }, baseURL: new URL(page.url()).origin });
  try {
    const setup = await context.newPage(); await installContractRuntime(setup, { signedIn: false }); await setup.goto('/');
    await expect(setup.getByRole('button', { name: 'Import backup…', exact: true })).toBeVisible();
    const footer = await setup.getByRole('button', { name: 'Get started', exact: true }).boundingBox();
    expect(footer).not.toBeNull(); expect(footer!.y + footer!.height).toBeLessThanOrEqual(600);
    expect(await setup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await context.close(); }
});
