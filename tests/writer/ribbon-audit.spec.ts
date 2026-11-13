import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';

const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
const body = (page: Page) => page.getByRole('textbox', { name: 'Document content', exact: true });

async function open(page: Page) {
  const fs = await writerFilesystem(page);
  await page.addInitScript(() => localStorage.setItem('test.writer.autosave', 'false'));
  await page.goto('/tests/writer/harness.html');
  await expect(page.locator('.writer-opening')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return fs;
}

async function saveXml(page: Page, fs: Awaited<ReturnType<typeof writerFilesystem>>, path: string) {
  await page.evaluate(path => { (window as any).savePath = path; }, path);
  await page.evaluate(() => (window as any).testCommands.execute('writer.save-as'));
  await expect.poll(() => fs.files.has(path)).toBe(true);
  return strFromU8(unzipSync(fs.files.get(path)!.data)['word/document.xml']) as string;
}

test('super/subscript toggles preserve text and unrelated formatting through DOCX export and undo', async ({ page }) => {
  const fs = await open(page);
  await body(page).click({ position: { x: 110, y: 110 } });
  await page.keyboard.type('H2O');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();

  const superscript = page.getByRole('button', { name: 'Superscript', exact: true });
  const subscript = page.getByRole('button', { name: 'Subscript', exact: true });
  await superscript.click();
  await expect(superscript).toHaveAttribute('aria-pressed', 'true');
  const raised = await saveXml(page, fs, '/Documents/Raised.docx');
  expect(raised).toContain('H2O');
  expect(raised).toMatch(/w:vertAlign[^>]+w:val="superscript"/);
  expect(raised).toMatch(/<w:b(?:\s|\/|>)/);

  await superscript.click();
  await expect(superscript).toHaveAttribute('aria-pressed', 'false');
  const baseline = await saveXml(page, fs, '/Documents/Baseline.docx');
  expect(baseline).not.toContain('w:val="superscript"');
  expect(baseline).toContain('H2O');

  await subscript.click();
  await expect(subscript).toHaveAttribute('aria-pressed', 'true');
  await expect(superscript).toHaveAttribute('aria-pressed', 'false');
  const lowered = await saveXml(page, fs, '/Documents/Lowered.docx');
  expect(lowered).toMatch(/w:vertAlign[^>]+w:val="subscript"/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(subscript).toHaveAttribute('aria-pressed', 'false');
  const undone = await saveXml(page, fs, '/Documents/Undone.docx');
  expect(undone).not.toContain('w:val="subscript"');
  expect(undone).toContain('H2O');
  expect(undone).toMatch(/<w:b(?:\s|\/|>)/);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('Read Mode and Print Layout show current mode and disable character edits while viewing', async ({ page }) => {
  await open(page);
  await body(page).click({ position: { x: 110, y: 110 } });
  await page.keyboard.type('Read this passage.');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  const reading = page.getByRole('button', { name: 'Read Mode', exact: true });
  const print = page.getByRole('button', { name: 'Print Layout', exact: true });
  await expect(print).toHaveAttribute('aria-pressed', 'true');
  await expect(reading).toHaveAttribute('aria-pressed', 'false');
  await reading.click();
  await expect(reading).toHaveAttribute('aria-pressed', 'true');
  await expect(print).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Vertical', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Superscript', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Subscript', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Font family', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await print.click();
  await expect(print).toHaveAttribute('aria-pressed', 'true');
  await expect(reading).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});

test('unsafe case replacement is unavailable with an explicit reason', async ({ page }) => {
  const fs = await open(page);
  await body(page).click({ position: { x: 110, y: 110 } });
  await page.keyboard.type('Mixed Case stays intact.');
  await page.keyboard.press('ControlOrMeta+a');
  const changeCase = page.getByRole('button', { name: 'Change Case', exact: true });
  await expect(changeCase).toBeDisabled();
  await expect(changeCase).toHaveAttribute('title', /preserves document formatting is not available/);
  const xml = await saveXml(page, fs, '/Documents/Case.docx');
  expect(xml).toContain('Mixed Case stays intact.');
});

test('Layout shows actual and mixed paragraph values and uses per-edge Word margin presets', async ({ page }) => {
  const fs = await open(page);
  await body(page).click({ position: { x: 110, y: 110 } });
  await page.keyboard.type('First paragraph.');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Paragraph dialog launcher', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Paragraph', exact: true });
  await dialog.getByRole('spinbutton', { name: /^Left \(in(?:ches)?\):$/ }).fill('1');
  await dialog.getByLabel('Before (pt):', { exact: true }).fill('12');
  await dialog.getByLabel('After (pt):', { exact: true }).fill('6');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Left paragraph indent — 1 in; open Paragraph settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Before paragraph spacing — 12 pt; open Paragraph settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'After paragraph spacing — 6 pt; open Paragraph settings', exact: true })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second paragraph.');
  await page.getByRole('button', { name: 'Paragraph dialog launcher', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: /^Left \(in(?:ches)?\):$/ }).fill('2');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Left paragraph indent — 2 in; open Paragraph settings', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByRole('button', { name: 'Left paragraph indent — Mixed; open Paragraph settings', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Margins', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Wide — top/bottom 1″, left/right 2″', exact: true }).click();
  const wide = await saveXml(page, fs, '/Documents/WideMargins.docx');
  expect(wide).toMatch(/<w:pgMar[^>]+w:top="1440"/);
  expect(wide).toMatch(/<w:pgMar[^>]+w:bottom="1440"/);
  expect(wide).toMatch(/<w:pgMar[^>]+w:left="2880"/);
  expect(wide).toMatch(/<w:pgMar[^>]+w:right="2880"/);
  await page.getByRole('button', { name: 'Margins', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Moderate — top/bottom 1″, left/right 0.75″', exact: true }).click();
  const moderate = await saveXml(page, fs, '/Documents/ModerateMargins.docx');
  expect(moderate).toMatch(/<w:pgMar[^>]+w:top="1440"/);
  expect(moderate).toMatch(/<w:pgMar[^>]+w:bottom="1440"/);
  expect(moderate).toMatch(/<w:pgMar[^>]+w:left="1080"/);
  expect(moderate).toMatch(/<w:pgMar[^>]+w:right="1080"/);
  await expect(page.locator('.writer-message.error')).toHaveCount(0);
});
