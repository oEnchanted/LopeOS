import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { authenticate, sha256, normalizePath, dimensions } from './config.js';
import { ReplayBuffer } from './replay.js';
import { Sessions } from './sessions.js';
import { createRuntime } from './server.js';

const alice = { userId: 'alice', workspaceId: 'alice-home', container: 'alice', tokenHash: sha256('test-alice') };
const bob = { userId: 'bob', workspaceId: 'bob-home', container: 'bob', tokenHash: sha256('test-bob') };
const config = { principals: [alice, bob], origins: ['http://127.0.0.1:5173'], maxSessions: 8, detachedMs: 1000, shell: 'bash', authSecret: 'secret'.repeat(8), authIssuer: 'lope-gateway' };
const jwt = payload => { const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${h}.${p}.${createHmac('sha256', config.authSecret).update(`${h}.${p}`).digest('base64url')}`; };
test('credentials resolve server-side ownership and enforce issuer, audience and expiry', () => {
  assert.equal(authenticate('test-alice', config).workspaceId, 'alice-home');
  for (const token of ['', 'test-bob-no', jwt({ sub: 'alice', aud: 'lope-browser', iss: config.authIssuer, exp: 1500 }), jwt({ sub: 'alice', aud: 'lope-runtime', iss: 'other', exp: 1500 }), jwt({ sub: 'alice', aud: 'lope-runtime', iss: config.authIssuer, exp: 900 })]) assert.throws(() => authenticate(token, config, 1000), { code: 'UNAUTHENTICATED' });
  assert.equal(authenticate(jwt({ sub: 'alice', aud: 'lope-runtime', iss: config.authIssuer, exp: 1500, workspaceId: 'bob-home' }), config, 1000).workspaceId, 'alice-home');
  assert.throws(() => normalizePath('/a/../b'), { code: 'FORBIDDEN' }); assert.equal(normalizePath('/home/lope/Documents'), '/Documents');
  assert.throws(() => dimensions(100000, 24), { code: 'INVALID' });
});
test('high-volume replay stays bounded and preserves cursor/Unicode boundaries', () => {
  const replay = new ReplayBuffer(65536);
  for (let i = 0; i < 10000; i++) replay.append(`${i}:你好🌙\r\n`.repeat(100));
  assert.ok(replay.bytes <= 65536); assert.ok(replay.start > 0);
  let cursor = replay.start, text = '';
  while (cursor < replay.end) { const r = replay.read(cursor, 31); assert.ok(r.end > cursor); text += r.data; cursor = r.end; }
  assert.ok(!/\uFFFD/.test(text)); assert.equal(cursor, replay.end);
});
class FakePty extends EventEmitter {
  paused = false; writes = []; killed = false;
  onData(fn) { this.on('data', fn); } onExit(fn) { this.on('exit', fn); }
  pause() { this.paused = true; } resume() { this.paused = false; }
  write(data) { this.writes.push(data); } writeBinary(data) { this.writes.push(data); } resize(cols, rows) { this.size = [cols, rows]; } kill() { this.killed = true; }
}
class Workspace {
  processes = []; files = new Map();
  async ready() {}
  async file(p, q) {
    if (q.op === 'stat') return { type: 'directory' };
    if (q.op === 'snapshot') return 'snapshot';
    if (q.op === 'list') return [{ name: p.userId, path: '/' + p.userId, type: 'file', size: 1, modifiedAt: Date.now() }];
    return {};
  }
  async terminal() { const p = new FakePty(); this.processes.push(p); return p; }
  async closeTerminal() {}
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames = [];
  send(data) { this.frames.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
}
test('PTY output ACKs pause producers; detached output is bounded; sessions are owner checked', async t => {
  const workspace = new Workspace(), manager = new Sessions(workspace, config);
  t.after(() => manager.shutdown());
  const a = await manager.create(alice, { cwd: '/Projects', cols: 90, rows: 30 }), b = await manager.create(alice, { cwd: '/' });
  assert.notEqual(a.id, b.id); assert.equal(manager.list(bob).length, 0);
  assert.throws(() => manager.get(bob, a.id), { code: 'NOT_FOUND' });
  const ws = new Socket(), s = manager.attach(alice, a.id, ws, 0), pty = workspace.processes[0];
  pty.emit('data', 'x'.repeat(65536)); assert.equal(pty.paused, true);
  assert.throws(() => manager.message(s, ws, { type: 'ack', cursor: 999999 }), { code: 'INVALID' });
  manager.message(s, ws, { type: 'input', data: '\x03' }); assert.deepEqual(pty.writes, ['\x03']);
  manager.message(s, ws, { type: 'input-binary', data: Buffer.from([16, 17]).toString('base64') }); assert.deepEqual(pty.writes[1], Buffer.from([16, 17]));
  assert.throws(() => manager.message(s, ws, { type: 'input-binary', data: '???' }), { code: 'INVALID' });
  manager.message(s, ws, { type: 'ack', cursor: 65536 }); assert.equal(pty.paused, false);
  manager.message(s, ws, { type: 'resize', cols: 100, rows: 40 }); assert.deepEqual(pty.size, [100, 40]);
  ws.close(); for (let i = 0; i < 1000; i++) pty.emit('data', 'y'.repeat(8192));
  assert.ok(s.replay.bytes <= 512 * 1024); assert.equal(pty.paused, false);
  const reattached = new Socket(); manager.attach(alice, a.id, reattached, 0); assert.equal(reattached.frames[0].truncated, true);
  await manager.close(alice, a.id); assert.equal(pty.killed, true); assert.throws(() => manager.get(alice, a.id), { code: 'NOT_FOUND' });
});
const wsMessage = ws => new Promise((resolve, reject) => { ws.once('message', data => resolve(JSON.parse(data))); ws.once('error', reject); });
async function openSocket(url, headers = {}) {
  const ws = new WebSocket(url, { origin: config.origins[0], headers });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return ws;
}
test('HTTP and WebSocket require auth; wrong-owner sessions are hidden; origins are exact', async t => {
  const workspace = new Workspace(), runtime = createRuntime(config, workspace);
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve)); t.after(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.server.address().port}`, url = base.replace('http:', 'ws:') + '/api/ws';
  const call = (path, token = 'test-alice', init = {}) => fetch(base + '/api' + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  assert.equal((await fetch(base + '/api/identity')).status, 401);
  assert.equal((await call('/identity', 'test-alice', { headers: { Origin: 'http://127.0.0.1:evil' } })).status, 403);
  const identity = await (await call('/identity')).json(); assert.equal(identity.userId, 'alice');
  const entries = await (await call('/fs/list?path=/&workspaceId=bob-home')).json(); assert.equal(entries.entries[0].name, 'alice');
  const session = await (await call('/terminal/sessions', 'test-alice', { method: 'POST', body: '{}' })).json();
  assert.equal((await call(`/terminal/${session.id}`, 'test-bob', { method: 'DELETE' })).status, 404);
  const ws = await openSocket(url); t.after(() => ws.terminate());
  let response = wsMessage(ws); ws.send(JSON.stringify({ type: 'auth', token: 'test-bob', channel: 'terminal', sessionId: session.id }));
  assert.equal((await response).error.code, 'NOT_FOUND');
  const direct = await openSocket(url); t.after(() => direct.terminate());
  response = wsMessage(direct); direct.send(JSON.stringify({ type: 'input', data: 'id\r' })); assert.equal((await response).error.code, 'UNAUTHENTICATED');
  // Same-origin dev proxy authenticates its handshake; bearer never goes in a URL.
  const proxied = await openSocket(url, { Authorization: 'Bearer test-alice' }); t.after(() => proxied.terminate());
  response = wsMessage(proxied); proxied.send(JSON.stringify({ type: 'auth', channel: 'terminal', sessionId: session.id })); assert.equal((await response).type, 'ready');
  const invalidOrigin = new WebSocket(url, { origin: 'https://evil.example' }); invalidOrigin.on('error', () => {});
  await new Promise(resolve => invalidOrigin.once('unexpected-response', (_, res) => { assert.equal(res.statusCode, 403); res.resume(); invalidOrigin.terminate(); resolve(); }));
});
test('real filesystem workers: binary transfers, shell/editor conflicts, atomic creates, traversal guards', async () => {
  const result = await promisify(execFile)('python3', ['-B', fileURLToPath(new URL('./fs_test.py', import.meta.url))], { timeout: 15000 });
  assert.match(result.stderr, /OK/);
});

test('storage and copy routes use the authenticated workspace and validated methods and paths', async t => {
  const workspace = new Workspace(), calls = [];
  const capacity = { totalBytes: 10000, usedBytes: 4000, availableBytes: 5000, scope: 'runtime-volume' };
  workspace.file = async (owner, request) => { calls.push({ owner, request }); return request.op === 'storage' ? capacity : {}; };
  const runtime = createRuntime(config, workspace);
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve)); t.after(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.server.address().port}/api/fs`;
  const call = (path, options = {}) => fetch(base + path, { ...options, headers: { Authorization: 'Bearer test-alice', 'Content-Type': 'application/json' } });
  assert.deepEqual(await (await call('/storage?workspaceId=bob-home')).json(), capacity);
  assert.equal(calls[0].owner.workspaceId, 'alice-home');
  assert.equal(calls[0].request.op, 'storage');
  assert.equal((await call('/copy', { method: 'POST', body: JSON.stringify({ path: '/home/lope/one', destination: '/two' }) })).status, 200);
  assert.deepEqual(calls.at(-1).request, { op: 'copy', path: '/one', destination: '/two' });
  assert.equal((await call('/copy')).status, 405);
  assert.equal((await call('/storage', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await call('/copy', { method: 'POST', body: JSON.stringify({ path: '/one', destination: '/../escape' }) })).status, 403);
});
