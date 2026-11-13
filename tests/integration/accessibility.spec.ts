import { expect, test } from '@playwright/test';
import { installContractRuntime } from './contract-runtime-fixture';

test('keyboard-only application launch, calculation, focus ring, and menu navigation', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/');
  await expect(page.locator('.system-status')).toContainText('13°C');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+k`); await expect(page.getByRole('dialog', { name: 'Find applications' })).toBeVisible();
  await page.keyboard.press(`${mod}+1`); await page.keyboard.type('Calculator'); await page.keyboard.press('Enter'); await expect(page.getByTestId('calculator-app')).toBeVisible();
  let found = false;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Expression')) { found = true; break; }
  }
  expect(found).toBe(true); const input = page.getByRole('textbox', { name: 'Expression', exact: true });
  await expect(input).toBeFocused(); expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press(`${mod}+a`); await page.keyboard.type('0.1+0.2'); await page.keyboard.press('Enter'); await expect(input).toHaveValue('0.3');
  await page.keyboard.press(`${mod}+k`); await expect(page.getByRole('dialog', { name: 'Find applications' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+F10'); await expect(page.getByRole('menu', { name: 'LopeOS', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menu', { name: 'LopeOS', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'LopeOS', exact: true })).toHaveCount(0);
});

test('an already-open Downloads folder reflects an external filesystem invalidation', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await page.getByRole('button', { name: 'Open Files', exact: true }).click();
  const files = page.getByTestId('files-app'); await files.getByRole('button', { name: 'Downloads', exact: true }).click();
  await expect(files.getByText('This folder is empty')).toBeVisible();
  fs.externalWrite('/Downloads/contract-download.txt', 'Written by another filesystem consumer');
  await expect(files.getByRole('button', { name: 'contract-download.txt, file', exact: true })).toBeVisible();
});

test('dialog tab order includes links and skips hidden, disabled, and untabbable controls', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: 'Open Files', exact: true }).click();
  const trigger = page.getByTestId('files-app').getByRole('button', { name: 'New folder', exact: true });
  await trigger.focus(); await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  // Dialog children can add form metadata, busy controls, or help links at runtime.
  await dialog.evaluate(node => {
    const fields = document.createElement('div');
    fields.innerHTML = '<input type="hidden" name="metadata"><select disabled><option>Unavailable</option></select><button tabindex="-1">Untabbable</button><div hidden><button>Hidden parent</button></div><div inert><button>Inert parent</button></div><a href="#dialog-help">Folder help</a>';
    node.append(fields);
  });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const name = dialog.getByLabel('Name', { exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const create = dialog.getByRole('button', { name: 'Create', exact: true });
  const help = dialog.getByRole('link', { name: 'Folder help', exact: true });
  await close.focus();
  for (const next of [name, cancel, create, help, close]) { await page.keyboard.press('Tab'); await expect(next).toBeFocused(); }
  for (const previous of [help, create, cancel, name, close]) { await page.keyboard.press('Shift+Tab'); await expect(previous).toBeFocused(); }
  await dialog.focus(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await dialog.focus(); await page.keyboard.press('Shift+Tab'); await expect(help).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});
