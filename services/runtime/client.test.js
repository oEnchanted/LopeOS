import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeClient, RuntimeError, createFileService } from '../../packages/runtime-client/src/index.ts';

class Socket {
  static OPEN = 1; static instances = [];
  readyState = 0; bufferedAmount = 0; sent = [];
  constructor(url) { this.url = url; Socket.instances.push(this); queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } }); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('client ACK waits for parsing, reconnect keeps cursor, input limits and binary bytes are preserved', async t => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket; t.after(() => { globalThis.WebSocket = original; }); Socket.instances = [];
  const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:4174', getToken: () => 'in-memory-token' });
  let consumed, output;
  const connection = client.connectSession('opaque', { output(data, ack) { output = data; consumed = ack; } }); t.after(() => connection.disconnect());
  await tick(); const first = Socket.instances[0];
  assert.equal(new URL(first.url).search, ''); assert.equal(first.sent[0].token, 'in-memory-token');
  first.receive({ type: 'ready', cursor: 0, session: {} }); first.receive({ type: 'output', data: '你好🌙', start: 0, end: 4 });
  assert.equal(output, '你好🌙'); assert.equal(first.sent.filter(m => m.type === 'ack').length, 0);
  consumed(); assert.equal(first.sent.at(-1).cursor, 4);
  connection.inputBinary(String.fromCharCode(16, 17)); assert.equal(first.sent.at(-1).data, Buffer.from([16, 17]).toString('base64'));
  assert.throws(() => connection.input('x'.repeat(32769)), { code: 'LIMIT' });
  connection.reconnect(); await tick(); const second = Socket.instances[1]; assert.equal(second.sent[0].cursor, 4);
  second.receive({ type: 'ready', cursor: 4, session: {} }); second.receive({ type: 'output', data: 'next', start: 4, end: 8 }); consumed(); assert.equal(connection.getCursor(), 8);
});
test('file client preserves binary bytes, rejects binary text opens, and sends atomic create/version preconditions', async () => {
  const calls = [], client = new RuntimeClient();
  client.request = async (route, options) => {
    calls.push({ route, options });
    if (route.startsWith('/fs/read')) return { data: Buffer.from([0, 255, 17]).toString('base64'), version: 'old' };
    if (route === '/fs/write') { const b = JSON.parse(options.body); return { path: b.path, name: 'file', type: 'file', modifiedAt: 0, size: 3, version: 'new' }; }
  };
  const fs = createFileService(client);
  assert.deepEqual([...(await fs.readBinary('/file')).data], [0, 255, 17]);
  await assert.rejects(fs.read('/file'), { code: 'BINARY' });
  await fs.create('/file', 'new'); assert.equal(JSON.parse(calls.at(-1).options.body).createOnly, true);
  await fs.write('/file', 'changed', 'expected'); assert.equal(JSON.parse(calls.at(-1).options.body).version, 'expected');
  client.request = async () => { throw new RuntimeError('NOT_FOUND', 'Gone', 404); }; await client.closeSession('expired');
});

test('first API use automatically creates one visitor workspace and waits for readiness across concurrent apps', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const calls = []; let prepared = false, polls = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(options.credentials, 'same-origin');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    if (String(url).endsWith('/visitor')) {
      if (options.method === 'POST') return Response.json({ state: 'starting', retryAfterMs: 1 });
      polls++; prepared = true; return Response.json({ state: 'ready' });
    }
    return prepared ? Response.json({ ok: true }) : Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  };
  const client = new RuntimeClient({ baseUrl: 'https://lope.example' });
  await Promise.all([client.request('/identity'), client.request('/fs/list')]);
  assert.equal(calls.filter(c => c.url.endsWith('/visitor') && c.options.method === 'POST').length, 1);
  assert.equal(polls, 1);
});

test('file client exposes runtime volume capacity and server-side copy', async () => {
  const calls = [], client = new RuntimeClient();
  const capacity = { totalBytes: 10000, usedBytes: 4000, availableBytes: 5500, scope: 'runtime-volume' };
  client.request = async (route, options) => { calls.push({ route, options }); return route === '/fs/storage' ? capacity : {}; };
  const fs = createFileService(client);
  assert.deepEqual(await fs.storage(), capacity);
  assert.equal(calls[0].route, '/fs/storage');
  await fs.copy('/Documents/folder', '/Documents/folder copy');
  assert.equal(calls[1].route, '/fs/copy');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { path: '/Documents/folder', destination: '/Documents/folder copy' });
});
