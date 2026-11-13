/** Files regression against isolated HTTP/WebSocket fixtures and the real UI/client adapter.
 * Run with a Vite server: LOPE_QA_URL=http://127.0.0.1:5173 node tests/apps/files-browser.mjs
 * Filesystem durability and confinement are tested separately in services/runtime/fs_test.py.
 */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const output = process.env.LOPE_FILES_QA_OUTPUT || '/tmp/lope-files-qa';
const browser = await chromium.launch({ headless: true });
const checks = [], screenshots = [], errors = [];
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
await mkdir(output, { recursive: true });

async function desktop({ theme = 'light', viewport = { width: 1440, height: 960 }, accessible = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const fs = await installContractRuntime(page);
  fs.externalMkdir('/Documents/Project');
  fs.externalWrite('/Documents/Project/notes.txt', 'Nested project notes, preserved by recursive operations.');
  fs.externalWrite('/Documents/.hidden-note.txt', 'Hidden files stay out of selection until revealed.');
  await page.addInitScript(({ theme, accessible }) => {
    localStorage.setItem('lope.preferences.user.desktop-test-user.v2', JSON.stringify({ version: 2, preferences: {
      theme, pinned: ['lope.files', 'lope.editor'], showRecentApps: false, reduceMotion: true,
      statusItems: [], reduceTransparency: accessible, increaseContrast: accessible,
    } }));
  }, { theme, accessible });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', theme);
  await page.getByRole('button', { name: 'Open Files', exact: true }).click();
  const app = page.getByTestId('files-app');
  await expect(app).toBeVisible();
  await app.locator('aside').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Documents, directory', exact: true })).toBeVisible();
  return { page, app, fs };
}

const item = (app, name, type = 'file') => app.getByRole('button', { name: `${name}, ${type}`, exact: true });
async function location(app, name) {
  await app.locator('aside').getByRole('button', { name, exact: true }).click();
  await expect(app.getByRole('heading', { name: name === 'Home' ? 'Your workspace' : name, exact: true })).toBeVisible();
  if (name !== 'Trash') await expect(app.getByRole('button', { name: 'New folder', exact: true })).toBeEnabled();
}
async function action(page, app, label, target) {
  if (target) await target.click({ button: 'right' });
  else await app.getByRole('button', { name: 'File actions', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'File actions', exact: true });
  await expect(menu).toBeVisible();
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await menu.getByRole('menuitem', { name: new RegExp(`^${escaped}(?:$|\\s)`) }).click();
}
async function noOverflow(page, app) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize()).width);
  const box = await app.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}
async function capture(page, suffix) {
  const path = `${output}/files-${suffix}.png`;
  await page.locator('[data-app-id="lope.files"]').screenshot({ path, animations: 'disabled' });
  screenshots.push(path);
}

try {
  const { page, app, fs } = await desktop();
  const disk = app.getByRole('region', { name: 'Disk usage', exact: true });
  await expect(disk).toContainText('256 GB');
  await expect(disk).toContainText('80 GB');
  await expect(disk).toContainText('176 GB');
  const diskBox = await disk.boundingBox();
  const sidebarBox = await app.locator('aside').boundingBox();
  expect(sidebarBox.y + sidebarBox.height - (diskBox.y + diskBox.height)).toBeLessThan(40);
  checks.push('Sidebar shows runtime disk used, total, and available space anchored at the bottom');
  await location(app, 'Documents');
  await expect(item(app, 'hello.txt')).toBeVisible();
  await expect(item(app, '.hidden-note.txt')).toHaveCount(0);
  await noOverflow(page, app); await capture(page, 'light');

  await action(page, app, 'Duplicate', item(app, 'Project', 'directory'));
  await expect(item(app, 'Project copy', 'directory')).toBeVisible();
  expect(fs.text('/Documents/Project copy/notes.txt')).toBe('Nested project notes, preserved by recursive operations.');
  expect(fs.text('/Documents/Project/notes.txt')).toBe('Nested project notes, preserved by recursive operations.');
  checks.push('Duplicate preserves a folder’s nested contents and original data');

  await action(page, app, 'Copy', item(app, 'hello.txt'));
  await location(app, 'Downloads');
  await action(page, app, 'Paste');
  await expect(item(app, 'hello.txt')).toBeVisible();
  expect(fs.text('/Downloads/hello.txt')).toBe('Hello from the shared workspace.\n');
  await action(page, app, 'Paste');
  const conflict = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Keep Both', exact: true }) });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Keep Both', exact: true }).click();
  await expect(item(app, 'hello copy.txt')).toBeVisible();
  expect(fs.text('/Downloads/hello.txt')).toBe('Hello from the shared workspace.\n');
  expect(fs.text('/Downloads/hello copy.txt')).toBe('Hello from the shared workspace.\n');
  checks.push('Copy/Paste uses the shared file service and Keep Both resolves collisions without replacing existing content');

  await item(app, 'hello copy.txt').click();
  await page.keyboard.press(`${mod}+x`);
  await location(app, 'Documents');
  await page.keyboard.press(`${mod}+v`);
  await expect(item(app, 'hello copy.txt')).toBeVisible();
  expect(fs.exists('/Downloads/hello copy.txt')).toBe(false);
  expect(fs.text('/Documents/hello copy.txt')).toBe('Hello from the shared workspace.\n');
  checks.push('Cut/Paste keyboard shortcuts move the selected file and preserve bytes');

  await item(app, 'hello.txt').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'File actions', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  expect(await menu.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(item(app, 'hello.txt')).toBeFocused();
  checks.push('File context actions support keyboard opening, menu navigation, Escape, and focus restoration');

  fs.failNextOperation('/fs/copy', 'Copy interrupted by a test connection failure.');
  await action(page, app, 'Duplicate', item(app, 'ideas.md'));
  await expect(app.getByRole('alert')).toContainText('Copy interrupted');
  expect(fs.exists('/Documents/ideas copy.md')).toBe(false);
  await action(page, app, 'Duplicate', item(app, 'ideas.md'));
  await expect(item(app, 'ideas copy.md')).toBeVisible();
  expect(fs.text('/Documents/ideas copy.md')).toBe('# A little possibility\n');
  checks.push('A failed operation leaves source data intact and permits a successful retry');

  fs.setStorageUnavailable(true);
  await app.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(disk).toContainText(/unavailable|couldn.t|could not|unable/i);
  await expect(item(app, 'hello.txt')).toBeVisible();
  fs.setStorageUnavailable(false);
  await app.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(disk).toContainText('256 GB');
  checks.push('Storage-report failures remain separate from file browsing and recover after refresh');

  fs.setDisconnected(true);
  await app.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(app.getByRole('alert')).toContainText('disconnected');
  fs.setDisconnected(false);
  await app.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(item(app, 'hello.txt')).toBeVisible();
  await expect(app.getByRole('alert')).toHaveCount(0);
  checks.push('Runtime disconnection shows a recoverable folder error and Try again restores browsing');

  await app.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Show Hidden Files/ }).click();
  await expect(item(app, '.hidden-note.txt')).toBeVisible();
  await page.keyboard.press(`${mod}+Shift+g`);
  const go = page.getByRole('dialog', { name: 'Go to Folder', exact: true });
  await go.getByLabel('Folder path', { exact: true }).fill('/Documents/Project');
  await go.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(item(app, 'notes.txt')).toBeVisible();
  await item(app, 'notes.txt').focus(); await page.keyboard.press(`${mod}+ArrowUp`);
  await expect(item(app, 'Project', 'directory')).toBeVisible();
  checks.push('Hidden-file controls and Go to Folder / Enclosing Folder keyboard navigation work');

  const drag = await page.evaluateHandle(() => new DataTransfer());
  await item(app, 'hello copy.txt').dispatchEvent('dragstart', { dataTransfer: drag });
  await item(app, 'Project', 'directory').dispatchEvent('dragover', { dataTransfer: drag });
  await item(app, 'Project', 'directory').dispatchEvent('drop', { dataTransfer: drag });
  await drag.dispose();
  await expect.poll(() => fs.exists('/Documents/Project/hello copy.txt')).toBe(true);
  expect(fs.exists('/Documents/hello copy.txt')).toBe(false);
  expect(fs.text('/Documents/Project/hello copy.txt')).toBe('Hello from the shared workspace.\n');
  checks.push('Dropping a file on a folder moves it through the shared service without losing contents');

  await action(page, app, 'Copy', item(app, 'ideas.md'));
  await page.getByRole('button', { name: 'Open Files', exact: true }).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Files Dock menu', exact: true }).getByRole('menuitem', { name: 'New Window', exact: true }).click();
  const second = page.getByTestId('files-app').last();
  await expect(page.getByTestId('files-app')).toHaveCount(2);
  await location(second, 'Downloads');
  await action(page, second, 'Paste');
  await expect(item(second, 'ideas.md')).toBeVisible();
  expect(fs.text('/Downloads/ideas.md')).toBe('# A little possibility\n');
  checks.push('Clipboard selections can be pasted between separate Files windows');
  await page.close();

  for (const scene of [
    { theme: 'dark', suffix: 'dark' },
    { theme: 'light', viewport: { width: 390, height: 844 }, suffix: 'compact-light' },
    { theme: 'dark', viewport: { width: 390, height: 844 }, accessible: true, suffix: 'compact-dark-accessible' },
  ]) {
    const { page: visual, app: files } = await desktop(scene);
    await location(files, 'Documents');
    await expect(item(files, 'hello.txt')).toBeVisible();
    const diskPanel = files.getByRole('region', { name: 'Disk usage', exact: true });
    await expect(diskPanel).toBeVisible();
    expect((await files.locator('aside').boundingBox()).width).toBeGreaterThanOrEqual(100);
    expect((await diskPanel.boundingBox()).width).toBeGreaterThanOrEqual(90);
    expect(await diskPanel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await noOverflow(visual, files); await capture(visual, scene.suffix);
    await action(visual, files, 'Duplicate', item(files, 'hello.txt'));
    await expect(item(files, 'hello copy.txt')).toBeVisible();
    await visual.close();
  }
  checks.push('Light, dark, compact, reduced-transparency and increased-contrast layouts retain disk usage and working file actions without horizontal overflow');
  expect(errors).toEqual([]);
  const report = { conditions: 'Chromium headless; real Files UI and runtime-client adapter with deterministic HTTP/WebSocket contract fixtures. This is not a live runtime storage benchmark.', checks, screenshots, errors };
  await writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: `${output}/failure-${index}.png`, animations: 'disabled' }).catch(() => {});
    await writeFile(`${output}/failure-${index}.txt`, await page.locator('body').ariaSnapshot().catch(() => 'Page unavailable'));
  }
  console.error(JSON.stringify({ completedChecks: checks, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
