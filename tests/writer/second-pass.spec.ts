import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { writerFilesystem } from './runtime';
const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
const body = (page: Page) => page.getByRole('textbox', { name: 'Document content', exact: true });
async function open(page: Page, path = '') {
  const fs = await writerFilesystem(page);
  await page.addInitScript(() => localStorage.setItem('test.writer.autosave', 'false'));
  await page.goto(`/tests/writer/harness.html${path ? '?path=' + encodeURIComponent(path) : ''}`);
  if (path) await expect(page.locator('.writer-title')).toContainText(path.split('/').at(-1)!);
  await expect(page.locator('.writer-opening')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return fs;
}
async function text(page: Page, value: string) {
  await body(page).click({ position: { x: 110, y: 110 } });
  await page.keyboard.type(value);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
}
async function save(page: Page, path: string) {
  await page.evaluate(path => { (window as any).savePath = path; }, path);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.writer-title')).toContainText(path.split('/').at(-1)!);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

test('typing resumes at the caret immediately after Save', async ({ page }) => {
  const fs = await open(page); await text(page, 'Before save.');
  await save(page, '/Documents/Focus.docx');
  await page.keyboard.type(' After save.');
  await save(page, '/Documents/Focus.docx');
  const xml = strFromU8(unzipSync(fs.files.get('/Documents/Focus.docx')!.data)['word/document.xml']);
  expect(xml).toContain('Before save. After save.');
});

test('Font dialog changes size without clearing color or strike, then returns to editing', async ({ page }) => {
  const fs = await open(page); await text(page, 'Colored passage.'); await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
  await page.getByRole('button', { name: 'Font Color', exact: true }).click();
  await page.getByRole('button', { name: 'Font color #FF0000', exact: true }).click();
  await page.getByRole('button', { name: 'Font dialog launcher', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Font', exact: true });
  await dialog.getByLabel('Size:', { exact: true }).fill('18');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('ArrowRight'); await page.keyboard.type(' Continued.');
  await save(page, '/Documents/Font-preservation.docx');
  const xml = strFromU8(unzipSync(fs.files.get('/Documents/Font-preservation.docx')!.data)['word/document.xml']);
  expect(xml).toMatch(/w:color[^>]*w:val="FF0000"/); expect(xml).toMatch(/<w:strike\b/); expect(xml).toContain('Continued.');
  const formatting = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    const run = [...doc.getElementsByTagNameNS('*','r')].find(r => r.textContent?.includes('Colored passage.'))!;
    const prop = (key: string) => run.getElementsByTagNameNS('*',key)[0]?.getAttribute('w:val');
    return { color: prop('color'), strike: Boolean(run.getElementsByTagNameNS('*','strike').length), size: prop('sz') };
  }, xml);
  expect(formatting).toEqual({ color: 'FF0000', strike: true, size: '36' });
});

test('Paragraph dialog centers every selected paragraph', async ({ page }) => {
  const fs = await open(page); await text(page, 'First paragraph.');
  await page.keyboard.press('Enter'); await page.keyboard.type('Second paragraph.'); await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Line and Paragraph Spacing', exact: true }).click();
  await page.getByRole('menuitem', { name: '1.5', exact: true }).click();
  await page.getByRole('button', { name: 'Paragraph dialog launcher', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Paragraph', exact: true });
  await dialog.getByRole('combobox', { name: 'Alignment:', exact: true }).selectOption('center');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await save(page, '/Documents/Paragraphs.docx');
  const xml = strFromU8(unzipSync(fs.files.get('/Documents/Paragraphs.docx')!.data)['word/document.xml']);
  expect((xml.match(/<w:jc[^>]*w:val="center"/g) || []).length).toBe(2);
  expect((xml.match(/w:line="360"/g) || []).length).toBe(2);
});

test('File Print refreshes the preview after document edits', async ({ page }) => {
  await open(page, '/Documents/Review.docx');
  await page.getByRole('tab', { name: 'File', exact: true }).click(); await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.wr-print-preview-canvas .superdoc-page')).toHaveCount(3, { timeout: 30000 });
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await body(page).click({ position: { x: 110, y: 110 } }); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Fresh print contents.');
  await page.getByRole('tab', { name: 'File', exact: true }).click(); await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.wr-print-preview-canvas')).toContainText('Fresh print contents.', { timeout: 30000 });
});

test('Escape cannot dismiss an in-flight formatting transaction', async ({ page }) => {
  await open(page); await text(page, 'A pending change.'); await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => new URL(name).pathname === '/packages/document-engine/src/index.ts');
    const { WriterEngine } = await import(moduleUrl!);
    const invoke = WriterEngine.prototype.invoke;
    WriterEngine.prototype.invoke = async function (id: any, input: any) {
      if (id === 'format.apply') {
        (window as any).formattingPending = true;
        await new Promise<void>(resolve => { (window as any).releaseFormatting = resolve; });
      }
      return invoke.call(this, id, input) as any;
    };
  });
  await page.getByRole('button', { name: 'Font dialog launcher', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Font', exact: true });
  await dialog.getByLabel('Size:', { exact: true }).fill('16'); await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).formattingPending)).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).releaseFormatting());
  await expect(dialog).toHaveCount(0);
});

test('Navigation and Comments stay open together, resize, and collapsed tabs reopen', async ({ page }) => {
  await open(page, '/Documents/Review.docx');
  await page.evaluate(() => (window as any).testCommands.execute('writer.navigation'));
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(page.getByLabel('Navigation pane', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Comments pane', { exact: true })).toBeVisible();
  const resizer = page.getByRole('separator', { name: 'Resize Navigation pane', exact: true });
  const before = Number(await resizer.getAttribute('aria-valuenow'));
  await resizer.focus(); await page.keyboard.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', String(before+20));
  await page.getByRole('button', { name: 'Collapse ribbon', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Home ribbon', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Insert ribbon', exact: true })).toBeVisible();
});

test('search snippets select the intended occurrence for Replace', async ({ page }) => {
  const fs = await open(page); await text(page, 'one alpha, two alpha, three alpha.');
  await page.evaluate(() => (window as any).testCommands.execute('writer.replace'));
  await page.getByLabel('Search document', { exact: true }).fill('alpha');
  await expect(page.locator('.wr-search-result')).toHaveCount(3);
  await expect(page.locator('.wr-search-result').nth(1)).toContainText('two alpha');
  await page.locator('.wr-search-result').nth(1).click();
  await page.getByLabel('Replace with', { exact: true }).fill('beta');
  await page.getByLabel('Navigation pane', { exact: true }).getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.locator('.wr-search-result')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close Navigation pane', exact: true }).click();
  await save(page, '/Documents/Search.docx');
  const xml = strFromU8(unzipSync(fs.files.get('/Documents/Search.docx')!.data)['word/document.xml']);
  const plain = xml.replace(/<[^>]+>/g,'');
  expect(plain).toContain('one alpha, two beta, three alpha.');
});

test('AutoSave retries edits made while a previous save is in flight', async ({ page }) => {
  const fs = await open(page, '/Documents/Review.docx');
  await page.getByRole('button', { name: 'AutoSave Off', exact: true }).click();
  await body(page).click({ position: { x: 110, y: 110 } }); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' First pending edit.');
  fs.delayNextWrite(2500);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.writer-save-status')).toContainText('Saving');
  await body(page).click({ position: { x: 110, y: 110 } }); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Second pending edit.');
  await expect.poll(() => strFromU8(unzipSync(fs.files.get('/Documents/Review.docx')!.data)['word/document.xml']), { timeout: 12000 }).toContain('Second pending edit.');
  await expect(page.locator('.writer-title')).toContainText('Saved');
});

test('switching pictures loads each picture size and changes only the selected picture', async ({ page }) => {
  const fs = await open(page); await text(page, 'Pictures: ');
  for (const [name,width,height] of [['First picture',120,80],['Second picture',220,140]] as const) {
    await page.evaluate(() => (window as any).testCommands.execute('writer.picture'));
    const dialog = page.getByRole('dialog', { name: 'Insert Picture', exact: true });
    await dialog.getByLabel('Picture file').setInputFiles({ name: name+'.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64') });
    await dialog.getByLabel('Alt text:', { exact: true }).fill(name);
    await dialog.getByLabel('Width (px):', { exact: true }).fill(String(width));
    await dialog.getByLabel('Height (px):', { exact: true }).fill(String(height));
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
  }
  await page.getByRole('button', { name: 'Picture Properties', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Picture Format', exact: true });
  await expect(dialog.getByLabel('Width (px):', { exact: true })).toHaveValue('220');
  const picker = dialog.getByLabel('Picture to format', { exact: true });
  await picker.selectOption({ index: 0 });
  await expect(dialog.getByLabel('Width (px):', { exact: true })).toHaveValue('120');
  await expect(dialog.getByLabel('Height (px):', { exact: true })).toHaveValue('80');
  await dialog.getByLabel('Height (px):', { exact: true }).fill('90');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await save(page, '/Documents/Pictures.docx');
  const xml = strFromU8(unzipSync(fs.files.get('/Documents/Pictures.docx')!.data)['word/document.xml']);
  const sizes = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    return [...doc.getElementsByTagNameNS('*','extent')].map(n => [Number(n.getAttribute('cx'))/9525,Number(n.getAttribute('cy'))/9525]);
  }, xml);
  expect(sizes).toEqual([[120,90],[220,140]]);
});

test('a hyperlink keeps the selected display text', async ({ page }) => {
  const fs = await open(page); await text(page, 'Keep this link label.'); await page.keyboard.press('ControlOrMeta+a');
  await page.evaluate(() => (window as any).testCommands.execute('writer.link'));
  const dialog = page.getByRole('dialog', { name: 'Insert Hyperlink', exact: true });
  await dialog.getByLabel('Link address', { exact: true }).fill('https://example.com/writing');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await save(page, '/Documents/Link.docx');
  const parts = unzipSync(fs.files.get('/Documents/Link.docx')!.data);
  expect(strFromU8(parts['word/document.xml'])).toMatch(/<w:hyperlink[\s\S]*Keep this link label\./);
  expect(strFromU8(parts['word/_rels/document.xml.rels'])).toContain('https://example.com/writing');
});

test('read-only documents cannot be switched into editing through review or view controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).openPath = '/Documents/Unsafe.docx'; return (window as any).testCommands.execute('writer.open'); });
  await page.getByRole('button', { name: 'Open read-only', exact: true }).click();
  await expect(page.locator('.writer-opening')).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => (window as any).testCommands.execute('writer.track'));
  await expect(page.locator('.writer-tab-actions')).toContainText('Viewing');
  await expect(page.getByRole('button', { name: 'Print layout', exact: true })).toBeDisabled();
});

test('a slow manual save keeps focus in a search started while it was saving', async ({ page }) => {
  const fs = await open(page, '/Documents/Review.docx');
  fs.delayNextWrite(1800);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.evaluate(() => (window as any).testCommands.execute('writer.find'));
  const search = page.getByLabel('Search document', { exact: true });
  await search.fill('document');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.keyboard.type('ation');
  await expect(search).toHaveValue('documentation');
});
