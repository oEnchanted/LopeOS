import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { LEGACY_MODEL_IDS, MODEL_DOWNLOAD_LABEL, MODEL_IDS, MODEL_NAME } from '../../apps/web/src/shell/spotlight-ai/core';
import { expectFooterInViewport, freshSetup, next, panel, reachLocalAI } from './helpers';

const modelRequest = (url: string) => /\/models\/(?:denoise|portrait)|huggingface\.co|cdn\.jsdelivr\.net\/.*onnxruntime-web|raw\.githubusercontent\.com.*(?:wasm|bin|json)/.test(url);
const model = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-model-id="${id}"]`);

test('Local AI explains all browser models, stays optional, and never downloads on its own', async ({ page }) => {
  const downloads: string[] = [];
  page.on('request', request => { if (modelRequest(request.url())) downloads.push(request.url()); });
  await freshSetup(page);
  await reachLocalAI(page);
  const navigation = page.getByRole('navigation', { name: 'Setup progress' });
  await expect(navigation.getByRole('button')).toHaveCount(7);
  await expect(navigation.getByRole('button', { name: 'Local AI', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(model(page, 'spotlight')).toContainText(MODEL_NAME);
  await expect(model(page, 'spotlight')).toContainText(MODEL_DOWNLOAD_LABEL);
  await expect(panel(page)).toContainText('FFDNet');
  await expect(panel(page)).toContainText('MODNet');
  await expect(panel(page).getByRole('button', { name: 'Download all models', exact: true })).toBeVisible();
  await expect(model(page, 'denoise')).toHaveAttribute('data-status', /available|installed/);
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('lope.accounts.v1'))).toBeNull();
  await next(page);
  await expect(page.getByRole('heading', { name: 'LopeOS Account', exact: true })).toBeFocused();
  expect(downloads).toEqual([]);
});

test('real model byte progress and speed continue across setup navigation and can be cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseDownload!: () => void;
  const held = new Promise<void>(resolve => { releaseDownload = resolve; });
  // The real model and small engine files transfer first; hold the final real WASM file.
  // This exposes an in-progress download without changing byte counts or bypassing integrity checks.
  const wasm = await readFile(resolve(import.meta.dirname, '../../public/models/denoise/engine/ort-wasm-simd-threaded.wasm'));
  await page.route('**/models/denoise/engine/ort-wasm-simd-threaded.wasm', async route => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/wasm', body: wasm }).catch(() => {});
  });
  try {
    await freshSetup(page);
    await reachLocalAI(page);
    await model(page, 'denoise').getByRole('button', { name: 'Download Photo denoise', exact: true }).click();
    await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'downloading');
    const progress = model(page, 'denoise').getByRole('progressbar', { name: 'Photo denoise download progress', exact: true });
    await expect(progress).toBeVisible();
    await expect.poll(() => progress.evaluate(element => element instanceof HTMLProgressElement ? element.value : Number(element.getAttribute('aria-valuenow')))).toBeGreaterThan(0);
    const progressValue = await progress.evaluate(element => element instanceof HTMLProgressElement ? element.value / element.max : Number(element.getAttribute('aria-valuenow')) / Number(element.getAttribute('aria-valuemax') || 100));
    expect(progressValue).toBeLessThan(1);
    await expect(model(page, 'denoise')).toContainText(/\d(?:[\d.]*)\s*MB\/s/);
    await expectFooterInViewport(page);
    await next(page);
    await expect(page.getByRole('heading', { name: 'LopeOS Account', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button', { name: 'Local AI', exact: true }).click();
    await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'downloading');
    await panel(page).getByRole('button', { name: 'Cancel download', exact: true }).click();
    await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'cancelled');
    await expect(panel(page).getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  } finally { releaseDownload(); }
});

test('failed model downloads can retry, verify the real package, and reuse it after reload', async ({ page }) => {
  let first = true;
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/models/denoise/')) requests.push(request.url()); });
  await page.route('**/models/denoise/ffdnet-color-v1.onnx', async route => {
    if (first) { first = false; await route.fulfill({ status: 503, body: 'Temporarily unavailable' }); }
    else await route.continue();
  });
  await freshSetup(page);
  await reachLocalAI(page);
  await model(page, 'denoise').getByRole('button', { name: 'Download Photo denoise', exact: true }).click();
  await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'error');
  await expect(model(page, 'denoise').getByRole('alert')).toBeVisible();
  await model(page, 'denoise').getByRole('button', { name: 'Retry Photo denoise', exact: true }).click();
  await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'installed', { timeout: 20000 });
  const installation = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => new URL(url).pathname === '/packages/photo-engine/src/denoise-cache.ts').at(-1)!;
    const { installedDenoise } = await import(url);
    const record = await installedDenoise();
    return { id: record?.id, bytes: record?.totalBytes, files: Object.keys(record?.files ?? {}) };
  });
  expect(installation).toEqual({ id: 'ffdnet-color-clip-v1', bytes: 18362651, files: ['model', 'runtime', 'loader', 'wasm'] });
  const completedRequests = requests.length;
  await page.reload();
  await reachLocalAI(page);
  await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'installed');
  expect(requests).toHaveLength(completedRequests);
});

test('Download all queues supported models and cancelling clears the remaining queue', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }); });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/models/denoise/ffdnet-color-v1.onnx', async route => {
    await blocked;
    await route.abort().catch(() => {});
  });
  try {
    await freshSetup(page);
    await reachLocalAI(page);
    await expect(model(page, 'spotlight')).toHaveAttribute('data-status', 'unsupported');
    await panel(page).getByRole('button', { name: 'Download all models', exact: true }).click();
    await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'downloading');
    await expect(model(page, 'portrait')).toHaveAttribute('data-status', 'queued');
    await panel(page).getByRole('button', { name: 'Cancel download', exact: true }).click();
    await expect(model(page, 'denoise')).toHaveAttribute('data-status', 'cancelled');
    await expect(model(page, 'portrait')).not.toHaveAttribute('data-status', 'queued');
    await expect(panel(page).getByRole('button', { name: 'Download all models', exact: true })).toBeEnabled();
  } finally { release(); }
});

test('Spotlight download replaces legacy caches, reuses current weights, and never loads inference', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
      requestAdapter: async () => ({ features: new Set(['shader-f16']), requestDevice: () => { throw new Error('A download must not start inference.'); } }),
    } });
  });
  const downloaded: string[] = [];
  const weights = Buffer.alloc(512 * 1024, 37);
  const spotlightModel = prebuiltAppConfig.model_list.find(record => record.model_id === MODEL_IDS[0]);
  expect(spotlightModel?.model_lib).toBeTruthy();
  const modelBase = `${spotlightModel!.model.replace(/\/$/, '')}/resolve/main/`;
  const outdatedModels = prebuiltAppConfig.model_list.filter(record => LEGACY_MODEL_IDS.includes(record.model_id)).map(({ model, model_lib }) => ({ model, model_lib }));
  const unexpectedDownloads: string[] = [];
  await page.route(/https:\/\/(?:huggingface\.co|raw\.githubusercontent\.com)\//, route => {
    unexpectedDownloads.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  // Small network fixtures exercise package/cache integration, not model inference quality.
  await page.route(url => url.href.startsWith(modelBase) || url.href === spotlightModel!.model_lib, async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').at(-1)!;
    downloaded.push(name);
    const body = name === 'mlc-chat-config.json' ? Buffer.from(JSON.stringify({ tokenizer_files: ['tokenizer.json'] }))
      : name === 'tensor-cache.json' ? Buffer.from(JSON.stringify({ records: [{ dataPath: 'params_shard_0.bin', nbytes: weights.length }] }))
        : name === 'tokenizer.json' ? Buffer.from('{"fixture":"tokenizer"}')
          : name.endsWith('.wasm') ? Buffer.alloc(32, 0) : name === 'params_shard_0.bin' ? weights : null;
    if (!body) throw new Error(`Unexpected fixture request: ${url.href}`);
    await route.fulfill({ status: 200, contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream', headers: { 'content-length': String(body.length) }, body });
  });
  await freshSetup(page);
  await page.evaluate(async ({ outdatedModels, modelBase, weightBytes }) => {
    for (const old of outdatedModels) {
      const oldBase = `${old.model.replace(/\/$/, '')}/resolve/main/`;
      await (await caches.open('webllm/config')).put(`${oldBase}mlc-chat-config.json`, new Response('{}'));
      await (await caches.open('webllm/model')).put(`${oldBase}params_shard_0.bin`, new Response('old weights'));
      await (await caches.open('webllm/wasm')).put(old.model_lib, new Response('old runtime'));
    }
    const modelCache = await caches.open('webllm/model');
    await modelCache.put(`${modelBase}params_shard_0.bin`, new Response(new Uint8Array(weightBytes).fill(37), { headers: { 'content-length': String(weightBytes) } }));
    await modelCache.put('https://example.test/another-model/keep.bin', new Response('unrelated model'));
  }, { outdatedModels, modelBase, weightBytes: weights.length });
  await reachLocalAI(page);
  await expect(model(page, 'spotlight')).toHaveAttribute('data-status', 'available');
  await model(page, 'spotlight').getByRole('button', { name: 'Download Spotlight AI', exact: true }).click();
  await expect(model(page, 'spotlight')).toHaveAttribute('data-status', 'installed');
  expect(downloaded).toHaveLength(4);
  expect(downloaded).toEqual(expect.arrayContaining(['mlc-chat-config.json', 'tensor-cache.json', 'tokenizer.json']));
  expect(downloaded).not.toContain('params_shard_0.bin');
  expect(unexpectedDownloads).toEqual([]);
  const cached = await page.evaluate(async () => {
    const results: Record<string, string[]> = {};
    for (const scope of ['webllm/config', 'webllm/model', 'webllm/wasm']) {
      const cache = await caches.open(scope);
      results[scope] = (await cache.keys()).map(request => new URL(request.url).pathname.split('/').at(-1)!);
    }
    return results;
  });
  expect(cached['webllm/config']).toEqual(['mlc-chat-config.json']);
  expect(cached['webllm/model']).toEqual(expect.arrayContaining(['tensor-cache.json', 'tokenizer.json', 'params_shard_0.bin']));
  expect(cached['webllm/model']).toHaveLength(4);
  expect(cached['webllm/model']).toContain('keep.bin');
  expect(cached['webllm/wasm']).toHaveLength(1);
  await page.reload();
  await reachLocalAI(page);
  await expect(model(page, 'spotlight')).toHaveAttribute('data-status', 'installed');
  expect(downloaded).toHaveLength(4);
  expect(unexpectedDownloads).toEqual([]);
});
