import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';

export const settings = (page: Page) => page.getByTestId('settings-app');
export const picker = (page: Page) => page.getByLabel('Choose LopeOS backup', { exact: true });
export const review = (page: Page) => page.getByRole('dialog', { name: 'Review LopeOS backup', exact: true });
export const password = 'a saved workspace';

export async function seedWorkspace(page: Page, withData = false) {
  const fs = await installContractRuntime(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
  // Seed once, rather than an init script that would silently sign in after restore.
  await page.evaluate(async ({ password, withData }) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, key, 256);
    const credential = { algorithm: 'PBKDF2-HMAC-SHA-256', iterations: 600000, salt: btoa(String.fromCharCode(...salt)), hash: btoa(String.fromCharCode(...new Uint8Array(bits))) };
    const common = { role: 'admin', avatarDataUrl: null, passwordHint: '', createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: null };
    localStorage.setItem('lope.accounts.v1', JSON.stringify({ version: 1, accounts: [
      { ...common, id: 'backup-alex', accountName: 'alex', displayName: 'Alex Morgan', password: credential },
      { ...common, id: 'backup-sam', accountName: 'sam', displayName: 'Sam Lee', password: null },
    ] }));
    localStorage.setItem('lope.preferences.user.backup-alex.v2', JSON.stringify({ version: 2, preferences: { theme: 'dark', dockPosition: 'left', wallpaper: withData ? 'personal' : 'perfecthue-dark', restoreLayout: true } }));
    localStorage.setItem('lope.preferences.user.backup-sam.v2', JSON.stringify({ version: 2, preferences: { theme: 'light', dockPosition: 'right' } }));
    sessionStorage.setItem('lope.account.session.v1', 'backup-alex');
    localStorage.setItem('unrelated-application', 'leave this alone');
    if (!withData) return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    localStorage.setItem('lope.assets.wallpapers.v1', JSON.stringify({ personalWallpaper: {
      id: 'personal', name: 'My wallpaper.png', originalName: 'My wallpaper.png', asset: canvas.toDataURL('image/png'),
      creator: 'Personal image', sourceURL: null, creditURL: null, permission: 'original', kind: 'light', importedAt: '2026-11-13T00:00:00.000Z',
    } }));
    localStorage.setItem('lope.session.documents.v1', JSON.stringify({ 'editor.document.notes': { text: 'A local draft' } }));
    const populate = (name: string, version: number, upgrade: (db: IDBDatabase) => void, write: (tx: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction([...db.objectStoreNames], 'readwrite');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        write(tx);
      };
    });
    await populate('lope.photo-library.v1', 1, db => {
      db.createObjectStore('assets', { keyPath: 'id' }).createIndex('hash', 'hash', { unique: false });
      db.createObjectStore('originals'); db.createObjectStore('albums', { keyPath: 'id' }); db.createObjectStore('jobs', { keyPath: 'id' });
    }, tx => {
      tx.objectStore('originals').put(new Blob([new Uint8Array([0, 255, 128, 42])], { type: 'image/png' }), 'photo-1');
      tx.objectStore('albums').put({ id: 'album-1', name: 'My photos', type: 'album' });
    });
    await populate('lope.writer.recovery.v1', 1, db => db.createObjectStore('documents', { keyPath: 'id' }), tx => {
      tx.objectStore('documents').put({ id: 'word-draft', bytes: new Uint8Array([80, 75, 0, 255]), path: null, version: null, title: 'Unsaved document', savedAt: '2026-11-13T00:00:00.000Z', launchPath: '', preserveOriginal: false });
    });
    await populate('lope.photo-ai-models.v1', 1, db => db.createObjectStore('packages', { keyPath: 'id' }), tx => {
      tx.objectStore('packages').put({ id: 'downloaded-model', data: new Blob(['cached model']) });
    });
  }, { password, withData });
  await page.reload();
  await expect(page.locator('.desktop')).toHaveAttribute('data-account-name', 'alex');
  return fs;
}

export async function openBackup(page: Page) {
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  if (page.viewportSize()!.width < 700) await settings(page).getByRole('combobox', { name: 'Settings category' }).selectOption('backup');
  else await settings(page).getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Backup & Restore', exact: true }).click();
}

export async function exportFile(page: Page, includeWorkspace = true) {
  await settings(page).getByRole('checkbox', { name: 'Include workspace files', exact: true }).setChecked(includeWorkspace);
  const download = page.waitForEvent('download');
  await settings(page).getByRole('button', { name: 'Export backup', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^lopeos-backup-.*\.lopeos\.json$/);
  return await readFile((await saved.path())!);
}

export async function chooseBackup(page: Page, buffer: Buffer) {
  await picker(page).setInputFiles({ name: 'workspace.lopeos.json', mimeType: 'application/json', buffer });
}

