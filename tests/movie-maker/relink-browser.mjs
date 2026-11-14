/** Relinking retains immutable originals, so undo can restore source pixels. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const evidence = { checkedAt: new Date().toISOString(), browser: browser.version(), checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188'}/tests/movie-maker/harness.html`); await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeEnabled();
  const colors = await page.evaluate(() => ['#ef2828', '#2855ef'].map(color => { const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 72; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 128, 72); return canvas.toDataURL('image/png').split(',')[1]; }));
  const original = { name: 'red-original.png', mimeType: 'image/png', buffer: Buffer.from(colors[0], 'base64') }, replacement = { name: 'blue-replacement.png', mimeType: 'image/png', buffer: Buffer.from(colors[1], 'base64') };
  const [importChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add videos and photos', exact: true }).first().click()]); await importChooser.setFiles(original); await expect(page.locator('.mm-clip')).toHaveCount(1);
  const pixel = () => page.locator('canvas[aria-label="Movie preview frame"]').evaluate(canvas => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  await expect.poll(async () => (await pixel())[0]).toBeGreaterThan(200); assert.ok((await pixel())[2] < 80);
  const [relinkChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Relink original file', exact: true }).click()]); await relinkChooser.setFiles(replacement); await expect.poll(async () => (await pixel())[2]).toBeGreaterThan(200); assert.ok((await pixel())[0] < 80);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(async () => (await pixel())[0]).toBeGreaterThan(200); assert.ok((await pixel())[2] < 80);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect.poll(async () => (await pixel())[2]).toBeGreaterThan(200); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(async () => (await pixel())[0]).toBeGreaterThan(200); evidence.checks.push('relink changes decoded preview pixels; undo/redo restore original/replacement source pixels');
  await expect(page.locator('.mm-save-state')).toHaveText('Saved locally');
  await page.evaluate(async () => {
    const m = await import('/packages/movie-maker/src/model.ts'), s = await import('/packages/movie-maker/src/persistence.ts'); const loaded = await s.loadAutosave(); const project = structuredClone(loaded.project); const source = Object.values(project.assets)[0]; const missing = { ...source, id: 'missing-original', name: 'Missing photograph.png' }; project.assets[missing.id] = missing; project.clips.push(m.createClip(missing));
    const path = '/Documents/missing-source.lopemovie'; window.testFiles.set(path, { data: new TextEncoder().encode(m.serializeProject(project)), version: 'fixture' }); window.openPath = path;
  });
  await page.getByRole('button', { name: 'File', exact: true }).click(); await page.getByRole('button', { name: 'Open from Files', exact: true }).click(); await page.getByRole('dialog', { name: 'Save your project?' }).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.locator('.mm-clip')).toHaveCount(2); await expect(page.getByText('1 original file is missing.', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByRole('option', { name: 'Missing photograph.png, 7.00 seconds', exact: true }).click(); await page.keyboard.press('Delete'); await expect(page.locator('.mm-clip')).toHaveCount(1); await expect(page.getByText('1 original file is missing.', { exact: false })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.getByRole('button', { name: 'Save movie', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Save movie' }).getByRole('button', { name: 'Create movie', exact: true })).toBeEnabled(); await page.getByRole('dialog', { name: 'Save movie' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.mm-save-state')).toHaveText('Saved locally');
  const portable = await page.evaluate(async () => { const s = await import('/packages/movie-maker/src/persistence.ts'); const loaded = await s.loadAutosave(); const bundle = await s.encodePortable(loaded.project, loaded.blobs); const reopened = await s.decodePortable(bundle); return { assetCount: Object.keys(reopened.project.assets).length, clipCount: reopened.project.clips.length, missing: reopened.missing }; });
  assert.deepEqual(portable, { assetCount: 1, clipCount: 1, missing: [] }); evidence.checks.push('removing missing clip restores playback and export; portable project includes only referenced originals');
  assert.deepEqual(errors, []); evidence.status = 'PASS'; await mkdir('docs/movie-maker', { recursive: true }); await writeFile('docs/movie-maker/relink-verification.json', `${JSON.stringify(evidence, null, 2)}\n`); console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
