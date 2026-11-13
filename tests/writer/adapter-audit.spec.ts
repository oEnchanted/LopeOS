import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');

async function mount(page: Page, file = '/tests/writer/fixtures/multipage.docx') {
  await page.goto(`/tests/writer/harness.html?engine&file=${file}`);
  await page.waitForFunction(() => (window as any).engineReady, null, { timeout: 40000 });
}
async function exported(page: Page) {
  return new Uint8Array(await page.evaluate(async () => Array.from(await (window as any).testEngine.export()) as number[]));
}
function documentXml(bytes: Uint8Array): string { return strFromU8(unzipSync(bytes)['word/document.xml']); }

for (const blank of [false, true]) test(`${blank ? 'Blank Page' : 'Page Break'} inserts native breaks at the caret with coherent history and DOCX round trip`, async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async blank => {
    const e = (window as any).testEngine;
    const point = { kind: 'text', blockId: '00000003', offset: 20 };
    await e.ui.selection.applyAndWait({ kind: 'selection', start: point, end: point });
    const original = await e.api.getText({});
    await (blank ? e.insertBlankPage() : e.insertPageBreak());
    return { original, edited: await e.api.getText({}), selection: await e.api.selection.current() };
  }, blank);
  const count = blank ? 2 : 1;
  expect(result.edited.replaceAll('\n', '')).toBe(result.original);
  expect(result.edited).toContain(`Writer brings famili${'\n'.repeat(count)}ar document tools`);
  expect(result.selection.selectionTarget.start.offset).toBe(21);
  await expect.poll(() => page.evaluate(() => (window as any).snapshot.pages)).toBe(3 + count);
  await expect.poll(() => page.evaluate(async () => {
    const e = (window as any).testEngine, selection = await e.api.selection.current();
    const caret = e.ui.viewport.getRect({ target: selection.selectionTarget }).rect;
    return Boolean(caret && caret.top >= 0 && caret.bottom <= innerHeight);
  })).toBe(true);
  const bytes = await exported(page), xml = documentXml(bytes);
  expect(xml.match(/<w:br\b[^>]*w:type="page"/g)).toHaveLength(count);
  expect(xml).toMatch(/Writer brings famili<\/w:t>[\s\S]*?<w:br w:type="page"\/>[\s\S]*?ar document tools/);

  await page.evaluate(() => (window as any).testEngine.command('undo'));
  await expect.poll(() => page.evaluate(async () => (window as any).testEngine.api.getText({}))).toBe(result.original);
  await expect.poll(() => page.evaluate(() => (window as any).snapshot.pages)).toBe(3);
  await page.evaluate(() => (window as any).testEngine.command('redo'));
  await expect.poll(() => page.evaluate(async () => (await (window as any).testEngine.api.selection.current()).selectionTarget.start.offset)).toBe(21);
  await page.getByRole('textbox', { name: 'Document content' }).focus();
  await page.keyboard.type('X');
  await expect.poll(() => page.evaluate(async () => (window as any).testEngine.api.getText({}))).toContain(`Writer brings famili\nX${blank ? '\n' : ''}ar document tools`);

  await page.route(url => url.pathname === '/tests/writer/adapter-roundtrip.docx', route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  await mount(page, '/tests/writer/adapter-roundtrip.docx');
  await expect.poll(() => page.evaluate(() => (window as any).snapshot.pages)).toBe(3 + count);
  expect(await page.evaluate(async () => (window as any).testEngine.api.getText({}))).toBe(result.edited);
});

for (const reviewing of [false, true]) for (const selected of [false, true]) test(`${selected ? 'selected-text replacement' : 'text insertion'} resumes after pasted or inserted text in ${reviewing ? 'Reviewing' : 'Editing'}, including after Undo/Redo`, async ({ page }) => {
  await mount(page, '');
  await page.evaluate(() => (window as any).testEngine.insertTextAtSelection('Before After'));
  const value = reviewing && selected ? 'PA\n👩🏽‍💻STED' : 'PASTED';
  if (reviewing) {
    await page.evaluate(() => (window as any).testEngine.setMode('suggesting'));
    await expect.poll(() => page.evaluate(() => (window as any).testEngine.ui.state.documentMode)).toBe('suggesting');
  }
  const result = await page.evaluate(async ({ selected, value }) => {
    const e = (window as any).testEngine, { blocks } = await e.api.blocks.list({ limit: 1 });
    const point = { kind: 'text', blockId: blocks[0].nodeId, offset: 7 };
    await e.ui.selection.applyAndWait({ kind: 'selection', start: point, end: { ...point, offset: selected ? 12 : 7 } });
    await e.insertTextAtSelection(value);
    const edited = await e.api.getText({}), caret = (await e.api.selection.current()).selectionTarget.start.offset;
    const changes = await e.api.trackChanges.list({});
    await e.command('undo'); const undone = await e.api.getText({});
    await e.command('redo'); const redoneCaret = (await e.api.selection.current()).selectionTarget.start.offset;
    return { edited, caret, undone, redoneCaret, changes: changes.total };
  }, { selected, value });
  expect(result.edited).toBe(`Before ${value}${selected ? '' : 'After'}`);
  expect(result.caret).toBe(7 + value.length); expect(result.redoneCaret).toBe(7 + value.length);
  expect(result.undone).toBe('Before After'); expect(result.changes).toBe(reviewing ? 1 : 0);
  await page.getByRole('textbox', { name: 'Document content' }).focus(); await page.keyboard.type('X');
  await expect.poll(() => page.evaluate(async () => (window as any).testEngine.api.getText({}))).toBe(`Before ${value}X${selected ? '' : 'After'}`);
});

test('One Page fits the active page within both viewport dimensions at different zooms and sizes', async ({ page }) => {
  await mount(page);
  const original = await page.evaluate(async () => (window as any).testEngine.api.getText({}));
  for (const viewport of [{ width: 1366, height: 900 }, { width: 860, height: 600 }]) {
    await page.setViewportSize(viewport);
    for (const zoom of [50, 150]) {
      await page.evaluate(zoom => (window as any).testEngine.setZoom(zoom), zoom);
      await expect.poll(() => page.evaluate(() => (window as any).testEngine.ui.state.zoom.value)).toBe(zoom);
      await page.evaluate(() => (window as any).testEngine.fitPage());
      await expect.poll(() => page.evaluate(() => {
        const host = document.getElementById('root')!, viewport = host.getBoundingClientRect();
        const page = host.querySelector('.superdoc-page')!.getBoundingClientRect();
        return page.width <= host.clientWidth && page.height <= host.clientHeight && page.top >= viewport.top - 1 && page.bottom <= viewport.bottom + 1;
      })).toBe(true);
      expect(await page.evaluate(() => (window as any).testEngine.ui.state.zoom.value)).toBeLessThan(100);
    }
  }
  expect(await page.evaluate(async () => (window as any).testEngine.api.getText({}))).toBe(original);
});

test('paper sizes preserve landscape orientation and standard margin presets retain their asymmetric sides', async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const e = (window as any).testEngine;
    await e.pageSetup('orientation', 'landscape'); await e.pageSetup('size', 'A4');
  });
  const section = await page.evaluate(async () => (await (window as any).testEngine.api.sections.list({})).items[0]);
  expect(section.pageSetup.orientation).toBe('landscape');
  expect(section.pageSetup.width).toBeGreaterThan(section.pageSetup.height);
  expect(section.pageSetup.width).toBeCloseTo(11.6929, 2);
  expect(section.pageSetup.height).toBeCloseTo(8.2677, 2);
  for (const [preset, vertical, horizontal] of [['normal', 1440, 1440], ['narrow', 720, 720], ['moderate', 1440, 1080], ['wide', 1440, 2880]] as const) {
    await page.evaluate(preset => (window as any).testEngine.pageMargins(preset), preset);
    const xml = documentXml(await exported(page));
    const margins = xml.match(/<w:pgMar\b[^>]*\/>/)?.[0] || '';
    for (const side of ['top', 'bottom']) expect(margins).toContain(`w:${side}="${vertical}"`);
    for (const side of ['left', 'right']) expect(margins).toContain(`w:${side}="${horizontal}"`);
  }
});

test('Reviewing tracks public formatting and replacement commands and prevents untracked page-break writes', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as any).testEngine.setMode('suggesting'));
  await expect.poll(() => page.evaluate(() => (window as any).testEngine.ui.state.documentMode)).toBe('suggesting');
  const result = await page.evaluate(async () => {
    const e = (window as any).testEngine;
    const target = { kind: 'selection', start: { kind: 'text', blockId: '00000001', offset: 0 }, end: { kind: 'text', blockId: '00000001', offset: 6 } };
    const inline = await e.invoke('format.apply', { target, inline: { bold: true } });
    const paragraph = await e.invoke('format.paragraph.applyBatch', { targets: [{ kind: 'block', nodeType: 'paragraph', nodeId: '00000003' }], operations: [{ operationId: 'format.paragraph.setAlignment', input: { alignment: 'center' } }] });
    const replace = await e.invoke('replace', { target: { kind: 'selection', start: { kind: 'text', blockId: '00000007', offset: 0 }, end: { kind: 'text', blockId: '00000007', offset: 4 } }, text: 'That' });
    const changes = await e.api.trackChanges.list({});
    const text = await e.api.getText({}), revision = e.snapshot.revision;
    let error = ''; try { await e.insertPageBreak(); } catch (cause) { error = String(cause); }
    return { inline, paragraph, replace, changes, error, preservedText: text === await e.api.getText({}), preservedRevision: revision === e.snapshot.revision };
  });
  for (const receipt of [result.inline, result.paragraph, result.replace]) expect(receipt.appliedChangeMode).toBe('tracked');
  expect(result.changes.total).toBeGreaterThanOrEqual(3);
  expect(result.error).toContain('Switch to Editing mode');
  expect(result.preservedText).toBe(true); expect(result.preservedRevision).toBe(true);
});
