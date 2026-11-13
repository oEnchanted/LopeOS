import { expect, test, type Page } from '@playwright/test';
import { installContractRuntime } from './contract-runtime-fixture';

const launch = (page: Page, name: string) => page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
const appWindow = (page: Page, id: string) => page.locator(`[data-app-id="lope.${id}"]`);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('Files creates, renames, moves, uploads, downloads, and deletes through the shared adapter', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await launch(page, 'Files');
  const files = page.getByTestId('files-app');
  await files.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(files.getByRole('button', { name: 'hello.txt, file', exact: true })).toBeVisible();
  await files.getByRole('button', { name: 'New folder', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Ideas'); await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await files.getByRole('button', { name: 'Ideas, directory', exact: true }).click();
  await files.getByRole('button', { name: 'Rename', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Rename item' });
  await dialog.getByLabel('Name', { exact: true }).fill('Projects'); await dialog.getByLabel('Name', { exact: true }).press('Enter');
  await expect(files.getByRole('button', { name: 'Projects, directory', exact: true })).toBeVisible();
  await files.getByRole('button', { name: 'Projects, directory', exact: true }).click(); await files.getByRole('button', { name: 'Move', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Move items' }); await dialog.getByLabel('Destination folder path').fill('/Downloads'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await files.getByRole('button', { name: 'Downloads', exact: true }).click(); await expect(files.getByRole('button', { name: 'Projects, directory', exact: true })).toBeVisible();
  await files.locator('input[type=file]').setInputFiles({ name: 'upload.txt', mimeType: 'text/plain', buffer: Buffer.from('Uploaded content ✓') });
  const uploaded = files.getByRole('button', { name: 'upload.txt, file', exact: true }); await uploaded.click();
  const downloaded = page.waitForEvent('download'); await files.getByRole('button', { name: 'Download selected file' }).click();
  const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe('Uploaded content ✓');
  await files.getByRole('button', { name: 'File information' }).click(); await expect(page.getByRole('dialog', { name: 'File information' })).toContainText('/Downloads/upload.txt'); await page.getByRole('button', { name: 'Done', exact: true }).click();
  await files.getByRole('button', { name: 'Grid view', exact: true }).click(); await expect(files.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
  await files.getByRole('button', { name: 'Move selected items to Trash' }).click();
  await expect(uploaded).toHaveCount(0); expect(fs.exists('/Downloads/upload.txt')).toBe(false);
  await files.getByRole('button', { name: 'Trash', exact: true }).click();
  await uploaded.click();
  await files.getByRole('button', { name: 'Delete selected items permanently' }).click();
  await page.getByRole('dialog', { name: 'Delete selected items permanently?' }).getByRole('button', { name: 'Delete Permanently', exact: true }).click();
  await expect(uploaded).toHaveCount(0); expect(fs.exists('/Downloads/Projects')).toBe(true);
});

test('Files opens documents; editor commands save, undo, replace, and protect conflicts and unsaved work', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await launch(page, 'Files');
  const files = page.getByTestId('files-app'); await files.getByRole('button', { name: 'Documents', exact: true }).click();
  await files.getByRole('button', { name: 'hello.txt, file', exact: true }).dblclick();
  const editor = page.getByTestId('editor-app'); const text = editor.getByRole('textbox', { name: 'Document content' });
  await expect(text).toHaveValue('Hello from the shared workspace.\n'); await text.fill('First draft');
  await text.press(`${mod}+s`); await expect.poll(() => fs.text('/Documents/hello.txt')).toBe('First draft');
  await text.fill('First draft, changed'); await editor.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(text).toHaveValue('First draft');
  await editor.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(text).toHaveValue('First draft, changed');
  await editor.getByRole('button', { name: 'Find and replace', exact: true }).click(); await editor.getByRole('textbox', { name: 'Find text' }).fill('draft'); await editor.getByRole('textbox', { name: 'Replace with' }).fill('idea'); await editor.getByRole('button', { name: 'Replace all', exact: true }).click(); await expect(text).toHaveValue('First idea, changed');
  fs.externalWrite('/Documents/hello.txt', 'Written elsewhere');
  await expect(editor.getByRole('alert')).toContainText('This file changed elsewhere.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click(); await expect(editor).toContainText('Save failed.'); expect(fs.text('/Documents/hello.txt')).toBe('Written elsewhere');
  await appWindow(page, 'editor').locator('.window-titlebar').getByRole('button', { name: /^Close / }).click();
  let guard = page.getByRole('dialog', { name: 'Save your changes?' }); await guard.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(text).toHaveValue('First idea, changed');
  await appWindow(page, 'editor').locator('.window-titlebar').getByRole('button', { name: /^Close / }).click(); guard = page.getByRole('dialog', { name: 'Save your changes?' }); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(editor).toHaveCount(0);
});

test('Save As uses the shared dialog and atomic creation; a new file survives reload', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await launch(page, 'Text Editor');
  const text = page.getByRole('textbox', { name: 'Document content' }); await text.fill('A saved idea.'); await page.getByTestId('editor-app').getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save file', exact: true }); await dialog.getByRole('button', { name: 'Parent folder', exact: true }).click(); await dialog.getByLabel('File name').fill('New idea.txt'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.text('/New idea.txt')).toBe('A saved idea.'); await expect(page.getByTestId('editor-app').getByRole('status')).toContainText('Saved to your workspace'); await page.reload(); await expect(page.getByRole('textbox', { name: 'Document content' })).toHaveValue('A saved idea.');
});

test('editor shortcuts retain native selection and find Unicode text at its original offsets', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await launch(page, 'Text Editor');
  const editor = page.getByTestId('editor-app'), text = editor.getByRole('textbox', { name: 'Document content' });
  await text.fill('İstanbul road; ROAD'); await text.press(`${mod}+a`);
  await expect.poll(() => text.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 19]);
  await text.press(`${mod}+f`);
  const find = editor.getByRole('textbox', { name: 'Find text' }); await expect(find).toBeFocused();
  await find.fill('road'); await find.press('Enter');
  await expect.poll(() => text.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([9, 13]);
  await editor.getByRole('button', { name: 'Replace', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Replace with' }).fill('lane');
  await editor.locator('.editor-replace').getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(text).toHaveValue('İstanbul lane; ROAD');
  await expect.poll(() => text.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([15, 19]);
  await text.press(`${mod}+z`); await expect(text).toHaveValue('İstanbul road; ROAD');
});

test('editing a Files search preserves native deletion and caret navigation without changing files', async ({ page }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await launch(page, 'Files');
  const files = page.getByTestId('files-app'); await files.getByRole('button', { name: 'Documents', exact: true }).click();
  await files.getByRole('button', { name: 'hello.txt, file', exact: true }).click();
  const search = files.getByRole('textbox', { name: 'Search files' }); await search.fill('hello');
  await search.press(`${mod}+Backspace`);
  expect(fs.text('/Documents/hello.txt')).toBe('Hello from the shared workspace.\n');
  await search.fill('hello'); await search.press(`${mod}+ArrowUp`);
  await expect(files.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  expect(fs.mutations()).toEqual([]);
});

test('Calculator accepts keyboard arithmetic, reports errors, and persists usable history', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await launch(page, 'Calculator');
  const app = page.getByTestId('calculator-app'); const input = app.getByRole('textbox', { name: 'Expression', exact: true });
  await input.fill('0.1+0.2'); await input.press('Enter'); await expect(input).toHaveValue('0.3');
  await input.fill('(2+3)*4'); await input.press('Enter'); await expect(input).toHaveValue('20');
  await input.fill('1/0'); await input.press('Enter'); await expect(app.getByRole('status')).toContainText('Cannot divide by zero');
  await app.getByRole('button', { name: 'Show calculation history' }).click(); await expect(app.getByRole('region', { name: 'Calculation history' })).toContainText('0.3');
  await app.getByRole('button', { name: 'Use result 20', exact: true }).click(); await expect(input).toHaveValue('20');
  await page.reload(); await page.getByRole('button', { name: 'Show calculation history' }).click(); await expect(page.getByRole('region', { name: 'Calculation history' })).toContainText('20');
});

test('preferences update several applications immediately and persist across reload', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await launch(page, 'Files'); await launch(page, 'Calculator'); await launch(page, 'Settings');
  const settings = page.getByTestId('settings-app'); await settings.getByRole('button', { name: 'Dark', exact: true }).click(); await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'dark');
  await settings.getByRole('button', { name: 'Iris accent', exact: true }).click(); await expect(page.locator('.desktop')).toHaveCSS('--accent', '#7756c5');
  await settings.getByRole('button', { name: 'Accessibility', exact: true }).click();
  for (const name of ['Reduce motion', 'Reduce transparency', 'Increase contrast']) await settings.getByRole('switch', { name, exact: true }).click();
  for (const attr of ['data-reduce-motion', 'data-reduce-transparency', 'data-increase-contrast']) await expect(page.locator('.desktop')).toHaveAttribute(attr, 'true');
  await page.reload(); await expect(page.locator('.desktop')).toHaveAttribute('data-theme', 'dark'); await expect(page.locator('.desktop')).toHaveAttribute('data-reduce-motion', 'true');
  await expect(page.getByTestId('files-app')).toBeVisible(); await expect(page.getByTestId('calculator-app')).toBeVisible(); await expect(page.getByTestId('settings-app')).toBeVisible();
});

test('Weather and widget share requests, location, and units; offline data is labelled', async ({ page, context }) => {
  const fs = await installContractRuntime(page); await page.goto('/'); await launch(page, 'Weather'); const weather = page.getByTestId('weather-app');
  await expect(weather.getByRole('heading', { name: /13\s*°C/ })).toBeVisible(); expect(fs.forecastRequests()).toBe(1);
  await expect(page.locator('.system-status')).toContainText('13°C');
  await weather.getByRole('button', { name: 'Use Fahrenheit', exact: true }).click(); await expect(weather.getByRole('heading', { name: /55\s*°F/ })).toBeVisible(); await expect(page.locator('.system-status')).toContainText('55°F');
  await weather.getByRole('button', { name: 'Denver', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Choose a location' }); await dialog.getByLabel('City or postal code').fill('Boulder'); await dialog.getByRole('button', { name: 'Search', exact: true }).click(); await dialog.getByRole('button', { name: /Boulder, Colorado/ }).click();
  await expect(weather.getByRole('button', { name: 'Boulder, Colorado', exact: true })).toBeVisible();
  await context.setOffline(true); await expect(weather.getByRole('alert')).toContainText('offline'); await expect(weather.getByRole('alert')).toContainText('cached'); await expect(weather.getByRole('link', { name: 'Weather data by Open-Meteo' })).toBeVisible();
});

test('runtime and weather failures show recoverable errors', async ({ page }) => {
  const fs = await installContractRuntime(page); fs.setDisconnected(true); fs.setWeatherFailure(true);
  await page.goto('/'); await launch(page, 'Files'); await page.getByTestId('files-app').getByRole('complementary', { name: 'Locations', exact: true }).getByRole('button', { name: 'Home', exact: true }).click(); await expect(page.getByTestId('files-app').getByRole('alert')).toContainText('disconnected');
  fs.setDisconnected(false); await page.getByTestId('files-app').getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByTestId('files-app').getByRole('button', { name: 'Documents, directory' })).toBeVisible();
  await launch(page, 'Weather'); await expect(page.getByTestId('weather-app').getByRole('alert')).toContainText('Weather is unavailable');
});

test('Dock launch, pointer move and resize, minimize, restore, and keyboard window actions work', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await launch(page, 'Files'); const win = appWindow(page, 'files'); const before = (await win.boundingBox())!;
  await win.locator('.window-titlebar').hover({ position: { x: before.width / 2, y: 18 } }); await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 60, before.y + 55, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await win.boundingBox())!.x).toBeGreaterThan(before.x + 30);
  const moved = (await win.boundingBox())!; await win.locator('.resize-se').hover(); await page.mouse.down(); await page.mouse.move(moved.x + moved.width + 45, moved.y + moved.height + 30, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await win.boundingBox())!.width).toBeGreaterThan(moved.width + 20);
  await win.getByRole('button', { name: /^Minimize / }).click(); await expect(win).toBeHidden(); await launch(page, 'Files'); await expect(win).toBeVisible();
  await win.locator('.window-titlebar').click({ position: { x: 200, y: 18 } }); const x = (await win.boundingBox())!.x; await page.keyboard.press('Alt+ArrowLeft'); await expect.poll(async () => (await win.boundingBox())!.x).toBeLessThan(x);
});

test('active menus and shortcuts follow two editor windows; modal keyboard focus is contained', async ({ page }) => {
  await installContractRuntime(page); await page.goto('/'); await launch(page, 'Text Editor');
  await page.getByRole('textbox', { name: 'Document content' }).fill('First window');
  await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menu', { name: 'File', exact: true }).getByRole('menuitem', { name: /New window/ }).click();
  const windows = appWindow(page, 'editor'); await expect(windows).toHaveCount(2); const second = windows.last(); const first = windows.first();
  await second.getByRole('textbox', { name: 'Document content' }).fill('Second window'); await second.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(second.getByRole('textbox', { name: 'Document content' })).toHaveValue(''); await expect(first.getByRole('textbox', { name: 'Document content' })).toHaveValue('First window');
  await launch(page, 'Files'); await expect(page.getByRole('menuitem', { name: 'Files', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await expect(page.getByRole('menu', { name: 'File', exact: true }).getByRole('menuitem', { name: /New Folder/ })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByTestId('files-app').getByRole('button', { name: 'New folder', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'New folder', exact: true }); await dialog.getByLabel('Name', { exact: true }).focus();
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
