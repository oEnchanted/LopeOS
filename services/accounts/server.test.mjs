import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAccountServer } from './server.mjs';

const origin = 'http://127.0.0.1:5173', password = 'a very strong test password';
const hashOf = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lope-accounts-'));
  let service, base;
  async function start() {
    service = await createAccountServer({ directory, origins: [origin], ...options });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${service.server.address().port}/api/accounts`;
  }
  await start();
  t.after(async () => { await service.dispose(); await rm(directory, { recursive: true, force: true }); });
  const call = async (path, { method = 'GET', data, cookie, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : { origin }), ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': typeof data === 'string' ? 'application/octet-stream' : 'application/json' }), ...headers }, body: data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data) });
    const json = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: json, cookie: response.headers.get('set-cookie')?.split(';')[0], setCookie: response.headers.get('set-cookie') };
  };
  async function register(accountName = 'alice') {
    const response = await call('/register', { method: 'POST', data: { accountName, displayName: accountName, password } });
    assert.equal(response.status, 201, JSON.stringify(response.body)); return response;
  }
  return { directory, call, register, restart: async () => { await service.dispose(); await start(); } };
}

test('account creation, hashed credentials, persistent session, sign-in and revocation', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/session')).body.account, null);
  const registration = await f.register(), cookie = registration.cookie;
  assert.equal(registration.body.quotaBytes, 1_000_000_000);
  assert.match(registration.setCookie, /HttpOnly/); assert.match(registration.setCookie, /SameSite=Lax/);
  assert.equal(registration.body.account.accountName, 'alice');
  assert.equal('passwordHash' in registration.body.account, false);
  const disk = await readFile(join(f.directory, 'registry.json'), 'utf8');
  assert.equal(disk.includes(password), false); assert.equal(disk.includes(cookie.split('=')[1]), false);
  await f.restart();
  assert.equal((await f.call('/session', { cookie })).body.account.id, registration.body.account.id);
  assert.equal((await f.call('/login', { method: 'POST', data: { accountName: 'alice', password: 'wrong password' } })).status, 401);
  const login = await f.call('/login', { method: 'POST', data: { accountName: 'ALICE', password } });
  assert.equal(login.status, 200); assert.notEqual(login.cookie, cookie);
  assert.equal((await f.call('/logout', { method: 'POST', cookie, data: {} })).status, 200);
  assert.equal((await f.call('/session', { cookie })).body.account, null);
  assert.equal((await f.call('/manifest', { cookie })).status, 401);
  assert.equal((await f.call('/session', { cookie: login.cookie })).body.account.accountName, 'alice');
});

test('same-origin protection, password validation, duplicate creation and credential-independent logout', async t => {
  const f = await fixture(t);
  const data = { accountName: 'alice', displayName: 'Alice', password };
  assert.equal((await f.call('/register', { method: 'POST', data, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.call('/register', { method: 'POST', data, headers: { origin: '' } })).status, 403);
  assert.equal((await f.call('/register', { method: 'POST', data: { ...data, password: 'short' } })).status, 400);
  assert.equal((await f.call('/register', { method: 'POST', data: { ...data, password: 'x'.repeat(1025) } })).status, 400);
  assert.equal((await f.call('/register', { method: 'POST', data: { ...data, accountName: '../escape' } })).status, 400);
  const results = await Promise.all([f.call('/register', { method: 'POST', data }), f.call('/register', { method: 'POST', data })]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal((await f.call('/register', { method: 'POST', data: { accountName: 'longpassword', displayName: 'Long password', password: 'x'.repeat(1024) } })).status, 201);
  assert.equal((await f.call('/logout', { method: 'POST', data: {} })).status, 200);
});

test('blob checksums, account isolation, durable manifests and revision compare-and-swap', async t => {
  const f = await fixture(t), alice = (await f.register()).cookie, bob = (await f.register('bobby')).cookie;
  const content = 'the document bytes', hash = hashOf(content);
  assert.equal((await f.call(`/blobs/${hash}`, { method: 'PUT', cookie: alice, data: 'wrong bytes' })).body.error.code, 'HASH_MISMATCH');
  assert.equal((await f.call(`/blobs/${hash}`, { method: 'PUT', cookie: alice, data: content })).status, 200);
  assert.equal((await f.call(`/blobs/${hash}`, { cookie: bob })).status, 404);
  assert.equal((await f.call(`/blobs/${hash}`, { cookie: alice, headers: { 'x-lope-account': 'different-account' } })).body.error.code, 'SESSION_CHANGED');
  assert.equal((await f.call(`/blobs/${hash}`, { method: 'PUT', cookie: bob, headers: { 'x-lope-account': 'different-account' }, data: content })).body.error.code, 'SESSION_CHANGED');
  assert.equal((await f.call('/session', { cookie: bob })).body.usedBytes, 0);
  assert.equal((await f.call(`/blobs/${hash}`, { cookie: alice })).body, content);
  const entries = [{ key: 'files:/Users/alice/LopeDrive/report.txt', hash, size: Buffer.byteLength(content), modifiedAt: new Date().toISOString() }];
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie: bob, data: { baseRevision: 0, entries } })).body.error.code, 'MISSING_BLOB');
  const commit = await f.call('/manifest', { method: 'PUT', cookie: alice, data: { baseRevision: 0, entries } });
  assert.equal(commit.status, 200); assert.equal(commit.body.revision, 1);
  const conflict = await f.call('/manifest', { method: 'PUT', cookie: alice, data: { baseRevision: 0, entries: [] } });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'REVISION_CONFLICT');
  await f.restart();
  assert.deepEqual((await f.call('/manifest', { cookie: alice })).body.entries, entries);
  assert.equal((await f.call('/session', { cookie: alice })).body.usedBytes, Buffer.byteLength(content));
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie: alice, data: { baseRevision: 1, entries: [] } })).body.usedBytes, 0);
});

test('quota accounts for staging, deduplicates hashes and serializes concurrent uploads', async t => {
  const f = await fixture(t, { quotaBytes: 10 }), cookie = (await f.register()).cookie;
  const one = '123456', two = 'abcdef', oneHash = hashOf(one), twoHash = hashOf(two);
  const responses = await Promise.all([f.call(`/blobs/${oneHash}`, { method: 'PUT', cookie, data: one }), f.call(`/blobs/${twoHash}`, { method: 'PUT', cookie, data: two })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 413]);
  const saved = responses[0].status === 200 ? one : two, hash = hashOf(saved);
  assert.equal((await f.call('/session', { cookie })).body.usedBytes, 6);
  assert.equal((await f.call(`/blobs/${hash}`, { method: 'PUT', cookie, data: saved })).body.usedBytes, 6);
  const entries = ['file:a', 'file:b'].map(key => ({ key, hash, size: 6, modifiedAt: new Date().toISOString() }));
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 0, entries } })).body.usedBytes, 6);
  assert.equal((await f.call('/cleanup', { method: 'POST', cookie, data: {} })).body.usedBytes, 6);
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 1, entries: [] } })).body.usedBytes, 0);
});

test('commits preserve another device’s staged blobs and reject malformed manifests', async t => {
  const f = await fixture(t), cookie = (await f.register()).cookie;
  const first = hashOf('first'), second = hashOf('second');
  await f.call(`/blobs/${first}`, { method: 'PUT', cookie, data: 'first' });
  await f.call(`/blobs/${second}`, { method: 'PUT', cookie, data: 'second' });
  const entry = { key: 'file:one', hash: first, size: 5, modifiedAt: new Date().toISOString() };
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 0, entries: [entry, entry] } })).status, 400);
  assert.equal((await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 0, entries: [{ ...entry, size: 1 }] } })).body.error.code, 'MISSING_BLOB');
  const commit = await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 0, entries: [entry] } });
  assert.equal(commit.body.usedBytes, 11);
  assert.equal((await f.call(`/blobs/${second}`, { cookie })).body, 'second');
  assert.equal((await f.call('/cleanup', { method: 'POST', cookie, data: {} })).body.usedBytes, 5);
  assert.equal((await f.call(`/blobs/${second}`, { cookie })).status, 404);
});

test('verified re-upload repairs a damaged blob without changing its manifest', async t => {
  const f = await fixture(t), registration = await f.register(), cookie = registration.cookie;
  const content = 'durable document', hash = hashOf(content);
  await f.call(`/blobs/${hash}`, { method: 'PUT', cookie, data: content });
  const entries = [{ key: 'file:document', hash, size: Buffer.byteLength(content), modifiedAt: new Date().toISOString() }];
  await f.call('/manifest', { method: 'PUT', cookie, data: { baseRevision: 0, entries } });
  await writeFile(join(f.directory, registration.body.account.id, 'blobs', hash), 'damaged');
  const repaired = await f.call(`/blobs/${hash}`, { method: 'PUT', cookie, data: content });
  assert.equal(repaired.status, 200); assert.equal(repaired.body.usedBytes, Buffer.byteLength(content));
  assert.equal((await f.call(`/blobs/${hash}`, { cookie })).body, content);
  assert.deepEqual((await f.call('/manifest', { cookie })).body.entries, entries);
});

test('the storage lock prevents multiple quota writers and corrupt registry is preserved', async t => {
  const f = await fixture(t);
  await assert.rejects(createAccountServer({ directory: f.directory, origins: [origin] }), /locked or unavailable/);
  const directory = await mkdtemp(join(tmpdir(), 'lope-corrupt-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'registry.json'), '{broken');
  await assert.rejects(createAccountServer({ directory, origins: [origin] }), /could not be read/);
  assert.equal(await readFile(join(directory, 'registry.json'), 'utf8'), '{broken');
});

test('production requires HTTPS origins and issues Secure host-only cookies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lope-secure-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(createAccountServer({ directory, production: true, origins: [origin] }), /HTTPS/);
  const f = await fixture(t, { production: true, origins: ['https://lope.example.com'] });
  const registration = await f.call('/register', { method: 'POST', data: { accountName: 'alice', displayName: 'Alice', password }, headers: { origin: 'https://lope.example.com' } });
  assert.equal(registration.status, 201); assert.match(registration.setCookie, /^__Host-lope-account=/); assert.match(registration.setCookie, /; Secure/); assert.match(registration.setCookie, /Path=\//);
});
