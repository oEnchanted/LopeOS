import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { credentials, EncryptedVault, recoveryCredentials, type VaultEnvelope } from '../../apps/web/src/accounts/encryption';

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
  await account.getByRole('button', { name: 'Create free account', exact: true }).click();
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

test('registration keeps setup on the recovery key until it is saved', async ({ page }) => {
  await accountSetup(page);
  let vault: VaultEnvelope | undefined;
  const session = () => ({
    account: { id: 'account-recovery-fixture', accountName: 'alexmorgan', displayName: 'Alex Morgan', createdAt: '2026-11-13T00:00:00.000Z' },
    usedBytes: 0, quotaBytes: 1_000_000_000, vault,
  });
  await page.route('**/api/accounts/register', route => {
    vault = route.request().postDataJSON().vault;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(session()) });
  });
  await page.route('**/api/accounts/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) }));
  const account = page.getByRole('region', { name: 'LopeOS account', exact: true });
  await account.getByRole('button', { name: 'Create free account', exact: true }).click();
  await account.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await account.getByLabel('Password', { exact: true }).fill('a long test password');
  await account.getByLabel('Confirm password', { exact: true }).fill('a long test password');
  await account.getByLabel('Confirm password', { exact: true }).press('Enter');

  const recovery = page.getByRole('region', { name: 'Save your recovery key', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByLabel('Recovery key', { exact: true })).toHaveText(/^[a-f0-9]{8}(?:-[a-f0-9]{8}){7}$/);
  await expect(recovery.getByRole('heading')).toBeFocused();
  const continueButton = recovery.getByRole('button', { name: 'Continue to LopeOS', exact: true });
  await expect(continueButton).toBeDisabled();
  await expect(page.locator('.setup-footer button[type="submit"]')).toBeDisabled();
  for (const step of await page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button').all()) await expect(step).toBeDisabled();

  const download = page.waitForEvent('download');
  await recovery.getByRole('button', { name: 'Download recovery key', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('LopeOS-recovery-key.txt');
  await expect(continueButton).toBeDisabled();
  await recovery.getByRole('checkbox', { name: 'I saved my recovery key somewhere safe.', exact: true }).check();
  await continueButton.click();
  await expect(page.getByRole('heading', { name: 'Review setup', exact: true })).toBeVisible();
  await expect(page.locator('.setup-panel')).toContainText('@alexmorgan');
});

test('Enter submits sign in and password recovery without advancing setup', async ({ page }) => {
  await accountSetup(page);
  const created = await EncryptedVault.create('alexmorgan', 'original test password');
  created.vault.destroy();
  const loginRequests: unknown[] = [], recoveryRequests: unknown[] = [];
  await page.route('**/api/accounts/login', route => {
    loginRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'That account name or password is incorrect.' } }) });
  });
  await page.route('**/api/accounts/recover', route => {
    recoveryRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/accounts/recovery-info', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ vault: created.envelope }) }));
  const account = page.getByRole('region', { name: 'LopeOS account', exact: true });
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await account.getByLabel('Account name', { exact: true }).fill('AlexMorgan');
  await account.getByLabel('Password', { exact: true }).fill('incorrect password');
  await account.getByLabel('Password', { exact: true }).press('Enter');
  await expect(account.getByRole('alert')).toHaveText('That account name or password is incorrect.');
  expect(loginRequests).toEqual([{ accountName: 'alexmorgan', credentialVersion: 1, password: (await credentials('alexmorgan', 'incorrect password')).password }]);
  await expect(page.getByRole('heading', { name: 'Review setup', exact: true })).toHaveCount(0);

  await account.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await account.getByLabel('Recovery key', { exact: true }).fill(created.recoveryKey);
  await account.getByLabel('New password', { exact: true }).fill('a new long test password');
  await account.getByLabel('Confirm password', { exact: true }).fill('a new long test password');
  await account.getByLabel('Confirm password', { exact: true }).press('Enter');
  const recovery = page.getByRole('region', { name: 'Save your recovery key', exact: true });
  await expect(recovery.getByLabel('Recovery key', { exact: true })).toHaveText(/^[a-f0-9]{8}(?:-[a-f0-9]{8}){7}$/);
  await expect(recovery.getByLabel('Recovery key', { exact: true })).not.toHaveText(created.recoveryKey);
  expect(recoveryRequests).toEqual([expect.objectContaining({ accountName: 'alexmorgan', credentialVersion: 1, recoveryKey: (await recoveryCredentials(created.recoveryKey)).proof, password: (await credentials('alexmorgan', 'a new long test password')).password })]);
  await expect(page.getByRole('heading', { name: 'Review setup', exact: true })).toHaveCount(0);
  await expect(recovery.getByRole('button', { name: 'Continue to sign in', exact: true })).toBeDisabled();
  await recovery.getByRole('checkbox', { name: 'I saved my recovery key somewhere safe.', exact: true }).check();
  await recovery.getByRole('button', { name: 'Continue to sign in', exact: true }).click();
  await expect(account.getByLabel('Account name', { exact: true })).toHaveValue('AlexMorgan');
  await expect(account.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Continue without account', exact: true })).toBeEnabled();
});

test('legacy encryption setup is offered only for the latest matching sign-in failure', async ({ page }) => {
  await accountSetup(page);
  const loginRequests: { accountName: string; password: string; credentialVersion?: number }[] = [];
  const upgrades: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/accounts/upgrade') upgrades.push(request.url()); });
  await page.route('**/api/accounts/login', route => {
    loginRequests.push(route.request().postDataJSON());
    const legacy = loginRequests.length < 3;
    return route.fulfill({ status: legacy ? 409 : 401, contentType: 'application/json', body: JSON.stringify({ error: {
      code: legacy ? 'LEGACY_ACCOUNT' : 'BAD_CREDENTIALS',
      message: legacy ? 'Set up encrypted sync to continue with this account.' : 'That account name or password is incorrect.',
    } }) });
  });
  const account = page.getByRole('region', { name: 'LopeOS account', exact: true });
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await account.getByLabel('Account name', { exact: true }).fill('alexmorgan');
  await account.getByLabel('Password', { exact: true }).fill('a long test password');
  const submit = account.getByRole('button', { name: 'Sign in to LopeOS', exact: true });
  const upgrade = account.getByRole('button', { name: 'Set up encrypted sync', exact: true });
  await submit.click();
  await expect(upgrade).toBeVisible();
  await account.getByLabel('Account name', { exact: true }).fill('anotheraccount');
  await expect(upgrade).toHaveCount(0);

  await submit.click();
  await expect(upgrade).toBeVisible();
  await submit.click();
  await expect(account.getByRole('alert')).toHaveText('That account name or password is incorrect.');
  await expect(upgrade).toHaveCount(0);
  expect(loginRequests.map(request => request.accountName)).toEqual(['alexmorgan', 'anotheraccount', 'anotheraccount']);
  expect(loginRequests.every(request => request.credentialVersion === 1 && request.password !== 'a long test password')).toBe(true);
  expect(upgrades).toEqual([]);
});

test('account profile pictures can be uploaded, changed, and removed without losing a valid picture on invalid input', async ({ page }) => {
  await installContractRuntime(page);
  await page.route('**/api/health', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  const password = 'profile picture test password';
  const account = { id: 'profile-picture-fixture', accountName: 'picturetester', displayName: 'Picture Tester', createdAt: '2026-11-13T00:00:00.000Z' };
  const created = await EncryptedVault.create(account.accountName, password); created.vault.destroy();
  let manifest = { revision: 0, entries: [] as { key: string; hash: string; size: number }[], usedBytes: 0, quotaBytes: 1_000_000_000 };
  const blobs = new Map<string, Buffer>();
  await page.route('**/api/accounts/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path.endsWith('/session')) return json({ account, vault: created.envelope, usedBytes: manifest.usedBytes, quotaBytes: manifest.quotaBytes });
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
  await page.goto('/tests/accounts/profile-picture.html');
  const settings = page.getByTestId('profile-picture-harness');
  await settings.getByLabel('Account password', { exact: true }).fill(password);
  await settings.getByRole('button', { name: 'Unlock LopeDrive', exact: true }).click();
  await expect(settings.locator('.account-status-heading')).toContainText('Up to date');
  const panel = settings.getByRole('region', { name: 'LopeOS account', exact: true });
  await expect(panel.getByRole('button', { name: 'Add photo', exact: true })).toBeVisible();
  const image = panel.getByRole('img', { name: 'Profile picture', exact: true });
  const input = panel.getByLabel('Choose profile picture', { exact: true });
  async function photo(color: string) {
    const data = await page.evaluate(color => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
      const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, color);
    return { name: 'profile.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
  }
  await input.setInputFiles(await photo('#bc5c8c'));
  await expect(image).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Change photo', exact: true })).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(256);
  const first = await image.getAttribute('src');
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(image).toHaveAttribute('src', first!);
  await input.setInputFiles(await photo('#288fb3'));
  await expect(image).not.toHaveAttribute('src', first!);
  await expect(settings.locator('.account-status-heading')).toContainText('Up to date');
  await mkdir('docs/accounts', { recursive: true });
  await settings.screenshot({ path: 'docs/accounts/profile-picture.png', animations: 'disabled' });
  await panel.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(image).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add photo', exact: true })).toBeVisible();
});

test('Settings uses account sync instead of portable system exports and imports', async ({ page }) => {
  await installContractRuntime(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open full settings', exact: true }).click();
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
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await skip.click();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await page.getByRole('button', { name: 'Open full settings', exact: true }).click();
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
  const password = 'a long visual test password';
  const created = await EncryptedVault.create(account.accountName, password);
  created.vault.destroy();
  let signedIn = false;
  await page.route('**/api/accounts/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path.endsWith('/login')) signedIn = true;
    if (path.endsWith('/session') || path.endsWith('/login')) return json({ account: signedIn ? account : null, vault: signedIn ? created.envelope : null, usedBytes: manifest.usedBytes, quotaBytes: manifest.quotaBytes });
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
  await page.getByRole('button', { name: 'Open full settings', exact: true }).click();
  const settings = page.getByTestId('settings-app');
  if (width === 390) await settings.getByRole('combobox', { name: 'Settings category', exact: true }).selectOption('account');
  else await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'LopeOS Account', exact: true }).click();
  await settings.getByRole('button', { name: 'Sign in', exact: true }).click();
  await settings.getByLabel('Account name', { exact: true }).fill(account.accountName);
  await settings.getByLabel('Password', { exact: true }).fill(password);
  await settings.getByRole('button', { name: 'Sign in to LopeOS', exact: true }).click();
  await expect(settings).toContainText('Alex Morgan');
  await expect(settings.getByRole('meter', { name: 'Cloud storage used', exact: true })).toBeVisible();
  await expect(settings.locator('.account-status-heading')).toContainText('Up to date');
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mkdir('docs/accounts', { recursive: true });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: `docs/accounts/account-${width}.png`, animations: 'disabled' });
  if (width === 1440) {
    await page.reload();
    await page.getByRole('button', { name: 'Open full settings', exact: true }).click();
    await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'LopeOS Account', exact: true }).click();
    await expect(settings.locator('.account-status-heading')).toContainText('Unlock to resume sync');
    await expect(settings.getByRole('button', { name: 'Sync now', exact: true })).toBeDisabled();
    await settings.getByLabel('Account password', { exact: true }).fill('an incorrect password');
    await settings.getByRole('button', { name: 'Unlock LopeDrive', exact: true }).click();
    await expect(settings.getByRole('alert')).toContainText('Could not unlock your files.');
    await expect(settings.getByRole('button', { name: 'Sync now', exact: true })).toBeDisabled();
    await settings.getByLabel('Account password', { exact: true }).fill(password);
    await settings.getByRole('button', { name: 'Unlock LopeDrive', exact: true }).click();
    await expect(settings.locator('.account-status-heading')).toContainText('Up to date');
    await expect(settings.getByLabel('Account password', { exact: true })).toHaveCount(0);
  }
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
