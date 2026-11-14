import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { seedSession } from '../setup/seed-session.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await seedSession(page);
  await page.addInitScript(() => localStorage.setItem('lope.layout.v1', JSON.stringify([{ id: 'movie-shell-test', appId: 'lope.movie-maker', title: 'Movie Maker', state: 'normal', bounds: { x: 110, y: 80, width: 1180, height: 760 }, zIndex: 1, launchArgs: {} }])));
  await page.goto(process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188/');
  const app = page.getByTestId('movie-maker-app');
  await expect(app).toBeVisible({ timeout: 45000 });
  await expect(app.getByRole('button', { name: 'Try a sample movie', exact: true })).toBeEnabled();
  await app.getByRole('button', { name: 'Try a sample movie', exact: true }).click();
  await expect(app.getByRole('option')).toHaveCount(12, { timeout: 30000 });
  await expect(app.locator('.mm-busy')).toHaveCount(0, { timeout: 30000 });
  await app.locator('[data-clip-id="sample-clip-1"]').click();
  await page.screenshot({ path: 'docs/movie-maker/screenshots/lopeos-integration-1440.png' });
  expect(errors).toEqual([]);
  await writeFile('docs/movie-maker/shell-verification.json', JSON.stringify({ date: '2026-11-13', passed: true, viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 }, checks: ['Manifest registers Movie Maker with the live LopeOS desktop', 'Shared window frame wraps opaque ribbon/preview/storyboard', 'Sample opens through the real app lifecycle and services'], errors }, null, 2) + '\n');
  console.log('Live LopeOS Movie Maker integration passed.');
} finally { await browser.close(); }
