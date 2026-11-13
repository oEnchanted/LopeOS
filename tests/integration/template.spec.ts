import { expect, test } from '@playwright/test';
import { installContractRuntime } from './contract-runtime-fixture';

test('the SDK template registers through an extension manifest and uses shared menus, dialog, settings, and files', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: 'Search applications', exact: true }).click(); const search = page.getByRole('dialog', { name: 'Find applications' }); await search.getByRole('button', { name: 'Applications', exact: true }).click(); await search.getByRole('textbox').fill('Example Notes'); await search.getByRole('option', { name: /^Example Notes/ }).click(); const app = page.locator('[data-app-id="example.notes"]');
  await expect(app.getByText('hello.txt', { exact: true })).toBeVisible();
  await app.getByLabel('A quick note').fill('From the application template'); await app.getByRole('button', { name: 'Save to workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save file', exact: true }); await dialog.getByLabel('File name').fill('Template note.txt'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.text('/Template note.txt')).toBe('From the application template');
  await page.getByRole('menuitem', { name: 'View', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: 'Compact View', exact: true }).click(); await expect(app.locator('.lope-example')).toHaveClass(/compact/);
  await app.getByRole('button', { name: 'About this example', exact: true }).click(); const about = page.getByRole('dialog', { name: 'An example that belongs here' }); await expect(about).toBeVisible(); await about.getByRole('button', { name: 'Done', exact: true }).click();
});
