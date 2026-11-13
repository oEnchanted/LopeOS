import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';

async function accountSetup(page: Page) {
  await installContractRuntime(page, { signedIn: false });
  await page.route('**/api/accounts/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The account server is unavailable. Try again when connected.' } }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  for (let index = 0; index < 4; index++) await page.locator('.setup-panel').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'LopeOS Account' })).toBeVisible();
}

test('an account is optional during setup and after reloading without an account server', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await accountSetup(page);
  await page.getByRole('button', { name: 'Continue without account', exact: true }).click();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.desktop')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lope.setup.complete.v1'))).toBe('1');
  await page.reload();
  await expect(page.locator('.desktop')).toBeVisible();
  await expect(page.locator('.setup-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('registration validates confirmation and password length, shows server failures, and still permits guest use', async ({ page }) => {
  await accountSetup(page);
  const account = page.getByRole('region', { name: 'LopeOS account', exact: true });
  await account.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await expect(account.getByLabel('Account name', { exact: true })).toHaveValue('alexmorgan');
  await account.getByLabel('Password', { exact: true }).fill('short');
  await account.getByLabel('Confirm password', { exact: true }).fill('different');
  await account.getByRole('button', { name: 'Create free account', exact: true }).click();
  await expect(account.getByRole('alert')).toHaveText('The passwords do not match.');
  await account.getByLabel('Confirm password', { exact: true }).fill('short');
  await account.getByRole('button', { name: 'Create free account', exact: true }).click();
  await expect(account.getByRole('alert')).toContainText('at least 12 characters');
  await account.getByLabel('Password', { exact: true }).fill('a long test password');
  await account.getByLabel('Confirm password', { exact: true }).fill('a long test password');
  await account.getByRole('button', { name: 'Create free account', exact: true }).click();
  await expect(account.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Continue without account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review setup' })).toBeVisible();
});

test('Settings uses account sync instead of portable system exports and imports', async ({ page }) => {
  await installContractRuntime(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const settings = page.getByTestId('settings-app');
  const categories = settings.getByRole('navigation', { name: 'Settings categories' });
  await expect(categories.getByRole('button', { name: 'Backup & Restore', exact: true })).toHaveCount(0);
  await categories.getByRole('button', { name: 'LopeOS Account', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Create free account', exact: true })).toBeVisible();
  await expect(settings).toContainText(/1 GB.*cloud storage/);
  for (const category of ['General', 'Privacy & Security']) {
    await categories.getByRole('button', { name: category, exact: true }).click();
    await expect(settings.getByRole('button', { name: /^(Export|Import)/ })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Open account settings', exact: true })).toBeVisible();
  }
});

test('account setup and Settings remain usable at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await accountSetup(page);
  const skip = page.getByRole('button', { name: 'Continue without account', exact: true });
  await expect(skip).toBeVisible();
  const box = await skip.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await skip.click();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const settings = page.getByTestId('settings-app');
  await settings.getByRole('combobox', { name: 'Settings category', exact: true }).selectOption('account');
  await settings.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(settings.getByLabel('Password', { exact: true })).toBeVisible();
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mkdir('docs/accounts', { recursive: true });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: 'docs/accounts/account-signin-mobile.png', animations: 'disabled' });
});

for (const width of [1440, 390]) test(`account and LopeDrive surfaces fit ${width}px with shared glass`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await installContractRuntime(page);
  await page.route('**/api/health', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  let manifest = { revision: 0, entries: [] as { key: string; hash: string; size: number }[], usedBytes: 0, quotaBytes: 1_000_000_000 };
  const blobs = new Map<string, Buffer>();
  const account = { id: 'account-visual-fixture', accountName: 'alexmorgan', displayName: 'Alex Morgan', createdAt: '2026-11-13T00:00:00.000Z' };
  await page.route('**/api/accounts/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path.endsWith('/session')) return json({ account, usedBytes: manifest.usedBytes, quotaBytes: manifest.quotaBytes });
    if (path.endsWith('/manifest')) {
      if (request.method() === 'PUT') { const body = request.postDataJSON(); manifest = { ...manifest, entries: body.entries, revision: manifest.revision + 1, usedBytes: body.entries.reduce((sum: number, item: { size: number }) => sum + item.size, 0) }; }
      return json(manifest);
    }
    if (path.includes('/blobs/')) {
      if (request.method() === 'PUT') { blobs.set(path, request.postDataBuffer()!); return json({ ok: true }); }
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: blobs.get(path) || Buffer.alloc(0) });
    }
    return json({ ok: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const settings = page.getByTestId('settings-app');
  if (width === 390) await settings.getByRole('combobox', { name: 'Settings category', exact: true }).selectOption('account');
  else await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'LopeOS Account', exact: true }).click();
  await expect(settings).toContainText('Alex Morgan');
  await expect(settings.getByRole('meter', { name: 'Cloud storage used', exact: true })).toBeVisible();
  await expect(settings.locator('.account-status-heading')).toContainText('Up to date');
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mkdir('docs/accounts', { recursive: true });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: `docs/accounts/account-${width}.png`, animations: 'disabled' });
  await page.locator('[data-app-id="lope.settings"] .window-titlebar').getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open Files', exact: true }).click();
  const files = page.getByTestId('files-app');
  await files.getByRole('button', { name: 'LopeDrive', exact: true }).first().click();
  await files.locator('input[type=file]').setInputFiles({ name: 'Welcome to LopeDrive.txt', mimeType: 'text/plain', buffer: Buffer.from('This file syncs with your LopeOS account.') });
  await expect(files.getByRole('button', { name: 'Welcome to LopeDrive.txt, file', exact: true })).toBeVisible();
  await expect(files.locator('.account-status-heading')).toContainText('Up to date');
  expect(await files.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `docs/accounts/lopedrive-${width}.png`, animations: 'disabled' });
});
