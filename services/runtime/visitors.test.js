import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { Visitors } from './visitors.js';
import { createRuntime } from './server.js';
import { ManagedWorkspaces } from './managed.js';
import { RuntimeError } from './config.js';

async function registry(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lope-visitors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return Visitors.open({ directory, secure: false, ...options });
}
const cookie = (v, record) => v.cookie(record).split(';')[0];
test('visitor identity is private, persistent, signed, rate limited and capacity bounded', async t => {
  const v = await registry(t, { maxVisitors: 8 });
  const first = await v.obtain('', '203.0.113.10'), other = await v.obtain('', '203.0.113.11');
  assert.notEqual(first.record.principal.workspaceId, other.record.principal.workspaceId);
  assert.equal((await v.obtain(cookie(v, first.record), '203.0.113.10')).created, false);
  assert.match(v.cookie(first.record), /HttpOnly; SameSite=Lax/);
  const secure = await registry(t, { secure: true }); const s = await secure.obtain('', '203.0.113.30'); assert.match(secure.cookie(s.record), /^__Host-lope-visitor=.*; Secure$/);
  assert.throws(() => v.authenticate(cookie(v, first.record).slice(0, -1) + '!'), { code: 'UNAUTHENTICATED' });
  const reopened = await Visitors.open({ directory: v.directory, secure: false });
  assert.equal(reopened.authenticate(cookie(v, first.record)).principal.workspaceId, first.record.principal.workspaceId);
  await reopened.queue; // Finish the restart fixture's last-seen save before resuming the original instance.
  assert.equal((await stat(path.join(v.directory, 'visitor-key'))).mode & 0o777, 0o600);
  for (let i = 0; i < 4; i++) await v.obtain('', '203.0.113.10');
  await assert.rejects(v.obtain('', '203.0.113.10'), { code: 'RATE_LIMIT' });
  await v.obtain('', '203.0.113.12'); await v.obtain('', '203.0.113.13');
  await assert.rejects(v.obtain('', '203.0.113.14'), { code: 'CAPACITY' });
});
test('retention revokes an identity before deleting its workspace, and recovers an interrupted deletion', async t => {
  let time = 1000; const v = await registry(t, { now: () => time, retentionMs: 1000 });
  const { record } = await v.obtain('', '203.0.113.1'); const old = cookie(v, record); time = 2001;
  let attempts = 0;
  await assert.rejects(v.expire(async () => { attempts++; assert.throws(() => v.authenticate(old), { code: 'UNAUTHENTICATED' }); throw new Error('unmount busy'); }));
  assert.equal(v.records.size, 1); assert.equal(record.deleting, true);
  await v.expire(async owner => { attempts++; assert.equal(owner.workspaceId, record.principal.workspaceId); });
  assert.equal(attempts, 2); assert.equal(v.records.size, 0);
  assert.throws(() => v.authenticate(old), { code: 'UNAUTHENTICATED' });
});
class GuestWorkspace {
  files = new Map();
  begin() { return { state: 'ready' }; } async ready() {}
  async file(owner, q) {
    const key = `${owner.workspaceId}:${q.path}`;
    if (q.op === 'snapshot') return 'snapshot';
    if (q.op === 'stat') return { type: 'directory' };
    if (q.op === 'write') { this.files.set(key, q.data); return { version: 'test-version' }; }
    if (q.op === 'read') { if (!this.files.has(key)) throw new RuntimeError('NOT_FOUND', 'Missing file', 404); return { data: this.files.get(key), version: 'test-version' }; }
  }
  async terminal() { return { onData() {}, onExit() {}, kill() {} }; }
  async closeTerminal() {}
}
test('visitors bootstrap without tokens; cookie-authenticated HTTP/WS are isolated and reject cross-site creation and writes', async t => {
  const visitors = await registry(t), workspace = new GuestWorkspace();
  const config = { principals: [], origins: ['https://lope.example'], maxSessions: 8, detachedMs: 1000, shell: 'bash' };
  const runtime = createRuntime(config, workspace, visitors);
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(0, '127.0.0.1', resolve); });
  t.after(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const call = (route, c = '', init = {}) => fetch(base + '/api' + route, { ...init, headers: { Cookie: c, Origin: config.origins[0], 'Content-Type': 'application/json', ...init.headers } });
  assert.equal((await call('/identity')).status, 401);
  assert.equal((await call('/visitor', '', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(visitors.records.size, 0);
  const a = await call('/visitor', '', { method: 'POST', body: '{}' }), b = await call('/visitor', '', { method: 'POST', body: '{}' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const aCookie = a.headers.get('set-cookie').split(';')[0], bCookie = b.headers.get('set-cookie').split(';')[0];
  const aId = await (await call('/identity', aCookie)).json(), bId = await (await call('/identity', bCookie)).json(); assert.notEqual(aId.workspaceId, bId.workspaceId);
  assert.equal((await call('/fs/write', aCookie, { method: 'PUT', body: JSON.stringify({ path: '/private.txt', content: 'A private file' }) })).status, 200);
  assert.equal((await call('/fs/read?path=/private.txt', bCookie)).status, 404);
  assert.equal((await (await call('/fs/read?path=/private.txt', aCookie)).json()).content, 'A private file');
  assert.equal((await call('/fs/write', aCookie, { method: 'PUT', body: '{}', headers: { Origin: '' } })).status, 403);
  const session = await (await call('/terminal/sessions', aCookie, { method: 'POST', body: '{}' })).json();
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { origin: config.origins[0], headers: { Cookie: aCookie } }); t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const ready = new Promise(resolve => ws.once('message', raw => resolve(JSON.parse(raw))));
  ws.send(JSON.stringify({ type: 'auth', channel: 'terminal', sessionId: session.id })); assert.equal((await ready).type, 'ready');
  const foreign = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { origin: config.origins[0], headers: { Cookie: bCookie } }); t.after(() => foreign.terminate());
  await new Promise((resolve, reject) => { foreign.once('open', resolve); foreign.once('error', reject); });
  const denied = new Promise(resolve => foreign.once('message', raw => resolve(JSON.parse(raw))));
  foreign.send(JSON.stringify({ type: 'auth', channel: 'terminal', sessionId: session.id })); assert.equal((await denied).error.code, 'NOT_FOUND');
});
test('managed allocation deduplicates first visits, enforces active capacity and never provisions a client-selected path', async () => {
  const calls = []; let started = false;
  const owner = { userId: 'guest-' + 'a'.repeat(32), workspaceId: 'guest-' + 'a'.repeat(32), container: 'lope-guest-' + 'a'.repeat(32) };
  class Managed extends ManagedWorkspaces { async verify() { return 'b'.repeat(64); } }
  const workspace = new Managed({ image: 'lope-workspace:local', maxActive: 2 }, {
    async docker(args) { calls.push(args); if (args[0] === 'inspect') { if (!started) throw new Error('No container'); return JSON.stringify([{ State: { Running: true }, Config: { Labels: { 'lope.user': owner.userId, 'lope.workspace': owner.workspaceId } } }]); } if (args[0] === 'ps') return ''; return '[]'; },
    async provision(script, principal) { calls.push([script, principal]); started = true; },
  });
  const ids = await Promise.all([workspace.ready(owner), workspace.ready(owner), workspace.ready(owner)]);
  assert.deepEqual(ids, Array(3).fill('b'.repeat(64)), 'Initial and concurrent callers must receive the verified container ID.');
  assert.equal(calls.filter(c => c[0] === './provision-linux.sh').length, 1); assert.equal(workspace.status(owner).state, 'ready');
  const full = new Managed({ image: 'lope-workspace:local', maxActive: 1 }, { async docker(args) { if (args[0] === 'inspect') throw new Error(); if (args[0] === 'ps') return 'one-active'; return '[]'; }, async provision() { assert.fail('Capacity must be checked before provisioning.'); } });
  await assert.rejects(full.ready(owner), { code: 'CAPACITY' }); assert.equal(full.status(owner).state, 'queued');
});
