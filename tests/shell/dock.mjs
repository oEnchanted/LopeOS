/** Dock regression against isolated in-memory workspace HTTP/WebSocket fixtures. */
import { chromium, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];

async function desktop(preferences = {}, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const files = await installContractRuntime(page);
  await page.addInitScript(values => {
    const key = 'lope.preferences.user.desktop-test-user.v2';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 2, preferences: values }));
  }, {
    pinned: ['lope.editor', 'lope.files', 'lope.calculator', 'lope.settings'],
    showRecentApps: false, reduceMotion: true, statusItems: [], ...preferences,
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible();
  return { page, files, dock: page.getByRole('navigation', { name: 'Application Dock', exact: true }) };
}

async function appMenu(page, dock, name) {
  await dock.getByRole('button', { name: `Open ${name}`, exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `${name} Dock menu`, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

try {
  const { page, files, dock } = await desktop({ minimizeDestination: 'dock' });
  const editorButton = dock.getByRole('button', { name: 'Open Text Editor', exact: true });
  const editorWindows = page.locator('[data-app-id="lope.editor"]');
  expect((await dock.locator('[data-dock-app]').evaluateAll(buttons => buttons.map(button => button.dataset.dockApp))).slice(0, 4)).toEqual(['lope.editor', 'lope.files', 'lope.calculator', 'lope.settings']);
  const appDrag = await page.evaluateHandle(() => new DataTransfer());
  await dock.getByRole('button', { name: 'Open Calculator', exact: true }).dispatchEvent('dragstart', { dataTransfer: appDrag });
  await editorButton.dispatchEvent('dragover', { dataTransfer: appDrag });
  await editorButton.dispatchEvent('drop', { dataTransfer: appDrag });
  await appDrag.dispose();
  await expect(dock.locator('[data-dock-app]').first()).toHaveAttribute('data-dock-app', 'lope.calculator');
  checks.push('Pinned app order is honored and dragging an app reorders it');
  await editorButton.click();
  await expect(editorWindows).toHaveCount(1);
  await editorWindows.getByRole('textbox', { name: 'Document content', exact: true }).fill('A draft that must survive Dock switching.');
  await editorButton.click();
  await expect(editorWindows).toHaveCount(1);
  await editorWindows.getByRole('button', { name: /^Minimize / }).click();
  await expect(editorWindows).toBeHidden();
  await dock.getByRole('button', { name: /^Restore .*Untitled.*Text Editor/ }).click();
  await expect(editorWindows).toBeVisible();
  await editorWindows.getByRole('button', { name: /^Minimize / }).click();
  await expect(editorWindows).toBeHidden();
  await editorButton.click();
  await expect(editorWindows).toBeVisible();
  await expect(editorWindows.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('A draft that must survive Dock switching.');
  await expect(editorButton).toHaveClass(/is-running/);
  await expect(editorButton).toHaveAttribute('aria-current', 'true');
  checks.push('Dock clicks focus and restore an open multiwindow app without duplicating it or losing draft state');

  let menu = await appMenu(page, dock, 'Text Editor');
  await menu.getByRole('menuitem', { name: 'New Window', exact: true }).click();
  await expect(editorWindows).toHaveCount(2);
  menu = await appMenu(page, dock, 'Text Editor');
  await expect(menu.getByRole('menuitem', { name: /Untitled.*Text Editor/ })).toHaveCount(2);
  await menu.getByRole('menuitem', { name: /●.*Untitled.*Text Editor/ }).click();
  await expect(editorWindows.first()).toHaveClass(/is-focused/);
  menu = await appMenu(page, dock, 'Text Editor');
  await menu.getByRole('menuitem', { name: 'Quit Text Editor', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Save your changes?', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editorWindows).toHaveCount(2);
  await expect(editorButton).toHaveClass(/is-running/);
  menu = await appMenu(page, dock, 'Text Editor');
  await menu.getByRole('menuitem', { name: 'Remove from Dock', exact: true }).click();
  await expect(editorButton).toBeVisible();
  menu = await appMenu(page, dock, 'Text Editor');
  await menu.getByRole('menuitem', { name: 'Keep in Dock', exact: true }).click();
  menu = await appMenu(page, dock, 'Text Editor');
  await menu.getByRole('menuitem', { name: 'Quit Text Editor', exact: true }).click();
  await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(editorWindows).toHaveCount(0);
  await expect(editorButton).not.toHaveClass(/is-running/);
  checks.push('App menus expose open windows, create a new window, pin/unpin running apps, and honor unsaved-change guards on Quit');

  files.externalWrite('/Downloads/dock-note.txt', 'Downloaded fixture text.');
  files.externalWrite('/Downloads/another-note.txt', 'Another download.');
  const downloadsButton = dock.getByRole('button', { name: 'Downloads', exact: true });
  await downloadsButton.click();
  const downloads = page.getByRole('dialog', { name: 'Downloads', exact: true });
  await expect(downloads).toBeVisible();
  await expect(downloads).toContainText('dock-note.txt');
  await expect(downloads).toContainText('another-note.txt');
  files.externalWrite('/Downloads/live-note.txt', 'Arrived while the stack was open.');
  await expect(downloads).toContainText('live-note.txt');
  await page.screenshot({ path: '/tmp/lope-dock-desktop.png', animations: 'disabled' });
  await downloads.getByRole('button', { name: /dock-note\.txt/ }).click();
  await expect(downloads).toBeHidden();
  await expect(editorWindows.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('Downloaded fixture text.');
  await downloadsButton.click();
  await downloads.getByRole('button', { name: 'Open in Files', exact: true }).click();
  const fileApp = page.locator('[data-app-id="lope.files"].is-focused').getByTestId('files-app');
  await expect(fileApp.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible();
  checks.push('Downloads stack lists real workspace entries, opens files, and reveals the folder in Files');

  const note = fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true });
  await note.click();
  await fileApp.getByRole('button', { name: 'Move selected items to Trash', exact: true }).click();
  await expect.poll(() => files.exists('/Downloads/dock-note.txt')).toBe(false);
  await dock.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(fileApp.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible();
  await fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true }).click();
  await fileApp.getByRole('button', { name: 'Put Back', exact: true }).click();
  await expect.poll(() => files.text('/Downloads/dock-note.txt')).toBe('Downloaded fixture text.');
  await expect(fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true })).toHaveCount(0);
  checks.push('Move to Trash preserves file data and Put Back restores its original location');

  await fileApp.getByRole('complementary', { name: 'Locations', exact: true }).getByRole('button', { name: 'Downloads', exact: true }).click();
  const dragData = await page.evaluateHandle(() => new DataTransfer());
  await note.dispatchEvent('dragstart', { dataTransfer: dragData });
  const trashButton = dock.getByRole('button', { name: 'Trash', exact: true });
  await trashButton.dispatchEvent('dragover', { dataTransfer: dragData });
  await trashButton.dispatchEvent('drop', { dataTransfer: dragData });
  await dragData.dispose();
  await expect.poll(() => files.exists('/Downloads/dock-note.txt')).toBe(false);
  await trashButton.click();
  await expect(fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true })).toBeVisible();
  await expect(dock.locator('[data-dock-app]').first()).toHaveAttribute('data-dock-app', 'lope.calculator');
  checks.push('Dragging Files onto Trash is recoverable and Trash contents survive reloading');

  await trashButton.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Trash', exact: true }).getByRole('menuitem', { name: 'Empty Trash…', exact: true }).click();
  const emptyDialog = page.getByRole('dialog', { name: /Empty Trash/ });
  await expect(emptyDialog).toBeVisible();
  await emptyDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true })).toBeVisible();
  await fileApp.getByRole('button', { name: 'Empty Trash…', exact: true }).click();
  await emptyDialog.getByRole('button', { name: 'Empty Trash', exact: true }).click();
  await expect(fileApp.getByRole('button', { name: 'dock-note.txt, file', exact: true })).toHaveCount(0);
  expect(files.exists('/Downloads/another-note.txt')).toBe(true);
  checks.push('Empty Trash requires confirmation, Cancel preserves data, and unrelated downloads remain intact');

  await fileApp.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('button', { name: 'Home', exact: true }).click();
  await fileApp.getByRole('button', { name: 'Documents, directory', exact: true }).click();
  await fileApp.getByRole('button', { name: 'Move selected items to Trash', exact: true }).click();
  await expect.poll(() => files.exists('/Documents')).toBe(false);
  await trashButton.click();
  await fileApp.getByRole('button', { name: 'Documents, directory', exact: true }).click();
  await fileApp.getByRole('button', { name: 'Put Back', exact: true }).click();
  await expect.poll(() => files.text('/Documents/hello.txt')).toBe('Hello from the shared workspace.\n');
  checks.push('Trashing and restoring a folder preserves its original name and nested file contents');

  await downloadsButton.focus();
  await downloadsButton.press('Enter');
  await expect(downloads).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(downloads).toBeHidden();
  await expect(downloadsButton).toBeFocused();
  await editorButton.focus();
  await editorButton.press('Shift+F10');
  menu = page.getByRole('menu', { name: 'Text Editor Dock menu', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Quit Text Editor', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(editorButton).toBeFocused();
  checks.push('Downloads is keyboard accessible and Escape restores its trigger focus');
  await page.close();

  for (const position of ['bottom', 'left', 'right']) {
    const { page: small, dock: smallDock } = await desktop({ dockPosition: position, dockAutoHide: true }, { width: 390, height: 844 });
    const reveal = small.getByRole('button', { name: 'Reveal application Dock', exact: true });
    await reveal.click();
    const trigger = smallDock.getByRole('button', { name: 'Downloads', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const stack = small.getByRole('dialog', { name: 'Downloads', exact: true });
    await expect(stack).toBeVisible();
    if (position === 'bottom') await small.screenshot({ path: '/tmp/lope-dock-mobile.png', animations: 'disabled' });
    const bounds = await stack.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    expect(await small.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await small.keyboard.press('Escape');
    await smallDock.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(small.getByTestId('files-app').getByRole('heading', { name: 'Trash', exact: true })).toBeVisible();
    await small.close();
  }
  checks.push('Bottom, left, and right auto-hidden Docks keep Downloads and Trash reachable on a 390px viewport');
  const { page: denied, files: deniedFiles, dock: deniedDock } = await desktop({ fileAccess: { 'lope.files': false } });
  deniedFiles.externalWrite('/Downloads/private-note.txt', 'Hidden when Files access is disabled.');
  await deniedDock.getByRole('button', { name: 'Downloads', exact: true }).click();
  const deniedStack = denied.getByRole('dialog', { name: 'Downloads', exact: true });
  await expect(deniedStack.getByRole('alert')).toContainText(/file access is disabled/i);
  await expect(deniedStack).not.toContainText('private-note.txt');
  await denied.keyboard.press('Escape');
  await deniedDock.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(denied.getByTestId('files-app').getByRole('alert')).toContainText(/file access is disabled/i);
  await denied.close();
  checks.push('Downloads and Trash honor disabled Files access without exposing workspace filenames');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
