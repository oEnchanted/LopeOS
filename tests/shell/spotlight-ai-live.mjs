/** Optional real WebGPU/model smoke check. No mocked GPU, worker, or model responses.
 * Probe: node tests/shell/spotlight-ai-live.mjs
 * Download and run the actual model: LOPE_AI_REAL=1 node tests/shell/spotlight-ai-live.mjs
 * The probe uses an isolated browser profile and never touches user chats/clipboard.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const artifactDirectory = new URL('./screenshots/', import.meta.url);
const realInference = process.env.LOPE_AI_REAL === '1';
const channel = process.env.LOPE_AI_BROWSER_CHANNEL || 'chromium';
const browser = process.env.LOPE_AI_PROFILE
  ? await chromium.launchPersistentContext(process.env.LOPE_AI_PROFILE, { headless: true, ...(channel ? { channel } : {}) })
  : await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const report = { mode: realInference ? 'real-model-inference' : 'real-browser-probe', channel, userAgent: '', webgpu: null, modelMetadata: null, outcome: 'not-run' };
const prompts = ['where is paris france', 'What river runs through it?', 'Write a friendly two-sentence note telling Sam I will be ten minutes late.', 'Where in France is Paris?'];
const remoteRequests = [];
try {
  const page = await browser.newPage();
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== new URL(origin).origin) remoteRequests.push({
      origin: url.origin, method: request.method(), leakedPrompt: prompts.some(prompt => request.url().includes(prompt) || (request.postData() || '').includes(prompt)),
    });
  });
  await page.goto(origin + '/tests/shell/spotlight-ai-benchmark.html', { waitUntil: 'domcontentloaded' });
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  report.webgpu = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (!gpu) return { secureContext: isSecureContext, available: false, reason: 'This browser does not expose navigator.gpu.' };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { secureContext: isSecureContext, available: false, reason: 'WebGPU did not provide a compatible adapter.' };
    const features = [...adapter.features];
    const device = await adapter.requestDevice();
    const info = adapter.info;
    const details = { secureContext: isSecureContext, available: true, features,
      info: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
      maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
    device.destroy();
    return details;
  });
  report.outcome = report.webgpu.available ? 'gpu-available' : 'unsupported';
  if (process.env.LOPE_AI_METADATA === '1') {
    report.modelMetadata = await page.evaluate(async () => {
      const { MODEL_IDS } = await import('/apps/web/src/shell/spotlight-ai/core.ts');
      const endpoint = `https://huggingface.co/api/models/mlc-ai/${MODEL_IDS[0]}/tree/main`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Model metadata unavailable: ${response.status}`);
      const files = await response.json();
      return { endpoint, bytes: files.reduce((sum, file) => sum + (file.size || 0), 0),
        weightBytes: files.filter(file => file.path.endsWith('.bin')).reduce((sum, file) => sum + file.size, 0),
        files: files.map(file => ({ path: file.path, bytes: file.size })) };
    });
  }
  if (realInference && report.webgpu.available) {
    if (process.env.LOPE_AI_MIGRATION === '1') {
      // Small cache fixtures only; inference still uses the actual downloaded production model.
      report.legacyFixtureKeys = await page.evaluate(async () => {
        const keys = [];
        for (const id of ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f32_1-MLC']) {
          const base = `https://huggingface.co/mlc-ai/${id}/resolve/main/`;
          const entries = [
            ['webllm/model', 'tensor-cache.json', JSON.stringify({ records: [{ dataPath: 'params_shard_0.bin' }] })],
            ['webllm/model', 'params_shard_0.bin', 'legacy cleanup fixture'],
            ['webllm/model', 'tokenizer.json', '{}'],
            ['webllm/config', 'mlc-chat-config.json', '{}'],
          ];
          for (const [cacheName, path, content] of entries) {
            const url = base + path;
            await (await caches.open(cacheName)).put(url, new Response(content));
            if (path !== 'tensor-cache.json') keys.push({ cacheName, url });
          }
        }
        return keys;
      });
    }
    const started = Date.now();
    let previousPhase = '';
    let previousBucket = -1;
    await page.exposeFunction('__recordAIProgress', state => {
      const bucket = Math.floor((state.progress || 0) * 10);
      if (state.phase !== previousPhase || state.phase === 'loading' && bucket !== previousBucket) {
        console.log(JSON.stringify({ phase: state.phase, progress: state.progress, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
        previousPhase = state.phase; previousBucket = bucket;
      }
    });
    await page.evaluate(async () => {
      const { spotlightAI } = await import('/apps/web/src/shell/spotlight-ai/service.ts');
      window.__spotlightLiveAI = spotlightAI;
      window.__spotlightLiveUpdates = [];
      window.__spotlightLiveUnsubscribe = spotlightAI.subscribe(() => {
        const state = spotlightAI.getSnapshot();
        window.__spotlightLiveUpdates.push({ phase: state.phase, lastLength: state.messages.at(-1)?.content.length || 0,
          containsThinkingMarkup: /<think>|<\/think>/i.test(state.messages.at(-1)?.content || '') });
        void window.__recordAIProgress({ phase: state.phase, progress: state.progress });
      });
      await spotlightAI.initialize();
    });
    const initialized = await page.evaluate(() => window.__spotlightLiveAI.getSnapshot());
    assert.equal(initialized.phase, 'ready', initialized.error || initialized.status);
    report.initializationMs = Date.now() - started;
    report.modelId = initialized.modelId;
    if (report.legacyFixtureKeys) {
      const remaining = await page.evaluate(async keys => {
        const found = [];
        for (const { cacheName, url } of keys) if (await (await caches.open(cacheName)).match(url)) found.push(url);
        return found;
      }, report.legacyFixtureKeys);
      assert.deepEqual(remaining, [], 'Legacy weight/tokenizer/config cache fixtures should be removed.');
      report.legacyCleanup = true;
    }
    report.system = await page.evaluate(async () => {
      const { buildContext } = await import('/apps/web/src/shell/spotlight-ai/core.ts');
      return buildContext([], 'test')[0].content;
    });
    report.replies = [];
    for (let index = 0; index < prompts.length; index++) {
      if (index === 1) await page.context().setOffline(true);
      if (index >= 2) await page.evaluate(() => window.__spotlightLiveAI.clearChat());
      const before = Date.now();
      await page.evaluate(async prompt => { await window.__spotlightLiveAI.send(prompt); }, prompts[index]);
      const state = await page.evaluate(() => window.__spotlightLiveAI.getSnapshot());
      assert.equal(state.phase, 'ready', state.error || state.status);
      const reply = state.messages.at(-1);
      assert.equal(reply.role, 'assistant');
      assert.ok(reply.content.trim().length > 0, 'The real model should generate a nonempty answer.');
      report.replies.push({ prompt: prompts[index], reply: reply.content, offline: index > 0, durationMs: Date.now() - before });
      console.log(JSON.stringify(report.replies.at(-1)));
      assert.equal(/<think>|<\/think>/i.test(reply.content), false, 'Reasoning markup must not appear in user replies.');
      if (index === 0) assert.match(reply.content, /France/i, 'Paris should be located in France.');
      if (index === 1) assert.match(reply.content, /Seine/i, 'The followup should retain Paris context.');
      if (index === 2) { assert.match(reply.content, /Sam/i); assert.match(reply.content, /ten|10/i); assert.match(reply.content, /late/i); }
      if (index === 3) assert.match(reply.content, /north|Île-de-France|Ile-de-France|Seine/i, 'Paris geography should give useful regional detail.');
    }
    const updates = await page.evaluate(() => window.__spotlightLiveUpdates);
    assert.ok(updates.some(update => update.phase === 'generating' && update.lastLength > 0), 'At least one response must stream before completion.');
    assert.equal(updates.some(update => update.containsThinkingMarkup), false, 'Reasoning markup must not flash while streaming.');
    assert.equal(remoteRequests.some(request => request.leakedPrompt), false, 'Prompts must not appear in outgoing network requests.');
    // Keep Vite's uncached application modules reachable while blocking all model download hosts.
    await page.context().setOffline(false);
    await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort('internetdisconnected'));
    await page.evaluate(() => window.__spotlightLiveAI.unload());
    await page.evaluate(() => window.__spotlightLiveAI.initialize());
    const offlineReloaded = await page.evaluate(() => window.__spotlightLiveAI.getSnapshot());
    assert.equal(offlineReloaded.phase, 'ready', offlineReloaded.error || offlineReloaded.status);
    report.cachedReloadWithRemoteNetworkBlocked = true;
    await page.evaluate(() => { window.__spotlightLiveUnsubscribe(); window.__spotlightLiveAI.unload(); });
    report.network = { requests: remoteRequests.length, origins: [...new Set(remoteRequests.map(request => request.origin))], nonGetRequests: remoteRequests.filter(request => request.method !== 'GET').length, leakedPrompts: 0 };
    report.outcome = 'passed-real-inference-streaming-and-offline-followup';
  }
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL('spotlight-ai-live-verification.json', artifactDirectory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.outcome = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL('spotlight-ai-live-verification.json', artifactDirectory), JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally { await browser.close(); }
