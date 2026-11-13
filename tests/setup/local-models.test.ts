import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadRate, LocalModelService, type LocalModelDependencies } from '../../apps/web/src/setup/local-models.ts';
import { cachedSpotlightModel, downloadSpotlightModel, spotlightModelBase, spotlightShards, type SpotlightModelRecord } from '../../apps/web/src/setup/local-model-download.ts';

const record: SpotlightModelRecord = { model_id: 'test-model', model: 'https://example.test/model', model_lib: 'https://example.test/engine.wasm' };
const base = spotlightModelBase(record);
const json = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
const fixtures = new Map([
  [base + 'mlc-chat-config.json', json({ tokenizer_files: ['tokenizer.json'] })],
  [base + 'tensor-cache.json', json({ records: [{ dataPath: 'params_shard_0.bin', nbytes: 4 }, { dataPath: 'params_shard_1.bin', nbytes: 3 }] })],
  [base + 'tokenizer.json', json({ version: '1.0' })],
  [record.model_lib, new Uint8Array([0, 97, 115, 109])],
  [base + 'params_shard_0.bin', new Uint8Array([1, 2, 3, 4])],
  [base + 'params_shard_1.bin', new Uint8Array([5, 6, 7])],
]);
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    async open(name: string): Promise<Cache> {
      const entries = stores.get(name) ?? new Map<string, Response>(); stores.set(name, entries);
      return {
        match: async (url: RequestInfo | URL) => entries.get(String(url))?.clone(),
        put: async (url: RequestInfo | URL, response: Response) => { entries.set(String(url), new Response(await response.arrayBuffer(), { headers: response.headers })); },
        delete: async (url: RequestInfo | URL) => entries.delete(String(url)),
      } as Cache;
    },
  };
}
function dependencies(overrides: Partial<LocalModelDependencies> = {}): LocalModelDependencies {
  return {
    support: async () => ({ supported: true, shaderF16: true }), spotlightRecord: async () => record,
    inspectSpotlight: async () => ({ installed: false, sizeBytes: null }), downloadSpotlight: async () => 7,
    inspectDenoise: async () => false, downloadDenoise: async () => {},
    inspectPortrait: async () => false, downloadPortrait: async () => {}, now: () => performance.now(), ...overrides,
  };
}

test('WebLLM prefetch writes every asset to the same scopes and keys consumed by chat', async () => {
  const caches = memoryCaches(), requests: string[] = [], events: { received: number; transferred: number; total: number | null }[] = [];
  const fetcher = (async (input: RequestInfo | URL) => { const url = String(input); requests.push(url); const bytes = fixtures.get(url); assert.ok(bytes, url); return new Response(bytes, { headers: { 'content-length': String(bytes.length) } }); }) as typeof fetch;
  const inspectBefore = await cachedSpotlightModel(record, caches); assert.equal(inspectBefore.installed, false); assert.equal(requests.length, 0);
  const total = await downloadSpotlightModel(record, new AbortController().signal, value => events.push(value), { fetch: fetcher, caches });
  assert.equal(total, [...fixtures.values()].reduce((sum, bytes) => sum + bytes.length, 0));
  assert.equal(events.at(-1)!.received, total); assert.equal(events.at(-1)!.transferred, total);
  assert.equal(await caches.stores.get('webllm/config')!.get(base + 'mlc-chat-config.json')!.clone().text(), new TextDecoder().decode(fixtures.get(base + 'mlc-chat-config.json')));
  assert.ok(caches.stores.get('webllm/wasm')!.has(record.model_lib));
  assert.equal(caches.stores.get('webllm/model')!.size, 4);
  assert.deepEqual(await cachedSpotlightModel(record, caches), { installed: true, sizeBytes: total });
  requests.length = 0; events.length = 0;
  await downloadSpotlightModel(record, new AbortController().signal, value => events.push(value), { fetch: fetcher, caches });
  assert.deepEqual(requests, []); assert.equal(events.at(-1)!.transferred, 0); assert.equal(events.at(-1)!.received, total);
});

test('a cancelled transfer retains complete files but never installs a partial shard', async () => {
  const caches = memoryCaches(), controller = new AbortController();
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input), data = fixtures.get(url)!;
    if (!url.endsWith('params_shard_0.bin')) return new Response(data);
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(data.slice(0, 2)); }, cancel() {} }));
  }) as typeof fetch;
  await assert.rejects(downloadSpotlightModel(record, controller.signal, progress => { if (progress.file === 'Model weights 1 of 2' && progress.received > progress.total! - 7) controller.abort(); }, { fetch: fetcher, caches }), { name: 'AbortError' });
  assert.ok(caches.stores.get('webllm/config')!.has(base + 'mlc-chat-config.json'));
  assert.equal(caches.stores.get('webllm/model')!.has(base + 'params_shard_0.bin'), false);
  assert.equal((await cachedSpotlightModel(record, caches)).installed, false);
});

test('truncated weights are rejected instead of appearing installed', async () => {
  const caches = memoryCaches();
  const fetcher = (async (input: RequestInfo | URL) => new Response(String(input).endsWith('params_shard_1.bin') ? new Uint8Array([5]) : fixtures.get(String(input))!)) as typeof fetch;
  await assert.rejects(downloadSpotlightModel(record, new AbortController().signal, () => {}, { fetch: fetcher, caches }), /incomplete/);
  assert.equal((await cachedSpotlightModel(record, caches)).installed, false);
});

test('manifest validation rejects ambiguous or unsafe shard metadata', () => {
  assert.throws(() => spotlightShards({ records: [{ dataPath: 'a', nbytes: -1 }] }), /invalid/);
  assert.throws(() => spotlightShards({ records: [{ dataPath: 'a', nbytes: 1 }, { dataPath: 'a', nbytes: 1 }] }), /duplicate/);
  assert.equal(spotlightModelBase({ ...record, model: 'https://example.test/model/resolve/revision/' }), 'https://example.test/model/resolve/revision/');
});

test('recent network byte rate decays to zero during a stalled download', () => {
  let time = 0; const rate = new DownloadRate(() => time);
  assert.equal(rate.update(0), 0); time = 1000; assert.equal(rate.update(1_000_000), 1_000_000);
  time = 2000; rate.update(1_000_000); time = 3500; assert.equal(rate.update(1_000_000), 0);
});

test('inspection is network-free and download-all skips unsupported chat while saving other models', async () => {
  const started: string[] = [];
  const service = new LocalModelService(dependencies({ support: async () => ({ supported: false, reason: 'WebGPU unavailable' }), downloadSpotlight: async () => { started.push('chat'); return 7; }, downloadDenoise: async () => { started.push('denoise'); }, downloadPortrait: async () => { started.push('portrait'); } }));
  await service.inspect(); assert.deepEqual(started, []);
  await service.installAll(); assert.deepEqual(started, ['denoise', 'portrait']);
  assert.equal(service.getSnapshot().models[0].status, 'unsupported');
  assert.equal(service.getSnapshot().models[1].status, 'installed'); assert.equal(service.getSnapshot().models[2].status, 'installed');
  assert.equal(service.getSnapshot().busy, false);
});

test('one model failing does not discard successful models and retry is independent', async () => {
  let fail = true; const counts = { chat: 0, denoise: 0, portrait: 0 };
  const service = new LocalModelService(dependencies({ downloadSpotlight: async () => { counts.chat++; if (fail) throw new Error('Network lost'); return 7; }, downloadDenoise: async () => { counts.denoise++; }, downloadPortrait: async () => { counts.portrait++; } }));
  await service.installAll(); assert.equal(service.getSnapshot().models[0].status, 'error'); assert.equal(service.getSnapshot().models[1].status, 'installed');
  fail = false; await service.installAll(); assert.deepEqual(counts, { chat: 2, denoise: 1, portrait: 1 }); assert.equal(service.getSnapshot().models[0].status, 'installed');
});

test('cancel stops the active download and clears the rest of the queue', async () => {
  let started!: () => void; const active = new Promise<void>(resolve => { started = resolve; }); const downloads: string[] = [];
  const service = new LocalModelService(dependencies({ downloadSpotlight: async (_record, signal) => { downloads.push('chat'); started(); return await new Promise<number>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }, downloadDenoise: async () => { downloads.push('denoise'); }, downloadPortrait: async () => { downloads.push('portrait'); } }));
  const job = service.installAll(); await active; service.cancel(); await job;
  assert.deepEqual(downloads, ['chat']); assert.equal(service.getSnapshot().busy, false); assert.ok(service.getSnapshot().models.every(model => model.status === 'cancelled'));
});

test('inspection rejects an incomplete older cache response without a size header', async () => {
  const caches = memoryCaches();
  const fetcher = (async (input: RequestInfo | URL) => new Response(fixtures.get(String(input))!)) as typeof fetch;
  await downloadSpotlightModel(record, new AbortController().signal, () => {}, { fetch: fetcher, caches });
  caches.stores.get('webllm/model')!.set(base + 'params_shard_0.bin', new Response(new Uint8Array([1, 2])));
  assert.equal((await cachedSpotlightModel(record, caches)).installed, false);
  await downloadSpotlightModel(record, new AbortController().signal, () => {}, { fetch: fetcher, caches });
  assert.equal((await cachedSpotlightModel(record, caches)).installed, true);
});

test('repeated inspect and install requests share checks and never duplicate active jobs', async () => {
  let checks = 0, downloads = 0, finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const service = new LocalModelService(dependencies({ support: async () => { checks++; return { supported: true, shaderF16: true }; }, downloadDenoise: async () => { downloads++; await pending; } }));
  await Promise.all([service.inspect(), service.inspect()]); assert.equal(checks, 1);
  const first = service.install('denoise'), second = service.install('denoise');
  await service.inspect(); assert.equal(checks, 1); assert.equal(downloads, 1);
  finish(); await Promise.all([first, second]); assert.equal(downloads, 1);
});

test('retry replaces empty cached tokenizer and engine assets without refetching complete weights', async () => {
  const caches = memoryCaches(), requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => { requests.push(String(input)); return new Response(fixtures.get(String(input))!); }) as typeof fetch;
  const total = await downloadSpotlightModel(record, new AbortController().signal, () => {}, { fetch: fetcher, caches });
  caches.stores.get('webllm/model')!.set(base + 'tokenizer.json', new Response(null));
  caches.stores.get('webllm/wasm')!.set(record.model_lib, new Response(null, { headers: { 'content-length': '0' } }));
  assert.equal((await cachedSpotlightModel(record, caches)).installed, false);
  requests.length = 0;
  assert.equal(await downloadSpotlightModel(record, new AbortController().signal, () => {}, { fetch: fetcher, caches }), total);
  assert.deepEqual(requests, [base + 'tokenizer.json', record.model_lib]);
  assert.deepEqual(await cachedSpotlightModel(record, caches), { installed: true, sizeBytes: total });
});

test('a hung graphics adapter check times out and leaves photo downloads usable', async () => {
  let finishProbe!: (value: { supported: true; shaderF16: boolean }) => void;
  const pending = new Promise<{ supported: true; shaderF16: boolean }>(resolve => { finishProbe = resolve; });
  const started: string[] = [];
  const service = new LocalModelService(dependencies({
    support: () => pending, supportTimeoutMs: 10,
    downloadSpotlight: async () => { started.push('chat'); return 7; },
    downloadDenoise: async () => { started.push('denoise'); },
    downloadPortrait: async () => { started.push('portrait'); },
  }));
  const inspection = service.inspect();
  assert.equal(service.getSnapshot().checking, true);
  await inspection;
  assert.equal(service.getSnapshot().checking, false);
  assert.equal(service.getSnapshot().models[0].status, 'unsupported');
  assert.match(service.getSnapshot().models[0].message, /took too long/);
  await service.installAll();
  assert.deepEqual(started, ['denoise', 'portrait']);
  assert.equal(service.getSnapshot().models[1].status, 'installed');
  assert.equal(service.getSnapshot().models[2].status, 'installed');
  finishProbe({ supported: true, shaderF16: true }); await Promise.resolve();
  assert.equal(service.getSnapshot().models[0].status, 'unsupported');
});
