import { test, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';

test('a local storage quota failure rolls back accounts, preferences, and all binary database stores', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installContractRuntime(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/web/src/backup/local-data.ts';
    const { captureLocalData, encodeLocalValue, restoreLocalData } = await import(/* @vite-ignore */ modulePath);
    const account = {
      id: 'rollback-user', accountName: 'alex', displayName: 'Original account', role: 'admin',
      avatarDataUrl: null, passwordHint: '', password: null,
      createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: null,
    };
    localStorage.setItem('lope.accounts.v1', JSON.stringify({ version: 1, accounts: [account] }));
    localStorage.setItem('lope.preferences.user.rollback-user.v2', JSON.stringify({ version: 2, preferences: { theme: 'light', dockSize: 48 } }));
    localStorage.setItem('other-application', 'keep this value');
    const populate = (name: string, version: number, upgrade: (database: IDBDatabase) => void, write: (transaction: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
      const opened = indexedDB.open(name, version);
      opened.onerror = () => reject(opened.error);
      opened.onupgradeneeded = () => upgrade(opened.result);
      opened.onsuccess = () => {
        const database = opened.result, transaction = database.transaction([...database.objectStoreNames], 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
        write(transaction);
      };
    });
    await populate('lope.photo-library.v1', 1, database => {
      database.createObjectStore('assets', { keyPath: 'id' }).createIndex('hash', 'hash');
      database.createObjectStore('originals'); database.createObjectStore('albums', { keyPath: 'id' }); database.createObjectStore('jobs', { keyPath: 'id' });
    }, transaction => {
      transaction.objectStore('originals').put(new Blob([new Uint8Array([1, 0, 255, 2])], { type: 'image/png' }), 'photo');
      transaction.objectStore('albums').put({ id: 'album', name: 'Original album' });
    });
    await populate('lope.writer.recovery.v1', 1, database => database.createObjectStore('documents', { keyPath: 'id' }), transaction => {
      transaction.objectStore('documents').put({ id: 'draft', bytes: new Uint8Array([80, 75, 7]), title: 'Original draft' });
    });
    await populate('lope.image-editor', 2, database => {
      for (const name of ['recovery', 'sessions', 'documents', 'assets']) {
        const store = database.createObjectStore(name, { keyPath: 'id' });
        if (name === 'assets' || name === 'documents') store.createIndex('windowId', 'windowId');
      }
    }, transaction => {
      transaction.objectStore('assets').put({ id: 'pixels', windowId: 'image-window', data: new Uint8ClampedArray([0, 128, 255, 255]) });
    });
    const before = await captureLocalData(), candidate = structuredClone(before);
    candidate.storage['lope.accounts.v1'] = JSON.stringify({ version: 1, accounts: [{ ...account, displayName: 'Imported account' }] });
    candidate.storage['lope.preferences.user.rollback-user.v2'] = JSON.stringify({ version: 2, preferences: { theme: 'dark', dockSize: 60 } });
    candidate.storage['lope.writer.autosave'] = 'false';
    for (const database of candidate.databases) for (const store of database.stores) for (const record of store.records) {
      record.value = await encodeLocalValue(database.name === 'lope.photo-library.v1' && store.name === 'originals'
        ? new Blob(['replacement photo'], { type: 'image/jpeg' })
        : { id: record.key, title: 'Replacement data', bytes: new Uint8Array([9]), data: new Uint8ClampedArray([9]) });
    }
    const setItem = Storage.prototype.setItem;
    let injected = false, message = '';
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'lope.accounts.v1' && !injected) {
        injected = true;
        throw new DOMException('Simulated storage capacity failure', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
    try { await restoreLocalData(candidate); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { Storage.prototype.setItem = setItem; }
    const after = await captureLocalData();
    const read = (name: string, store: string, key: IDBValidKey) => new Promise<any>((resolve, reject) => {
      const opened = indexedDB.open(name);
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const database = opened.result, request = database.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => { database.close(); resolve(request.result); };
        request.onerror = () => { database.close(); reject(request.error); };
      };
    });
    const photo = await read('lope.photo-library.v1', 'originals', 'photo');
    const draft = await read('lope.writer.recovery.v1', 'documents', 'draft');
    const image = await read('lope.image-editor', 'assets', 'pixels');
    return {
      injected, message, before, after, unrelated: localStorage.getItem('other-application'),
      photo: { blob: photo instanceof Blob, type: photo.type, bytes: [...new Uint8Array(await photo.arrayBuffer())] },
      draft: { typed: draft.bytes instanceof Uint8Array, bytes: [...draft.bytes] },
      image: { clamped: image.data instanceof Uint8ClampedArray, bytes: [...image.data] },
    };
  });
  expect(result.injected).toBe(true);
  expect(result.message).toContain('Previous browser data has been restored');
  expect(result.after).toEqual(result.before);
  expect(result.unrelated).toBe('keep this value');
  expect(result.photo).toEqual({ blob: true, type: 'image/png', bytes: [1, 0, 255, 2] });
  expect(result.draft).toEqual({ typed: true, bytes: [80, 75, 7] });
  expect(result.image).toEqual({ clamped: true, bytes: [0, 128, 255, 255] });
  expect(pageErrors).toEqual([]);
});
