import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installContractRuntime } from './contract-runtime-fixture';

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`visual review ${viewport.width}×${viewport.height} ${theme}`, async ({ page }, info) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await installContractRuntime(page); await page.setViewportSize(viewport);
      await page.addInitScript(({ theme }) => { localStorage.setItem('lope.theme', theme); localStorage.setItem('lope.wallpaper', theme === 'dark' ? 'night' : 'aurora'); localStorage.setItem('lope.reduceMotion', 'true'); }, { theme });
      await page.goto('/');
      for (const name of ['Files', 'Calculator', 'Weather', 'Settings']) await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
      const settings = page.getByTestId('settings-app'); await expect(settings.getByRole('heading', { name: 'Make it yours.' })).toBeVisible();
      await settings.getByRole('button', { name: 'Accessibility', exact: true }).click();
      const directory = resolve('tests/integration/screenshots'); await mkdir(directory, { recursive: true });
      const prefix = `${viewport.width}x${viewport.height}-${theme}-${info.project.name}`;
      await page.screenshot({ path: resolve(directory, `${prefix}-settings.png`), fullPage: true });
      for (const [name, id] of [['Files', 'files'], ['Text Editor', 'editor'], ['Calculator', 'calculator'], ['Weather', 'weather']]) {
        await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
        await expect(page.getByTestId(`${id}-app`)).toBeVisible();
        if (name === 'Weather') await expect(page.getByTestId('weather-app').getByRole('heading', { name: /13\s*°C/ })).toBeVisible();
        await page.screenshot({ path: resolve(directory, `${prefix}-${id}.png`), fullPage: true });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
      await info.attach('final desktop', { path: resolve(directory, `${prefix}-weather.png`), contentType: 'image/png' });
    });
  }
}
