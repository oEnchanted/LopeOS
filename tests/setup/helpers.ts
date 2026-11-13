import { expect, type Page } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';

export const panel = (page: Page) => page.locator('.setup-panel');
export const next = (page: Page) => panel(page).getByRole('button', { name: 'Continue', exact: true }).click();
export async function freshSetup(page: Page) {
  await installContractRuntime(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
}
export async function reachLocalAI(page: Page) {
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
  for (let step = 0; step < 3; step++) await next(page);
  await expect(page.getByRole('heading', { name: 'Local AI', exact: true })).toBeVisible();
}
export async function reachAccount(page: Page) {
  await reachLocalAI(page);
  await next(page);
  await expect(page.getByRole('heading', { name: 'LopeOS Account', exact: true })).toBeVisible();
}
export async function reviewAccount(page: Page, _name = 'Alex Morgan', _password = '') {
  await panel(page).getByRole('button', { name: 'Continue without account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review setup', exact: true })).toBeVisible();
}
export async function expectFooterInViewport(page: Page) {
  const submit = panel(page).locator('button[type="submit"]');
  const box = await submit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}
