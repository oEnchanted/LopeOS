import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotlightAI, buildContext, MODEL_IDS, MAX_MESSAGE_LENGTH, type AIDependencies, type ChatMessage, type WorkerPort } from '../../apps/web/src/shell/spotlight-ai/core.ts';
import type { AIWorkerReply, AIWorkerRequest } from '../../apps/web/src/shell/spotlight-ai/protocol.ts';
import { deleteCachedModels } from '../../apps/web/src/shell/spotlight-ai/cache.ts';
import { createResponseFilter } from '../../apps/web/src/shell/spotlight-ai/response.ts';

const legacyIds = ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f32_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC'];

class FakeWorker implements WorkerPort {
  requests: AIWorkerRequest[] = [];
  terminated = false;
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  postMessage(message: AIWorkerRequest) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  emit(message: AIWorkerReply) { this.onmessage?.({ data: message } as MessageEvent<AIWorkerReply>); }
  latest() { return this.requests.at(-1)!; }
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function fixture(overrides: Partial<AIDependencies> = {}) {
  const workers: FakeWorker[] = [];
  const ai = new SpotlightAI({ checkSupport: async () => ({ supported: true, shaderF16: true }), createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, ...overrides });
  return { ai, workers, async load() { const task = ai.initialize(); await tick(); const worker = workers.at(-1)!; worker.emit({ type: 'ready', id: worker.latest().id }); await task; return worker; } };
}
async function answer(ai: SpotlightAI, worker: FakeWorker, prompt: string, reply: string) {
  const task = ai.send(prompt), id = worker.latest().id;
  worker.emit({ type: 'delta', id, text: reply }); worker.emit({ type: 'done', id, stopped: false }); await task;
}

test('support probing never downloads or creates a worker; unsupported browsers remain usable', async () => {
  const { ai, workers } = fixture();
  await ai.checkSupport(); assert.equal(workers.length, 0); assert.equal(ai.getSnapshot().phase, 'idle');
  const unavailable = fixture({ checkSupport: async () => ({ supported: false, reason: 'No GPU adapter.' }) });
  await unavailable.ai.initialize(); assert.equal(unavailable.workers.length, 0);
  assert.equal(unavailable.ai.getSnapshot().phase, 'unsupported'); assert.equal(unavailable.ai.getSnapshot().status, 'No GPU adapter.');
});

test('explicit initialization chooses f32 without shader-f16 and reports bounded progress', async () => {
  const { ai, workers } = fixture({ checkSupport: async () => ({ supported: true, shaderF16: false }) });
  const pending = ai.initialize(); await tick();
  const worker = workers[0], request = worker.latest();
  const cleanupModelIds = legacyIds.filter(id => !(MODEL_IDS as readonly string[]).includes(id));
  assert.deepEqual(request, { type: 'load', id: request.id, modelId: MODEL_IDS[1], cleanupModelIds });
  assert.ok(cleanupModelIds.every(id => !(MODEL_IDS as readonly string[]).includes(id)), 'Retain current model chunks for interrupted-download retry');
  worker.emit({ type: 'progress', id: request.id, progress: 1.5, text: 'Almost ready' });
  assert.equal(ai.getSnapshot().progress, 1);
  worker.emit({ type: 'ready', id: request.id }); await pending;
  assert.equal(ai.getSnapshot().modelLoaded, true); assert.equal(ai.getSnapshot().phase, 'ready'); ai.reset();
});

test('cancelling initialization settles callers and rejects stale support/progress/completion', async () => {
  const { ai, workers } = fixture(); const pending = ai.initialize(); await tick();
  const worker = workers[0], oldHandler = worker.onmessage!, id = worker.latest().id;
  ai.stop(); await pending;
  assert.equal(worker.terminated, true);
  oldHandler({ data: { type: 'ready', id } } as MessageEvent<AIWorkerReply>);
  assert.equal(ai.getSnapshot().modelLoaded, false); assert.equal(ai.getSnapshot().phase, 'idle');
  let resolveSupport!: (value: { supported: true; shaderF16: boolean }) => void;
  const checking = fixture({ checkSupport: () => new Promise(resolve => { resolveSupport = resolve; }) });
  const probe = checking.ai.initialize(); checking.ai.stop(); resolveSupport({ supported: true, shaderF16: true }); await probe;
  assert.equal(checking.workers.length, 0);
});

test('streaming stops without losing partial text, and retry does not duplicate the user turn', async () => {
  const { ai, load } = fixture(); const worker = await load();
  const pending = ai.send('Write a short note.'), id = worker.latest().id;
  worker.emit({ type: 'delta', id, text: 'Hello, ' });
  assert.equal(ai.getSnapshot().phase, 'generating');
  ai.stop(); assert.deepEqual(worker.latest(), { type: 'stop', id });
  worker.emit({ type: 'delta', id, text: 'ignored after stop' }); worker.emit({ type: 'done', id, stopped: true }); await pending;
  assert.equal(ai.getSnapshot().messages.at(-1)?.content, 'Hello, '); assert.equal(ai.getSnapshot().messages.at(-1)?.stopped, true);
  assert.equal(ai.getSnapshot().modelLoaded, true);
  const retry = ai.retry(), next = worker.latest();
  assert.equal(next.type, 'generate');
  if (next.type !== 'generate') throw new Error('Expected generation');
  assert.deepEqual(next.messages.filter(message => message.role === 'user').map(message => message.content), ['Write a short note.']);
  worker.emit({ type: 'delta', id: next.id, text: 'Hello, thanks for your help.' }); worker.emit({ type: 'done', id: next.id, stopped: false }); await retry;
  assert.equal(ai.getSnapshot().messages.length, 2); ai.reset();
});

test('chat context is bounded, includes whole recent turns, and rejects oversized Unicode before generation', async () => {
  const history: ChatMessage[] = [];
  for (let index = 0; index < 20; index++) history.push({ id: `u${index}`, role: 'user', content: `question-${index}` }, { id: `a${index}`, role: 'assistant', content: `answer-${index}` });
  const context = buildContext(history, 'next question');
  assert.equal(context[0].role, 'system'); assert.equal(context.length, 10);
  assert.equal(context[1].content, 'question-16'); assert.equal(context.at(-1)?.content, 'next question');
  assert.throws(() => buildContext([], 'a'.repeat(MAX_MESSAGE_LENGTH + 1)), /too long/);
  assert.throws(() => buildContext([], '字'.repeat(1000)), /too long/);
  assert.throws(() => buildContext([], '   '), /Type a message/);
  const { ai, load } = fixture(); const worker = await load(); const count = worker.requests.length;
  await ai.send('字'.repeat(1000)); assert.equal(worker.requests.length, count); assert.equal(ai.getSnapshot().messages.length, 0); assert.match(ai.getSnapshot().error, /too long/); ai.reset();
});

test('new chat resets hidden context and account reset ignores late replies from a previous user', async () => {
  const { ai, load } = fixture(); const worker = await load();
  await answer(ai, worker, 'Private first user text', 'First answer');
  const clear = ai.clearChat(), reset = worker.latest();
  assert.equal(ai.getSnapshot().phase, 'resetting');
  assert.equal(reset.type, 'reset'); worker.emit({ type: 'reset', id: reset.id }); await clear;
  assert.equal(ai.getSnapshot().phase, 'ready');
  assert.equal(ai.getSnapshot().messages.length, 0);
  const pending = ai.send('Another private message'), id = worker.latest().id, oldHandler = worker.onmessage!;
  ai.reset(); await pending;
  oldHandler({ data: { type: 'delta', id, text: 'stale private reply' } } as MessageEvent<AIWorkerReply>);
  assert.equal(ai.getSnapshot().messages.length, 0); assert.equal(worker.terminated, true);
  const nextWorker = await load();
  const nextReply = ai.send('New account question'), next = nextWorker.latest();
  assert.equal(next.type, 'generate');
  if (next.type !== 'generate') throw new Error('Expected generation');
  assert.equal(JSON.stringify(next.messages).includes('private'), false);
  nextWorker.emit({ type: 'done', id: next.id, stopped: true }); await nextReply; ai.reset();
});

test('load and stop deadlines terminate unresponsive workers and settle outstanding requests', async () => {
  const unsupported = fixture({ checkSupport: () => new Promise(() => {}), timeouts: { support: 5 } });
  await unsupported.ai.initialize(); assert.equal(unsupported.ai.getSnapshot().phase, 'unsupported'); assert.equal(unsupported.workers.length, 0);
  const timed = fixture({ timeouts: { load: 5 } }); await timed.ai.initialize();
  assert.equal(timed.ai.getSnapshot().phase, 'error'); assert.equal(timed.workers[0].terminated, true); assert.match(timed.ai.getSnapshot().error, /too long/);
  const { ai, load } = fixture({ timeouts: { stop: 5 } }); const worker = await load();
  const reply = ai.send('A slow reply'); ai.stop(); await reply;
  assert.equal(ai.getSnapshot().modelLoaded, false); assert.equal(worker.terminated, true); assert.equal(ai.getSnapshot().phase, 'idle');
});

test('model removal frees the active worker and removes current and legacy downloads without prompts', async () => {
  const { ai, workers, load } = fixture(); const worker = await load();
  await answer(ai, worker, 'A private prompt', 'A private answer');
  const removal = ai.removeModel(); const cleaner = workers.at(-1)!, request = cleaner.latest();
  const expectedIds = [...new Set([...MODEL_IDS, ...legacyIds])];
  assert.equal(worker.terminated, true); assert.deepEqual(request, { type: 'remove', id: request.id, modelIds: expectedIds });
  assert.equal(JSON.stringify(request).includes('private'), false);
  cleaner.emit({ type: 'removed', id: request.id }); await removal;
  assert.equal(cleaner.terminated, true); assert.equal(ai.getSnapshot().modelLoaded, false); assert.equal(ai.getSnapshot().modelId, null); ai.reset();
});

test('offline cache cleanup removes partial legacy artifacts without touching current models or other app caches', async () => {
  const old = 'https://huggingface.co/mlc-ai/old-model', current = 'https://huggingface.co/mlc-ai/current-model';
  const oldShard = `${old}/resolve/main/params_shard_0.bin`, currentShard = `${current}/resolve/main/params_shard_0.bin`;
  const oldLibrary = 'https://example.com/old.wasm', currentLibrary = 'https://example.com/current.wasm';
  const entries = new Map<string, string[]>([
    ['webllm/model', [oldShard, currentShard, `${old}-other/resolve/main/params_shard_0.bin`]],
    ['webllm/config', [`${old}/resolve/main/mlc-chat-config.json`, `${current}/resolve/main/mlc-chat-config.json`]],
    ['webllm/wasm', [oldLibrary, currentLibrary]],
    ['other-app-cache', [oldShard]],
  ]);
  const opened: string[] = [];
  const storage = {
    keys: async () => [...entries.keys()],
    async open(name: string) {
      opened.push(name);
      return {
        keys: async () => entries.get(name)!.map(url => new Request(url)),
        async delete(request: Request) { entries.set(name, entries.get(name)!.filter(url => url !== request.url)); return true; },
      };
    },
  };
  await deleteCachedModels([{ model: old, model_lib: oldLibrary }, { model: 'https://huggingface.co/mlc-ai/never-downloaded', model_lib: 'https://example.com/absent.wasm' }], storage);
  assert.deepEqual(entries.get('webllm/model'), [currentShard, `${old}-other/resolve/main/params_shard_0.bin`]);
  assert.deepEqual(entries.get('webllm/config'), [`${current}/resolve/main/mlc-chat-config.json`]);
  assert.deepEqual(entries.get('webllm/wasm'), [currentLibrary]);
  assert.deepEqual(entries.get('other-app-cache'), [oldShard]);
  assert.equal(opened.includes('other-app-cache'), false);
});

test('streamed responses strip only a leading empty thinking wrapper across arbitrary chunk boundaries', () => {
  const source = '<think>\n\n</think>\n\nParis is in France.';
  for (let split = 0; split <= source.length; split++) {
    const filter = createResponseFilter();
    assert.equal(filter.push(source.slice(0, split)) + filter.push(source.slice(split)) + filter.finish(), 'Paris is in France.');
  }
  const characterChunks = createResponseFilter();
  assert.equal([...source].map(character => characterChunks.push(character)).join('') + characterChunks.finish(), 'Paris is in France.');
  for (const text of ['  A normal reply.', '<think>nonempty</think>Actual text.', 'Literal <think></think> in an explanation.', '<thi']) {
    const filter = createResponseFilter();
    assert.equal([...text].map(character => filter.push(character)).join('') + filter.finish(), text);
  }
});
