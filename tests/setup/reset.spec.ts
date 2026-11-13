import { test, expect, type Page } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { panel, reachAccount, reviewAccount } from './helpers';

const accountId = 'factory-reset-user';
const userPreferencesKey = `lope.preferences.user.${accountId}.v2`;
const resetKey = 'lope.reset.pending.v1';

/** Seed once through the page, so a reset reload cannot recreate the erased account. */
async function signedInWorkspace(page: Page) {
  const runtime = await installContractRuntime(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
  await page.evaluate(({ accountId, userPreferencesKey }) => {
    localStorage.setItem('lope.accounts.v1', JSON.stringify({ version: 1, accounts: [{
      id: accountId, accountName: 'before-reset', displayName: 'Before Reset', role: 'admin',
      avatarDataUrl: null, passwordHint: '', password: null,
      createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: null,
    }] }));
    const preferences = { version: 2, preferences: { theme: 'dark', soundVolume: 17, reduceMotion: false } };
    localStorage.setItem('lope.preferences.v2', JSON.stringify(preferences));
    localStorage.setItem(userPreferencesKey, JSON.stringify(preferences));
    localStorage.setItem('lope.reset-test.draft', 'An old recovery draft');
    localStorage.setItem('another-application.setting', 'keep this');
    sessionStorage.setItem('lope.account.session.v1', accountId);
    sessionStorage.setItem('lope.terminal.reset-test', 'old terminal session');
    sessionStorage.setItem('another-application.session', 'keep this session');
  }, { accountId, userPreferencesKey });
  await page.reload();
  await expect(page.locator('.desktop')).toBeVisible();
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'dark');
  return runtime;
}

async function openResetConfirmation(page: Page) {
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const settings = page.getByTestId('settings-app');
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'General', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset LopeOS…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset LopeOS?', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectFreshSetup(page: Page) {
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.reset-boot')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.setup-screen')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.desktop')).toHaveCount(0);
}

test('canceling a full reset preserves the account, preferences, and local data', async ({ page }) => {
  await signedInWorkspace(page);
  const before = await page.evaluate(key => ({
    account: localStorage.getItem('lope.accounts.v1'),
    preferences: localStorage.getItem(key),
    session: sessionStorage.getItem('lope.account.session.v1'),
    draft: localStorage.getItem('lope.reset-test.draft'),
  }), userPreferencesKey);
  const dialog = await openResetConfirmation(page);
  await expect(dialog).toContainText('removes LopeOS preferences');
  await expect(dialog).toContainText('Cloud backups and remote workspace files are kept');
  await expect(dialog.getByRole('button', { name: 'Erase and restart', exact: true })).not.toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.reset-boot')).toHaveCount(0);
  expect(await page.evaluate(({ key, resetKey }) => ({
    account: localStorage.getItem('lope.accounts.v1'),
    preferences: localStorage.getItem(key),
    session: sessionStorage.getItem('lope.account.session.v1'),
    draft: localStorage.getItem('lope.reset-test.draft'),
    reset: localStorage.getItem(resetKey),
  }), { key: userPreferencesKey, resetKey })).toEqual({ ...before, reset: null });
});

test('full reset shows the boot screen, erases owned storage, and permits a new setup', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const runtime = await signedInWorkspace(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    for (const name of ['lope.writer.recovery.v1', 'lope.photo-library.v1', 'another-application.database']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sentinel');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('sentinel', 'readwrite');
          transaction.objectStore('sentinel').put('saved content', 'entry');
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      });
    }
    for (const name of ['lope-reset-test-cache', 'webllm/model', 'another-application.cache']) {
      await (await caches.open(name)).put('/reset-test-asset', new Response('cached content'));
    }
  });
  const dialog = await openResetConfirmation(page);
  const restarted = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await dialog.getByRole('button', { name: 'Erase and restart', exact: true }).click();
  await restarted;
  const boot = page.locator('.reset-boot');
  await expect(boot).toBeVisible();
  await expect(boot).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(boot).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(boot.locator('svg').first()).toBeVisible();
  await expect(boot.getByRole('progressbar', { name: 'Resetting LopeOS', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reset-boot.png') });
  await expect(boot.getByRole('progressbar', { name: 'Resetting LopeOS', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(boot).toHaveAttribute('data-phase', 'revealing');
  await expect(boot).toHaveCSS('transition-property', 'opacity');
  await expect(boot).toHaveCSS('transition-duration', '0.6s');
  await expectFreshSetup(page);
  await page.screenshot({ path: testInfo.outputPath('reset-setup.png') });

  const state = await page.evaluate(async ({ userPreferencesKey, resetKey }) => ({
    account: localStorage.getItem('lope.accounts.v1'),
    session: sessionStorage.getItem('lope.account.session.v1'),
    userPreferences: localStorage.getItem(userPreferencesKey),
    draft: localStorage.getItem('lope.reset-test.draft'),
    terminal: sessionStorage.getItem('lope.terminal.reset-test'),
    reset: localStorage.getItem(resetKey),
    otherLocal: localStorage.getItem('another-application.setting'),
    otherSession: sessionStorage.getItem('another-application.session'),
    databases: (await indexedDB.databases()).map(database => database.name),
    caches: await caches.keys(),
  }), { userPreferencesKey, resetKey });
  expect(state).toMatchObject({
    account: null, session: null, userPreferences: null, draft: null, terminal: null, reset: null,
    otherLocal: 'keep this', otherSession: 'keep this session',
  });
  expect(state.databases).not.toContain('lope.writer.recovery.v1');
  expect(state.databases).not.toContain('lope.photo-library.v1');
  expect(state.databases).toContain('another-application.database');
  expect(state.caches).not.toContain('lope-reset-test-cache');
  expect(state.caches).not.toContain('webllm/model');
  expect(state.caches).toContain('another-application.cache');
  expect(runtime.text('/Documents/hello.txt')).toBe('Hello from the shared workspace.\n');

  await page.reload();
  await expectFreshSetup(page);
  await reachAccount(page);
  await reviewAccount(page, 'New Start');
  await panel(page).getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.desktop')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lope.accounts.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('lope.setup.complete.v1'))).toBe('1');
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});

test('reset also retires another open desktop tab so old state cannot return', async ({ page, context }) => {
  await signedInWorkspace(page);
  const other = await context.newPage();
  await installContractRuntime(other, { signedIn: false });
  await other.goto('/');
  await other.evaluate(id => sessionStorage.setItem('lope.account.session.v1', id), accountId);
  await other.reload();
  await expect(other.locator('.desktop')).toBeVisible();

  const dialog = await openResetConfirmation(page);
  await dialog.getByRole('button', { name: 'Erase and restart', exact: true }).click();
  await Promise.all([expectFreshSetup(page), expectFreshSetup(other)]);
  expect(await other.evaluate(() => sessionStorage.getItem('lope.account.session.v1'))).toBeNull();
  expect(await other.evaluate(() => localStorage.getItem('lope.accounts.v1'))).toBeNull();
  await other.reload();
  await expectFreshSetup(other);
  await other.close();
});

test('a failed erase stays on the boot screen and can be retried safely', async ({ page }) => {
  await signedInWorkspace(page);
  await page.evaluate(async () => {
    await (await caches.open('lope-reset-retry-test')).put('/reset-retry-asset', new Response('cached content'));
  });
  // This only runs in the clean reset document. The one-shot marker survives a retry.
  await page.addInitScript(() => {
    const deleteCache = CacheStorage.prototype.delete;
    CacheStorage.prototype.delete = function(name: string) {
      if (name === 'lope-reset-retry-test' && !sessionStorage.getItem('reset-test.failed-once')) {
        sessionStorage.setItem('reset-test.failed-once', 'true');
        return Promise.reject(new Error('Simulated cache deletion failure'));
      }
      return deleteCache.call(this, name);
    };
  });
  const dialog = await openResetConfirmation(page);
  await dialog.getByRole('button', { name: 'Erase and restart', exact: true }).click();
  const boot = page.locator('.reset-boot');
  await expect(boot).toHaveAttribute('data-phase', 'error');
  await expect(boot).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(boot.getByRole('heading', { name: 'Reset couldn’t finish.', exact: true })).toBeVisible();
  await expect(page.locator('.setup-screen, .desktop')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), resetKey)).not.toBeNull();
  const retry = boot.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeFocused();
  await retry.click();
  await expectFreshSetup(page);
  expect(await page.evaluate(key => localStorage.getItem(key), resetKey)).toBeNull();
  expect(await page.evaluate(() => caches.keys())).not.toContain('lope-reset-retry-test');
  await page.reload();
  await expectFreshSetup(page);
});
