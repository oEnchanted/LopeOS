import { test, expect, type Page } from '@playwright/test';

async function mount(page: Page, file = '') {
  await page.goto(`/tests/writer/harness.html?engine${file ? '&file=' + file : ''}`);
  await page.waitForFunction(() => (window as any).engineReady, null, { timeout: 40000 });
}
async function picture(page: Page, blockId = '00000001') {
  return page.evaluate(async blockId => {
    const e = (window as any).testEngine, canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ef4444'; context.fillRect(0, 0, 50, 100); context.fillStyle = '#2563eb'; context.fillRect(50, 0, 50, 100);
    const result = await e.api.create.image({ src: canvas.toDataURL(), alt: 'Crop colors', size: { width: 160, height: 80, unit: 'px' }, at: { kind: 'inParagraph', target: { kind: 'block', nodeType: 'paragraph', nodeId: blockId }, offset: 0 } });
    if (!result.success) throw new Error(result.failure.message);
    return result.image.nodeId as string;
  }, blockId);
}
async function quarterPixel(page: Page, selector = '[data-sd-image-id]') {
  const box = await page.locator(selector).first().boundingBox(); if (!box) throw new Error('The picture has no painted box.');
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(image.width / 4), Math.floor(image.height / 2), 1, 1).data].slice(0, 3);
  }, png.toString('base64'));
}
function color(actual: number[], expected: number[]) { expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThan(3)); }

for (const zoom of [100, 150]) test(`public crop percentages visibly change native image pixels at ${zoom}% without changing its hit box`, async ({ page }) => {
  await mount(page); const imageId = await picture(page);
  await expect(page.locator('[data-sd-image-id]')).toHaveCount(1);
  await page.evaluate(zoom => (window as any).testEngine.setZoom(zoom), zoom);
  await expect.poll(() => page.locator('[data-sd-image-id]').boundingBox().then(box => Math.round(box!.width))).toBe(160 * zoom / 100);
  const before = await page.locator('[data-sd-image-id]').boundingBox(); color(await quarterPixel(page), [239, 68, 68]);
  await page.evaluate(imageId => (window as any).testEngine.api.images.crop({ imageId, crop: { left: 50, right: 0, top: 0, bottom: 0 } }), imageId);
  await expect(page.locator('[data-writer-image-presentation="crop"]')).toHaveCount(1);
  await expect.poll(() => quarterPixel(page)).toEqual([37, 99, 235]);
  expect(await page.locator('[data-sd-image-id]').boundingBox()).toEqual(before);
  await expect(page.locator('[data-sd-image-id]')).toHaveCSS('opacity', '0');
  await expect(page.locator('[data-writer-image-presentation="crop"]')).toHaveCSS('pointer-events', 'none');
  const revision = await page.evaluate(async () => (await (window as any).testEngine.api.info({})).revision);
  await page.evaluate(zoom => (window as any).testEngine.setZoom(zoom + 5), zoom);
  await page.evaluate(zoom => (window as any).testEngine.setZoom(zoom), zoom);
  expect(await page.evaluate(async () => (await (window as any).testEngine.api.info({})).revision)).toBe(revision);
  await page.evaluate(imageId => (window as any).testEngine.api.images.resetCrop({ imageId }), imageId);
  await expect(page.locator('[data-writer-image-presentation="crop"]')).toHaveCount(0);
  await expect(page.locator('[data-sd-image-id]')).toHaveCSS('opacity', '1');
  color(await quarterPixel(page), [239, 68, 68]);
});

test('crop mirrors cache reads, clear stale sources, follow native asset arrival, and clean up on disposal', async ({ page }) => {
  await mount(page); const imageId = await picture(page);
  await page.evaluate(imageId => (window as any).testEngine.api.images.crop({ imageId, crop: { left: 50 } }), imageId);
  await expect.poll(() => quarterPixel(page)).toEqual([37, 99, 235]);
  await page.evaluate(() => {
    const api = (window as any).testEngine.api, get = api.images.get;
    (window as any).imageModelReads = 0;
    api.images.get = (...args: any[]) => { (window as any).imageModelReads++; return get(...args); };
  });
  for (const zoom of [150, 100]) {
    await page.evaluate(zoom => (window as any).testEngine.setZoom(zoom), zoom);
    await expect.poll(() => page.locator('[data-sd-image-id]').boundingBox().then(box => Math.round(box!.width))).toBe(160 * zoom / 100);
    color(await quarterPixel(page), [37, 99, 235]);
  }
  expect(await page.evaluate(() => (window as any).imageModelReads)).toBe(0);
  const replacement = await page.evaluate(async imageId => {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const context = canvas.getContext('2d')!; context.fillStyle = '#facc15'; context.fillRect(0, 0, 50, 100); context.fillStyle = '#16a34a'; context.fillRect(50, 0, 50, 100);
    const src = canvas.toDataURL(), receipt = await (window as any).testEngine.api.images.replaceSource({ imageId, src });
    return { src, receipt };
  }, imageId);
  expect(replacement.receipt.success).toBe(true);
  await expect(page.locator('[data-writer-image-presentation="crop"]')).toHaveCount(0);
  await expect(page.locator('[data-sd-image-id]')).toHaveCSS('opacity', '1');
  // Model replacement can precede the native painter's asynchronous media URL.
  // Emulate that separate native paint delivery; the document model stays owned
  // by the successful replaceSource operation above.
  await page.evaluate(src => { document.querySelector<HTMLImageElement>('img[data-sd-image-id]')!.src = src; }, replacement.src);
  await expect.poll(() => quarterPixel(page)).toEqual([22, 163, 74]);
  await expect(page.locator('[data-writer-image-presentation="crop"]')).toHaveCount(1);
  const cleanup = await page.evaluate(() => {
    const original = document.querySelector<HTMLImageElement>('img[data-sd-image-id]')!;
    (window as any).testEngine.destroy();
    return { opacity: original.style.opacity, mirrors: document.querySelectorAll('[data-writer-image-presentation]').length };
  });
  expect(cleanup).toEqual({ opacity: '', mirrors: 0 });
});

test('read-only print mount reflects cropped pictures before cloning complete print pages', async ({ page }) => {
  await mount(page, '/tests/writer/fixtures/multipage.docx'); const imageId = await picture(page, '00000007');
  await page.evaluate(imageId => (window as any).testEngine.api.images.crop({ imageId, crop: { left: 50 } }), imageId);
  const result = await page.evaluate(async () => {
    const e = (window as any).testEngine, bytes = await e.export();
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(name => new URL(name).pathname === '/packages/document-engine/src/index.ts')!;
    const { WriterEngine } = await import(moduleUrl), { createPrintHtml } = await import('/apps/web/src/apps/writer/print.ts');
    const host = document.createElement('div'); host.className = 'writer-app'; host.style.cssText = 'position:absolute;inset:0;overflow:auto;background:white'; document.body.append(host);
    const printEngine = new WriterEngine(() => {}, () => {}); await printEngine.mount(host, bytes, true, true);
    const mirrors = host.querySelectorAll('[data-writer-image-presentation="crop"]').length;
    const html = createPrintHtml(host, printEngine.snapshot.pages);
    const original = host.querySelector<HTMLImageElement>('img[data-sd-image-id]')!;
    printEngine.destroy();
    return { mirrors, html, restoredOpacity: original.style.opacity, decoratorsAfterDispose: host.querySelectorAll('[data-writer-image-presentation]').length };
  });
  expect(result.mirrors).toBe(1);
  expect(result.html).toContain('data-writer-image-presentation="crop"');
  expect(result.html).toContain('aria-hidden="true" role="presentation"');
  expect(result.html).toContain('overflow: hidden');
  expect(result.restoredOpacity).toBe(''); expect(result.decoratorsAfterDispose).toBe(0);
});
