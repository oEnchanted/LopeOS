import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../../packages/document-engine/node_modules/fflate');
async function mount(page: Page, file = '') {
  await page.goto(`/tests/writer/harness.html?engine${file ? '&file=' + file : ''}`);
  await page.waitForFunction(() => (window as any).engineReady, null, { timeout: 40000 });
}
async function createImage(page: Page, blockId = '00000001', offset = 7, alt = 'First picture') {
  return page.evaluate(async ({ blockId, offset, alt }) => {
    const e = (window as any).testEngine;
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 50;
    const context = canvas.getContext('2d')!; context.fillStyle = '#185abd'; context.fillRect(0, 0, 100, 50);
    const created = await e.api.create.image({ src: canvas.toDataURL(), alt, size: { width: 160, height: 80, unit: 'px' }, at: { kind: 'inParagraph', target: { kind: 'block', nodeType: 'paragraph', nodeId: blockId }, offset } });
    if (!created.success) throw new Error(created.failure.message);
    return created.image.nodeId as string;
  }, { blockId, offset, alt });
}
async function blankWithImage(page: Page) {
  await mount(page); await page.evaluate(() => (window as any).testEngine.insertTextAtSelection('Before after'));
  const imageId = await createImage(page); await expect(page.locator('[data-sd-image-id]')).toHaveCount(1);
  return imageId;
}
async function xml(page: Page) {
  const bytes = new Uint8Array(await page.evaluate(async () => Array.from(await (window as any).testEngine.export()) as number[]));
  return strFromU8(unzipSync(bytes)['word/document.xml']) as string;
}

test('native image hit mapping distinguishes two canonical identities and floating frames', async ({ page }) => {
  const first = await blankWithImage(page), second = await createImage(page, '00000001', 8, 'Second picture');
  await expect(page.locator('[data-sd-image-id]')).toHaveCount(2);
  const inline = await page.evaluate(async () => {
    const e = (window as any).testEngine;
    const frames = [...document.querySelectorAll<HTMLElement>('[data-sd-image-id]')];
    return Promise.all(frames.map(async element => ({ raw: element.dataset.sdImageId, image: await e.resolveImageAt(element) })));
  });
  expect(inline.map(hit => hit.image?.sdImageId)).toEqual([first, second]);
  expect(inline.every(hit => hit.raw !== hit.image?.sdImageId)).toBe(true);
  await page.evaluate(imageId => (window as any).testEngine.api.images.convertToFloating({ imageId }), first);
  await expect(page.locator('.superdoc-floating-fragment[data-sd-image-id]')).toHaveCount(1);
  const floating = await page.evaluate(async () => {
    const e = (window as any).testEngine, frame = document.querySelector<HTMLElement>('.superdoc-floating-fragment[data-sd-image-id]')!;
    const image = await e.resolveImageAt(frame);
    return { id: image?.sdImageId, placement: image?.properties.placement };
  });
  expect(floating).toEqual({ id: first, placement: 'floating' });
  // A missing or stale rendered hit must never pick the last image in the list.
  expect(await page.evaluate(() => (window as any).testEngine.resolveImageAt(document.createElement('img')))).toBeNull();
});

test('identical reopened pictures in one images-only paragraph retain independent canonical hits', async ({ page }) => {
  await mount(page);
  const first = await createImage(page, '00000001', 0, 'Same picture'), second = await createImage(page, '00000001', 0, 'Same picture');
  const sourceOrder = await page.evaluate(async () => (await (window as any).testEngine.api.find({ select: { type: 'node', nodeType: 'image' } })).items.map((item: any) => item.node.id));
  const bytes = new Uint8Array(await page.evaluate(async () => Array.from(await (window as any).testEngine.export()) as number[]));
  await page.route(url => url.pathname === '/tests/writer/identical-images.docx', route => route.fulfill({ body: Buffer.from(bytes) }));
  await mount(page, '/tests/writer/identical-images.docx');
  await expect(page.locator('img[data-sd-image-id]')).toHaveCount(2);
  const identities = await page.evaluate(async () => {
    const e = (window as any).testEngine;
    return Promise.all([...document.querySelectorAll<HTMLElement>('img[data-sd-image-id]')].map(async image => (await e.resolveImageAt(image))?.sdImageId));
  });
  expect(new Set(identities)).toEqual(new Set([first, second]));
  expect(identities).toEqual(sourceOrder);
});

test('floating positions use document pixels, survive native history, and stay correct at zoom', async ({ page }) => {
  const imageId = await blankWithImage(page);
  const before = await page.evaluate(async imageId => {
    const e = (window as any).testEngine; await e.api.images.convertToFloating({ imageId });
    await e.resolveImageAt(document.querySelector('.superdoc-floating-fragment[data-sd-image-id]'));
    const original = (await e.api.images.get({ imageId })).properties;
    await e.positionImage(imageId, { horizontal: 100, top: 220 });
    return original;
  }, imageId);
  const saved = await xml(page);
  expect(saved).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>952500</wp:posOffset>');
  expect(saved).toContain('<wp:positionV relativeFrom="page"><wp:posOffset>2095500</wp:posOffset>');
  await page.evaluate(() => (window as any).testEngine.command('undo'));
  expect(await page.evaluate(async imageId => (await (window as any).testEngine.api.images.get({ imageId })).properties, imageId)).toEqual(before);
  await page.evaluate(() => (window as any).testEngine.command('redo'));
  expect(await page.evaluate(async imageId => (await (window as any).testEngine.api.images.get({ imageId })).properties.marginOffset, imageId)).toEqual({ horizontal: 100, top: 220 });
  await page.evaluate(() => (window as any).testEngine.setZoom(150));
  await expect.poll(() => page.evaluate(() => (window as any).testEngine.ui.state.zoom.value)).toBe(150);
  await page.evaluate(imageId => (window as any).testEngine.positionImage(imageId, { horizontal: 150, top: 240 }), imageId);
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector('.superdoc-floating-fragment[data-sd-image-id]')!, page = frame.closest('.superdoc-page')!;
    const rect = frame.getBoundingClientRect(), paper = page.getBoundingClientRect();
    return Math.abs(rect.left - paper.left - 150 * 1.5) < 2 && Math.abs(rect.top - paper.top - 240 * 1.5) < 2;
  })).toBe(true);
});

test('inline drag reanchors the actual picture across paragraphs with one undo and a stable saved identity', async ({ page }) => {
  await mount(page, '/tests/writer/fixtures/multipage.docx');
  const imageId = await createImage(page, '00000003', 7);
  const target = { kind: 'selection', start: { kind: 'text', blockId: '00000007', offset: 5 }, end: { kind: 'text', blockId: '00000007', offset: 5 } };
  const result = await page.evaluate(async ({ imageId, target }) => {
    const e = (window as any).testEngine;
    const address = async () => (await e.api.images.list({})).items.find((image: any) => image.sdImageId === imageId).address;
    const before = await address(); await e.moveImageToSelection(imageId, target); const moved = await address();
    await e.command('undo'); const undone = await address(); await e.command('redo'); const redone = await address();
    return { before, moved, undone, redone };
  }, { imageId, target });
  expect(result.moved.blockId).toBe('00000007'); expect(result.moved.offset).toBe(5);
  expect(result.undone).toEqual(result.before); expect(result.redone).toEqual(result.moved);
  const saved = await xml(page);
  expect(saved.match(/<w:p\b[^>]*w14:paraId="00000007"[\s\S]*?<\/w:p>/)?.[0]).toContain('First picture');
});

test('native image size, crop percentages and rotation export actual Word structures and undo independently', async ({ page }) => {
  const imageId = await blankWithImage(page);
  await page.evaluate(async imageId => {
    const e = (window as any).testEngine;
    await e.api.images.setSize({ imageId, size: { width: 240, height: 120, unit: 'px' } });
    await e.api.images.crop({ imageId, crop: { left: 10, top: 20, right: 15, bottom: 5 } });
    await e.api.images.rotate({ imageId, angle: 30 });
  }, imageId);
  const saved = await xml(page);
  expect(saved).toContain('<wp:extent cx="2286000" cy="1143000"');
  expect(saved).toContain('<a:srcRect l="10000" t="20000" r="15000" b="5000"');
  expect(saved).toContain('<a:xfrm rot="1800000"');
  await page.evaluate(() => (window as any).testEngine.command('undo'));
  const unrotated = await page.evaluate(async imageId => (await (window as any).testEngine.api.images.get({ imageId })).properties, imageId);
  expect(unrotated.transform?.rotation || 0).toBe(0); expect(unrotated.crop?.left).toBe(10);
  await page.evaluate(() => (window as any).testEngine.command('undo'));
  expect(await page.evaluate(async imageId => (await (window as any).testEngine.api.images.get({ imageId })).properties.crop, imageId)).toBeNull();
  await page.evaluate(() => (window as any).testEngine.command('undo'));
  expect(await page.evaluate(async imageId => (await (window as any).testEngine.api.images.get({ imageId })).properties.size, imageId)).toEqual({ width: 160, height: 80, unit: 'px' });
});

test('image drag helpers reject read mode, invalid positions, and stale native reads without moving pictures', async ({ page }) => {
  const imageId = await blankWithImage(page);
  const result = await page.evaluate(async imageId => {
    const e = (window as any).testEngine;
    const point = { kind: 'text', blockId: '00000001', offset: 2 }, target = { kind: 'selection', start: point, end: point };
    const errors: string[] = [];
    e.setMode('viewing'); await new Promise(resolve => setTimeout(resolve, 40));
    for (const action of [() => e.moveImageToSelection(imageId, target), () => e.positionImage(imageId, { horizontal: 20, top: 20 })]) {
      try { await action(); } catch (cause) { errors.push(String(cause)); }
    }
    e.setMode('editing'); await new Promise(resolve => setTimeout(resolve, 40));
    await e.api.images.convertToFloating({ imageId });
    for (const position of [{ horizontal: -1, top: 0 }, { horizontal: Number.NaN, top: 0 }, { horizontal: 100000, top: 0 }]) {
      try { await e.positionImage(imageId, position); } catch (cause) { errors.push(String(cause)); }
    }
    const original = (await e.api.images.get({ imageId })).properties;
    const api = e.api, info = api.info;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    api.info = async (...args: any[]) => { const result = await info(...args); await gate; return result; };
    const pending = e.positionImage(imageId, { horizontal: 100, top: 100 }).catch((cause: unknown) => errors.push(String(cause)));
    await new Promise(resolve => setTimeout(resolve, 30));
    await api.insert({ target, value: 'Changed' }); release(); await pending; api.info = info;
    const after = (await api.images.get({ imageId })).properties;
    return { errors, original, after };
  }, imageId);
  expect(result.errors).toHaveLength(6);
  expect(result.errors[0]).toContain('Editing or Reviewing'); expect(result.errors[1]).toContain('Editing or Reviewing');
  expect(result.errors.at(-1)).toContain('document changed');
  expect(result.after).toEqual(result.original);
});
