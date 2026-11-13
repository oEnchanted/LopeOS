import { mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { expectFooterInViewport, next, panel, reviewAccount } from './helpers';

const steps = ['welcome', 'appearance', 'privacy', 'accessibility', 'local-ai', 'account', 'finish'];
for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`capture seven ${theme} steps at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installContractRuntime(page, { signedIn: false });
    await page.addInitScript(theme => {
      localStorage.setItem('lope.preferences.v2', JSON.stringify({ version: 2, preferences: { theme, wallpaper: `perfecthue-${theme}` } }));
    }, theme);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible();
    const directory = resolve(import.meta.dirname, '../../docs/setup-assistant/screenshots');
    await mkdir(directory, { recursive: true });
    // Remove superseded six-step captures when replacing this scenario.
    for (const old of ['5-account', '6-finish']) await unlink(resolve(directory, `${theme}-${viewport.width}-${old}.png`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    for (let step = 0; step < steps.length; step++) {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectFooterInViewport(page);
      if (step === 4) await expect(panel(page).locator('[data-model-id][data-status=checking]')).toHaveCount(0);
      await page.mouse.move(2, 2);
      await page.screenshot({ path: resolve(directory, `${theme}-${viewport.width}-${step + 1}-${steps[step]}.png`), animations: 'disabled' });
      if (step === 0) await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
      else if (step < 5) await next(page);
      else if (step === 5) await reviewAccount(page, 'Alex Morgan', 'quiet morning');
    }
  });
}
