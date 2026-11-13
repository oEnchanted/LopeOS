import { seedSession } from '../setup/seed-session.mjs';
import { expect, test } from '@playwright/test';

/** Opt-in acceptance against the real Linux and Browser runtimes. No route fixtures. */
test.describe('live Linux workspace', () => {
  test.skip(process.env.LOPE_E2E_RUNTIME !== '1', 'Requires the running Docker Linux workspace and authenticated dev proxy; unavailable on this host.');
  test('Terminal → Files → Text Editor → Terminal, then reload', async ({ page }) => {
    const name = `qa-${Date.now()}.txt`; const path = `/Documents/${name}`;
    await seedSession(page);await page.goto('/'); await page.getByRole('button', { name: 'Open Terminal', exact: true }).click();
    const terminal = page.locator('[data-app-id="lope.terminal"]'); await expect(terminal.getByRole('status')).toContainText('Connected');
    const input = terminal.locator('.xterm-helper-textarea').first(); await input.focus(); await page.keyboard.type(`printf 'from terminal' > '${path}'`); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Open Files', exact: true }).click(); const files = page.getByTestId('files-app'); await files.getByRole('button', { name: 'Documents', exact: true }).click();
    await files.getByRole('button', { name: `${name}, file`, exact: true }).dblclick(); const text = page.getByRole('textbox', { name: 'Document content' }); await expect(text).toHaveValue('from terminal');
    await text.fill('edited in LopeOS'); await page.getByTestId('editor-app').getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByTestId('editor-app').getByRole('status')).toContainText('Saved to your workspace');
    await page.getByRole('button', { name: 'Open Terminal', exact: true }).click(); await input.focus(); await page.keyboard.type(`cat '${path}'; printf '\\nQA_READ_COMPLETE\\n'`); await page.keyboard.press('Enter');
    await expect(terminal.locator('.xterm-accessibility-tree')).toContainText('edited in LopeOS');
    await page.reload(); await expect(page.getByRole('textbox', { name: 'Document content' })).toHaveValue('edited in LopeOS');
    // Cleanup through Files keeps all mutations inside the authenticated workspace.
    await page.getByRole('button', { name: 'Open Files', exact: true }).click(); await files.getByRole('button', { name: 'Documents', exact: true }).click(); await files.getByRole('button', { name: `${name}, file`, exact: true }).click();
    await files.getByRole('button', { name: 'Move selected items to Trash' }).click();
    await expect(files.getByRole('button', { name: `${name}, file`, exact: true })).toHaveCount(0);
    await files.getByRole('button', { name: 'Trash', exact: true }).click();
    await files.getByRole('button', { name: `${name}, file`, exact: true }).click();
    await files.getByRole('button', { name: 'Delete selected items permanently' }).click();
    await page.getByRole('dialog', { name: 'Delete selected items permanently?' }).getByRole('button', { name: 'Delete Permanently', exact: true }).click();
    await expect(files.getByRole('button', { name: `${name}, file`, exact: true })).toHaveCount(0);
  });
});

test.describe('live browser transfer', () => {
  test.skip(process.env.LOPE_E2E_RUNTIME !== '1' || !process.env.LOPE_E2E_DOWNLOAD_URL, 'Requires Linux runtime, BrowserFileBridge, and an allowed deterministic attachment endpoint (LOPE_E2E_DOWNLOAD_URL).');
  test('Lope Browser download appears in an already-open Files window', async ({ page }) => {
    await seedSession(page);await page.goto('/'); await page.getByRole('button', { name: 'Open Files', exact: true }).click(); await page.getByTestId('files-app').getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.getByRole('button', { name: 'Open Lope Browser', exact: true }).click(); const browser = page.locator('[data-app-id="lope.browser"]');
    const address = browser.getByRole('textbox', { name: 'Search or enter address' }); await address.fill(process.env.LOPE_E2E_DOWNLOAD_URL!); await address.press('Enter'); await browser.getByRole('button', { name: 'Downloads', exact: true }).click();
    await expect(browser.getByRole('button', { name: 'Show in Files', exact: true }).first()).toBeVisible({ timeout: 20000 }); await browser.getByRole('button', { name: 'Show in Files', exact: true }).first().click();
    await expect(page.getByTestId('files-app').getByRole('button', { name: `${process.env.LOPE_E2E_DOWNLOAD_NAME || 'lope-download.txt'}, file`, exact: true })).toBeVisible();
  });
});
