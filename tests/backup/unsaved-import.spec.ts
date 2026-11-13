import { test, expect } from '@playwright/test';
import { settings, review, seedWorkspace, openBackup, exportFile, chooseBackup } from './helpers';

test('Settings import checks unsaved work before restarting with the restored layout', async ({ page }) => {
  await seedWorkspace(page); await openBackup(page);
  const buffer = await exportFile(page, false), archive = JSON.parse(buffer.toString());
  await page.getByRole('button', { name: 'Open Text Editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document content' }).fill('Keep this unsaved work');
  await page.locator('[data-app-id="lope.editor"] .window-titlebar').getByRole('button', { name: /^Minimize .*Text Editor$/ }).click();
  await expect(page.locator('[data-app-id="lope.editor"]')).toBeHidden();
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await chooseBackup(page, buffer);
  await review(page).getByRole('button', { name: 'Import and restart', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Save your changes?', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('textarea[aria-label="Document content"]')).toHaveValue('Keep this unsaved work');
  await expect(settings(page)).toContainText('Import cancelled');
  expect(await page.evaluate(() => sessionStorage.getItem('lope.account.session.v1'))).toBe('backup-alex');
  await chooseBackup(page, buffer);
  await review(page).getByRole('button', { name: 'Import and restart', exact: true }).click();
  await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('lope.account.session.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('lope.session.layout.v1'))).toBe(archive.local.storage['lope.session.layout.v1']);
});

