import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installContractRuntime } from './contract-runtime-fixture';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('personal wallpaper metadata and image persist; unsupported files leave the active wallpaper intact', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const settings = page.getByTestId('settings-app'); await settings.getByRole('button', { name: 'Wallpaper', exact: true }).click();
  await settings.locator('input[type=file]').setInputFiles({ name: 'personal.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') });
  await expect(settings.getByRole('status')).toContainText('personal.png');
  await expect(page.locator('.wallpaper')).toHaveCSS('background-image', /data:image\/png;base64/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.personalWallpaper')!).originalName)).toBe('personal.png');
  await settings.locator('input[type=file]').setInputFiles({ name: 'unsupported.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(settings.getByRole('alert')).toContainText('Choose a JPEG'); await expect(page.locator('.wallpaper')).toHaveCSS('background-image', /data:image\/png;base64/);
  await page.reload(); await expect(page.locator('.wallpaper')).toHaveCSS('background-image', /data:image\/png;base64/);
});

test('authorized wallpaper metadata renders a visible lowercase desktop credit', async ({ page }, info) => {
  // Synthetic metadata + a one-pixel test image. No PerfectHue artwork is downloaded.
  await installContractRuntime(page);
  await page.addInitScript(({ pixel }) => {
    localStorage.setItem('lope.wallpaper', 'personal');
    localStorage.setItem('lope.personalWallpaper', JSON.stringify({ id: 'personal', name: 'QA credit metadata fixture', asset: `data:image/png;base64,${pixel}`, creator: 'Perfect Hue', sourceURL: 'https://perfecthue.com/wallpapers/', creditURL: 'https://perfecthue.com/wallpapers/', permission: 'authorized', kind: 'light', originalName: 'fixture.png', importedAt: '2026-11-12T17:00:00Z' }));
  }, { pixel });
  await page.goto('/'); const credit = page.getByRole('link', { name: 'perfecthue', exact: true }); await expect(credit).toBeVisible(); await expect(credit).toHaveAttribute('href', 'https://perfecthue.com/wallpapers/');
  const rect = (await credit.boundingBox())!; const viewport = page.viewportSize()!;
  expect(rect.x).toBeGreaterThan(viewport.width - 180); expect(rect.y).toBeGreaterThan(viewport.height - 50);
  const directory = resolve('tests/integration/screenshots'); await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `credit-metadata-fixture-${info.project.name}.png`) });
});
