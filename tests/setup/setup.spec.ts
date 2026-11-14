import { test, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { expectFooterInViewport, freshSetup, next, panel, reachAccount, reviewAccount } from './helpers';

test('first run can finish without creating an account and remembers guest setup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await freshSetup(page); await reachAccount(page); await reviewAccount(page);
  expect(await page.evaluate(() => localStorage.getItem('lope.accounts.v1'))).toBeNull();
  await panel(page).getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.desktop')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lope.setup.complete.v1'))).toBe('1');
  expect(await page.evaluate(() => sessionStorage.getItem('lope.account.session.v1'))).toBeNull();
  await page.reload(); await expect(page.locator('.desktop')).toBeVisible();
  expect(errors).toEqual([]);
});

test('account name follows the display name until manually edited', async ({ page }) => {
  await freshSetup(page); await reachAccount(page);
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Your name', exact: true });
  const account = page.getByRole('textbox', { name: 'Account name', exact: true });
  await name.fill('Alex Morgan'); await expect(account).toHaveValue('alexmorgan');
  await account.fill('alex-work'); await name.fill('Alexandra Morgan');
  await expect(account).toHaveValue('alex-work');
  await expect(panel(page)).toContainText(/1 GB.*cloud storage/);
});

test('server duplicate names are reported without creating local credentials', async ({ page }) => {
  await freshSetup(page); await reachAccount(page);
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  await page.route('**/api/accounts/register', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NAME_TAKEN', message: 'That account name is already in use. Choose another.' } }) }));
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Password', { exact: true }).fill('a long test password');
  await page.getByLabel('Confirm password', { exact: true }).fill('a long test password');
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('That account name is already in use. Choose another.');
  expect(await page.evaluate(() => localStorage.getItem('lope.accounts.v1'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Continue without account', exact: true })).toBeEnabled();
});

test('mobile accessibility previews immediately and persists into a guest desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshSetup(page);
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Light', exact: true }).click();
  await next(page);
  await panel(page).getByRole('switch', { name: 'Request persistent storage', exact: true }).click();
  await next(page);
  const transparency = panel(page).getByRole('slider', { name: 'Transparency', exact: true });
  const panelOpacity = () => panel(page).evaluate(element => {
    const color = getComputedStyle(element).backgroundColor;
    return color.startsWith('rgba(') ? Number(color.split(',').at(-1)!.replace(')', '')) : 1;
  });
  await transparency.focus(); await page.keyboard.press('Home'); await expect(transparency).toHaveValue('0');
  await expect.poll(panelOpacity).toBeGreaterThan(0.8);
  await page.keyboard.press('End'); await expect(transparency).toHaveValue('100');
  await expect.poll(panelOpacity).toBeLessThan(0.3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.preferences.v2')!).preferences.glassClarity)).toBe(100);
  const reduceTransparency = panel(page).getByRole('switch', { name: 'Reduce transparency', exact: true });
  await reduceTransparency.click();
  await expect(transparency).toBeDisabled(); await expect(transparency).toHaveValue('100');
  await expect(panel(page)).toHaveCSS('backdrop-filter', 'none');
  await expect.poll(panelOpacity).toBe(1);
  await reduceTransparency.click();
  await expect(transparency).toBeEnabled(); await expect(transparency).toHaveValue('100');
  await expect(panel(page)).toHaveCSS('backdrop-filter', /blur/);
  await expect.poll(panelOpacity).toBeLessThan(0.3);
  await reduceTransparency.click();
  await panel(page).getByRole('switch', { name: 'Reduce motion', exact: true }).click();
  const slider = panel(page).getByRole('slider', { name: 'Text size', exact: true });
  await slider.focus(); await page.keyboard.press('Home'); await expect(slider).toHaveValue('85');
  await page.keyboard.press('End'); await expect(slider).toHaveValue('150');
  await expect(page.locator('html')).toHaveAttribute('data-reduce-transparency', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');
  await expect(panel(page)).toHaveCSS('backdrop-filter', 'none');
  await expectFooterInViewport(page); await next(page); await expectFooterInViewport(page); await next(page);
  await reviewAccount(page); await expect(panel(page)).toContainText('Standard browser storage');
  await expectFooterInViewport(page);
  await panel(page).getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.preferences.v2')!).preferences)).toMatchObject({ theme: 'light', glassClarity: 100, reduceTransparency: true, reduceMotion: true, textSize: 150 });
  await page.reload(); await expect(page.locator('.desktop')).toHaveAttribute('data-reduce-transparency', 'true');
  await expect(page.locator('.desktop')).toHaveCSS('--glass-clarity', '100');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.preferences.v2')!).preferences.glassClarity)).toBe(100);
});

test('review reflects storage protection and permits appearance editing', async ({ page }) => {
  await freshSetup(page);
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click(); await next(page);
  await panel(page).getByRole('switch', { name: 'Request persistent storage', exact: true }).click();
  await next(page); await next(page); await next(page); await reviewAccount(page);
  await expect(panel(page)).toContainText('Standard browser storage');
  await panel(page).getByRole('button', { name: 'Edit appearance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeFocused();
});

test('Enter advances setup and future progress steps remain disabled', async ({ page }) => {
  await freshSetup(page);
  const navigation = page.getByRole('navigation', { name: 'Setup progress' });
  await expect(navigation.getByRole('button', { name: /Finish/ })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeFocused();
  await expect(navigation.locator('[aria-current="step"]')).toContainText('Appearance');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Privacy & storage', exact: true })).toBeFocused();
  await navigation.getByRole('button', { name: /Welcome/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeFocused();
});

test('account request disables its fields and setup navigation until it finishes', async ({ page }) => {
  await freshSetup(page); await reachAccount(page);
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/accounts/register', async route => { await pending; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Account service unavailable.' } }) }); });
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Password', { exact: true }).fill('a long test password');
  await page.getByLabel('Confirm password', { exact: true }).fill('a long test password');
  await page.getByRole('button', { name: 'Create free account', exact: true }).click();
  try {
    await expect(page.getByRole('region', { name: 'LopeOS account', exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Creating account…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue without account', exact: true })).toBeDisabled();
    for (const input of await panel(page).locator('.account-fields input').all()) await expect(input).toBeDisabled();
    for (const step of await page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button').all()) await expect(step).toBeDisabled();
  } finally { release(); }
  await expect(panel(page).getByRole('alert')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Continue without account', exact: true })).toBeEnabled();
});

test('appearance choices persist without a cloud account', async ({ page }) => {
  await freshSetup(page);
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Dark', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Morning sky', exact: true }).click();
  await panel(page).getByRole('button', { name: 'iris accent', exact: true }).click();
  const expected = { theme: 'dark', wallpaper: 'sky', background: 'morning', accent: '#7756c5' };
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.preferences.v2')!).preferences)).toMatchObject(expected);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (let step = 0; step < 4; step++) await next(page);
  await reviewAccount(page);
  await panel(page).getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.desktop')).toHaveAttribute('data-wallpaper', 'sky-morning');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.preferences.v2')!).preferences)).toMatchObject(expected);
});

test('legacy local accounts retain preferences without imposing a login gate', async ({ page }) => {
  await installContractRuntime(page);
  await page.addInitScript(() => { sessionStorage.removeItem('lope.account.session.v1'); });
  await page.goto('/');
  await expect(page.locator('.desktop')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create another account', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.accounts.v1')!).accounts.length)).toBeGreaterThan(0);
});
