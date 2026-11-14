/** Browser-level Spotlight regression. API fixtures exercise the real shell/UI without
 * depending on the browser streaming service, external search providers, or the host clipboard. */
import { chromium, expect } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const artifacts = new URL('./screenshots/', import.meta.url);
const checks = [], errors = [];
const browser = await chromium.launch({ headless: true });

async function fixtures(page, preferences = {}) {
  const files = await installContractRuntime(page);
  await page.addInitScript(values => {
    if (Object.keys(values).length) localStorage.setItem('lope.preferences.user.desktop-test-user.v2', JSON.stringify({ version: 2, preferences: values }));
  }, preferences);
  await page.addInitScript(() => {
    window.__spotlightClipboard = { text: '', reads: 0, readDenied: false, writeDenied: false, writes: [] };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: async () => {
        window.__spotlightClipboard.reads++;
        if (window.__spotlightClipboard.readDenied) throw new DOMException('Clipboard permission denied', 'NotAllowedError');
        return window.__spotlightClipboard.text;
      },
      writeText: async text => {
        if (window.__spotlightClipboard.writeDenied) throw new DOMException('Clipboard permission denied', 'NotAllowedError');
        window.__spotlightClipboard.text = text;
        window.__spotlightClipboard.writes.push(text);
      },
    } });
  });
  page.on('pageerror', error => errors.push(error.message));
  return files;
}

async function open(page) {
  const dialog = page.getByRole('dialog', { name: 'Find applications', exact: true });
  if (!await dialog.isVisible()) await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Search LopeOS', exact: true });
  await expect(input).toBeFocused();
  return input;
}

try {
  await mkdir(artifacts, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fixtures(page);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible();

  // Tests below are intentionally driven through visible controls and keyboard shortcuts.
  const input = await open(page);
  const dialog = page.getByRole('dialog', { name: 'Find applications', exact: true });
  for (const category of ['Applications', 'Files', 'Actions', 'Clipboard']) {
    await expect(dialog.getByRole('button', { name: category, exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole('button', { name: 'Ask', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Web', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Search the web', exact: true })).toHaveCount(0);
  checks.push('Spotlight has one main input with no separate Ask or Web category');
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-home.png', artifacts)), animations: 'disabled' });
  checks.push('Spotlight opens and focuses its search field');
  await input.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.spotlight'))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.spotlight'))).toBe(true);
  await input.focus();
  checks.push('Tab navigation stays within the Spotlight dialog');

  await page.keyboard.press('Control+1');
  await input.fill('calclator');
  await expect(dialog.getByRole('option').first()).toContainText('Calculator');
  await input.press('Enter');
  await expect(page.getByTestId('calculator-app')).toBeVisible();
  await expect(dialog).toBeHidden();
  checks.push('Typo-tolerant application search launches Calculator with Enter');

  const calculatorInput = page.getByRole('textbox', { name: 'Expression', exact: true });
  await calculatorInput.focus();
  await open(page);
  await input.press('Escape');
  await expect(calculatorInput).toBeFocused();
  checks.push('Escape restores focus to the prior application control');

  await open(page);
  await input.fill('0.1 + 0.2');
  await expect(dialog.locator('.spotlight-answer')).toContainText('0.3');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__spotlightClipboard.text)).toBe('0.3');
  checks.push('Inline exact decimal calculation copies the answer');
  if (!await dialog.isVisible()) await open(page);
  await input.fill('15% of 80');
  await expect(dialog.locator('.spotlight-answer')).toContainText('12');
  await input.fill('10 km to miles');
  await expect(dialog.locator('.spotlight-answer')).toContainText('6.213');
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-conversion.png', artifacts)), animations: 'disabled' });
  await input.fill('1 / 0');
  await expect(dialog).toContainText(/divide by zero/i);
  checks.push('Percentages, conversions, and invalid arithmetic render inline');

  await open(page);
  await page.keyboard.press('Control+4');
  await expect(dialog.getByRole('button', { name: 'Enable clipboard history', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Enable clipboard history', exact: true }).click();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.__spotlightClipboard.reads)).toBe(0);

  await page.keyboard.press('Control+1');
  await input.fill('calculator');
  await expect(dialog.getByRole('option').first()).toContainText('Calculator');
  await input.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('calculator-app')).toBeVisible();
  await calculatorInput.fill('42+1');
  await calculatorInput.press('Enter');
  await expect(calculatorInput).toHaveValue('43');
  await page.getByTestId('calculator-app').getByRole('button', { name: 'Copy result', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spotlightClipboard.text)).toBe('43');
  await open(page);
  await page.keyboard.press('Control+4');
  await expect(dialog.getByRole('option', { name: /^43\b/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(dialog.getByRole('option', { name: /^43\b/ })).toHaveCount(0);
  checks.push('Calculator Copy result appears in Spotlight clipboard and can be deleted');

  await page.evaluate(() => { window.__spotlightClipboard.text = 'A clipboard note\nwith a second line'; });
  await dialog.getByRole('button', { name: 'Import clipboard', exact: true }).click();
  await expect(dialog.getByRole('option', { name: /A clipboard note/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import clipboard', exact: true }).click();
  await expect(dialog.getByRole('option', { name: /A clipboard note/ })).toHaveCount(1);
  checks.push('Clipboard history opts in, imports, and deduplicates text');

  await dialog.getByRole('button', { name: 'Pin item', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Unpin item', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Text to save', exact: true }).fill('Another saved snippet');
  await dialog.getByRole('button', { name: 'Save text', exact: true }).click();
  await expect(dialog.getByRole('option', { name: /Another saved snippet/ })).toBeVisible();
  await input.fill('second line');
  await expect(dialog.getByRole('option', { name: /A clipboard note/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Another saved snippet/ })).toHaveCount(0);
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__spotlightClipboard.text)).toBe('A clipboard note\nwith a second line');
  await dialog.getByRole('option', { name: /A clipboard note/ }).click();
  await expect(input).toBeFocused();
  checks.push('Clipboard pins, saves, searches full text, and copies an item');

  if (!await dialog.isVisible()) await open(page);
  await page.keyboard.press('Control+4');
  await input.fill('');
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-clipboard.png', artifacts)), animations: 'disabled' });
  await page.evaluate(() => { window.__spotlightClipboard.readDenied = true; });
  await dialog.getByRole('button', { name: 'Import clipboard', exact: true }).click();
  await expect(dialog).toContainText(/paste|permission|denied/i);
  await expect(dialog.getByRole('option', { name: /A clipboard note/ })).toBeVisible();
  await page.evaluate(() => { window.__spotlightClipboard.readDenied = false; });
  checks.push('Denied clipboard read remains recoverable without losing saved text');

  const writeCount = await page.evaluate(() => window.__spotlightClipboard.writes.length);
  await page.evaluate(() => { window.__spotlightClipboard.writeDenied = true; });
  await dialog.getByRole('option', { name: /A clipboard note/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/couldn.t copy|not allowed|permission|select.*copy/i);
  expect(await page.evaluate(() => window.__spotlightClipboard.writes.length)).toBe(writeCount);
  await page.evaluate(() => { window.__spotlightClipboard.writeDenied = false; });
  checks.push('Denied clipboard writes show an error and preserve the shelf');

  await dialog.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(dialog.getByRole('option')).toHaveCount(0);
  checks.push('Clear history removes clipboard items');

  await dialog.getByRole('textbox', { name: 'Text to save', exact: true }).fill('Memory-only shelf sentinel');
  await dialog.getByRole('button', { name: 'Save text', exact: true }).click();
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('Memory-only shelf sentinel')))).toBe(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible();
  await open(page);
  await page.keyboard.press('Control+4');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  checks.push('Clipboard text remains in memory and is cleared on reload');
  await input.press('Escape');
  await open(page);
  await page.keyboard.press('Control+3');
  await input.fill('dark');
  await expect(dialog.getByRole('option').first()).toContainText(/dark/i);
  await input.press('Enter');
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'dark');
  checks.push('Actions can change desktop appearance from the keyboard');

  await open(page);
  await page.keyboard.press('Control+2');
  // File search is intentionally enabled explicitly from its empty state.
  await expect(dialog).toContainText(/file/i);
  await input.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: fileURLToPath(new URL('spotlight-narrow.png', artifacts)), animations: 'disabled' });
  checks.push('Spotlight fits a narrow viewport without overflow');

  const filesPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fixtures(filesPage, { theme: 'dark', reduceTransparency: true, increaseContrast: true, strongFocus: true, reduceMotion: true });
  await filesPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(filesPage.locator('.welcome-main h1')).toBeVisible();
  // Spotlight searches LopeDrive's Documents and Downloads by default, not the server workspace.
  await filesPage.evaluate(async () => {
    const { fileService } = await import('/packages/runtime-client/src/index.ts');
    const { ensureLopeFolders } = await import('/packages/runtime-client/src/lope-drive.ts');
    await ensureLopeFolders(fileService);
    await fileService.writeBinary('/LopeDrive/Documents/hello.txt', new TextEncoder().encode('Hello from the shared workspace.\n'), { createOnly: true });
  });
  const fileInput = await open(filesPage);
  await filesPage.keyboard.press('Control+1');
  const appearance = await filesPage.locator('.spotlight').evaluate(element => {
    const surface = getComputedStyle(element.querySelector('.spotlight-searchbar'));
    const active = getComputedStyle(document.activeElement);
    const selected = getComputedStyle(element.querySelector('[aria-selected=true]'));
    return { blur: surface.backdropFilter, background: surface.backgroundColor, focusOutline: active.outlineWidth, selectedOutline: selected.outlineWidth };
  });
  expect(appearance.blur).toBe('none');
  expect(appearance.background).toMatch(/^rgb\(/);
  expect(Number.parseFloat(appearance.focusOutline)).toBeGreaterThan(0);
  expect(Number.parseFloat(appearance.selectedOutline)).toBeGreaterThan(0);
  checks.push('Reduced transparency, contrast, and keyboard focus preferences apply to Spotlight');
  await filesPage.keyboard.press('Control+2');
  await filesPage.getByRole('button', { name: 'Enable file search', exact: true }).click();
  await fileInput.fill('hello');
  const filesDialog = filesPage.getByRole('dialog', { name: 'Find applications', exact: true });
  await expect(filesDialog.getByRole('option', { name: /hello.txt/ })).toBeVisible();
  await fileInput.press('Enter');
  await expect(filesPage.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('Hello from the shared workspace.\n');
  checks.push('Scoped file search opens the matching workspace document');
  await filesPage.close();

  expect(errors).toEqual([]);

  await rm(new URL('spotlight-failure.png', artifacts), { force: true });
  await writeFile(new URL('spotlight-verification.json', artifacts), JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page) await page.screenshot({ path: fileURLToPath(new URL('spotlight-failure.png', artifacts)) }).catch(() => {});
  await writeFile(new URL('spotlight-verification.json', artifacts), JSON.stringify({ checks, errors, failure: error.message }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
