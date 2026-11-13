import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLocalValue, decodeLocalValue, isBackupStorageKey, validateLocalData, summarizeLocalData, type EncodedValue, type LocalBackupData } from '../../apps/web/src/backup/local-data.ts';
import { hashPassword, verifyPassword } from '../../packages/sdk/src/accounts.ts';

const empty = (): LocalBackupData => ({ version: 1, storage: {}, databases: [] });
const recordBackup = (value: EncodedValue): LocalBackupData => ({ version: 1, storage: {}, databases: [{ name: 'lope.writer.recovery.v1', version: 1, stores: [{ name: 'documents', records: [{ key: 'draft-1', value }] }] }] });
const record = async (value: unknown) => recordBackup(await encodeLocalValue({ id: 'draft-1', value }));

test('the portable codec preserves binary buffers, sliced typed arrays, clamped pixels, dates, and undefined fields', async () => {
  const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  const original = {
    id: 'draft-1', bytes: new Uint8Array(buffer, 1, 3), pixels: new Uint8ClampedArray([0, 255, 128]),
    floating: new Float32Array([1.25, -2.5]), binary: buffer, view: new DataView(buffer, 1, 2),
    missing: undefined, created: new Date('2026-11-13T00:00:00.000Z'), large: 123456789123456789n,
    taggedAppData: { type: 'binary', data: 'This is ordinary app data.' },
  };
  const encoded = await encodeLocalValue(original);
  const backup = validateLocalData(JSON.parse(JSON.stringify(recordBackup(encoded))));
  const decoded = decodeLocalValue(backup.databases[0].stores[0].records[0].value) as typeof original;
  assert.deepEqual(Array.from(decoded.bytes), [2, 3, 4]);
  assert.ok(decoded.pixels instanceof Uint8ClampedArray);
  assert.ok(decoded.floating instanceof Float32Array);
  assert.deepEqual(Array.from(decoded.floating), [1.25, -2.5]);
  assert.deepEqual(new Uint8Array(decoded.binary), new Uint8Array(buffer));
  assert.equal(decoded.view.byteLength, 2);
  assert.equal(decoded.view.getUint8(0), 2);
  assert.ok(Object.hasOwn(decoded, 'missing'));
  assert.equal(decoded.missing, undefined);
  assert.equal(decoded.created.toISOString(), original.created.toISOString());
  assert.equal(decoded.large, original.large);
  assert.deepEqual(decoded.taggedAppData, original.taggedAppData);
});

test('photo originals and files retain their bytes and media metadata', async () => {
  const original = new Blob([new Uint8Array([0, 255, 9])], { type: 'image/png' });
  const file = new File([original], 'photo.png', { type: original.type, lastModified: 100 });
  const decoded = decodeLocalValue(await encodeLocalValue({ original, file })) as { original: Blob; file: File };
  assert.ok(decoded.original instanceof Blob);
  assert.deepEqual(new Uint8Array(await decoded.original.arrayBuffer()), new Uint8Array([0, 255, 9]));
  assert.equal(decoded.original.type, 'image/png');
  assert.equal(decoded.file.name, 'photo.png');
  assert.equal(decoded.file.lastModified, 100);
});

test('large photo originals validate and round-trip without recursive base64 matching', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024 + 1);
  bytes[0] = 17; bytes[bytes.length - 1] = 255;
  const backup = await record(new Blob([bytes], { type: 'image/jpeg' }));
  validateLocalData(backup);
  const decoded = decodeLocalValue(backup.databases[0].stores[0].records[0].value) as { value: Blob };
  const restored = new Uint8Array(await decoded.value.arrayBuffer());
  assert.equal(restored.length, bytes.length);
  assert.equal(restored[0], 17);
  assert.equal(restored[restored.length - 1], 255);
});

test('all local account credentials and per-user preferences survive JSON round-trip', async () => {
  const password = await hashPassword('backup password');
  const account = { id: 'user-1', accountName: 'alex', displayName: 'Alex', role: 'admin', avatarDataUrl: null, passwordHint: 'A clue', password, createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: null };
  const original = empty();
  original.storage['lope.accounts.v1'] = JSON.stringify({ version: 1, accounts: [account] });
  original.storage['lope.preferences.user.user-1.v2'] = JSON.stringify({ version: 2, preferences: { theme: 'dark', dockSize: 64 } });
  original.storage['lope.assets.wallpapers.v1'] = JSON.stringify({ personalWallpaper: { dataUrl: 'data:image/png;base64,AAAA' } });
  const restored = validateLocalData(JSON.parse(JSON.stringify(original)));
  assert.equal(await verifyPassword('backup password', JSON.parse(restored.storage['lope.accounts.v1']).accounts[0].password), true);
  assert.deepEqual(summarizeLocalData(restored), { accounts: 1, settings: 3, records: 0 });
  const duplicate = JSON.parse(JSON.stringify(original));
  duplicate.storage['lope.accounts.v1'] = JSON.stringify({ version: 1, accounts: [account, account] });
  assert.throws(() => validateLocalData(duplicate), /duplicate user accounts/);
  const malformed = JSON.parse(JSON.stringify(original));
  malformed.storage['lope.accounts.v1'] = JSON.stringify({ version: 1, accounts: [{ ...account, password: { ...password, iterations: 1 } }] });
  assert.throws(() => validateLocalData(malformed), /invalid user accounts/);
});

test('the browser storage allowlist excludes authentication, unrelated applications, and unknown future keys', () => {
  for (const key of ['lope.account.session.v1', 'lope.auth.token', 'other.application', 'lope.future.v9', 'lope.browser.password', 'lope.photo.apiKey']) assert.equal(isBackupStorageKey(key), false, key);
  for (const key of ['lope.accounts.v1', 'lope.preferences.v2', 'lope.preferences.user.some-id.v2', 'lope.session.documents.v1', 'lope.session.layout.v1', 'lope.assets.wallpapers.v1', 'lope.writer.autosave']) assert.equal(isBackupStorageKey(key), true, key);
  assert.throws(() => validateLocalData({ ...empty(), storage: { 'lope.account.session.v1': 'user-1' } }), /unsupported browser storage/);
  assert.throws(() => validateLocalData({ ...empty(), storage: { 'lope.preferences.v2': '{"version":2,"preferences":{"dockSize":10000}}' } }), /invalid preferences/);
});

test('untrusted import data cannot select arbitrary databases or stores, or duplicate record IDs', async () => {
  const backup = await record(new Uint8Array([1]));
  const copy = () => JSON.parse(JSON.stringify(backup)) as LocalBackupData;
  const db = copy(); db.databases[0].name = 'lope.photo-ai-models.v1';
  assert.throws(() => validateLocalData(db), /unsupported or duplicate database/);
  const store = copy(); store.databases[0].stores[0].name = 'credentials';
  assert.throws(() => validateLocalData(store), /unsupported or duplicate database store/);
  const version = copy(); version.databases[0].version = 99;
  assert.throws(() => validateLocalData(version), /unsupported database version/);
  const duplicate = copy(); duplicate.databases[0].stores[0].records.push(duplicate.databases[0].stores[0].records[0]);
  assert.throws(() => validateLocalData(duplicate), /duplicate database record key/);
  const mismatch = copy(); mismatch.databases[0].stores[0].records[0].key = 'other';
  assert.throws(() => validateLocalData(mismatch), /record ID does not match/);
  const missing = copy(); missing.databases[0].stores = [];
  assert.throws(() => validateLocalData(missing), /missing database store/);
});

test('invalid binary payloads and prototype properties are rejected before restoration', async () => {
  for (const bad of [
    { type: 'binary', kind: 'Uint8Array', data: 'not base64' },
    { type: 'binary', kind: 'Function', data: '' },
    { type: 'binary', kind: 'Float64Array', data: 'AQ==' },
    { type: 'binary', kind: 'Uint8Array', data: 'AB==' },
    { type: 'object', value: [['__proto__', { type: 'object', value: [] }]] },
    { type: 'object', value: [['x', 1], ['x', 2]] },
  ]) {
    const encoded = { type: 'object', value: [['id', 'draft-1'], ['bad', bad]] } as EncodedValue;
    assert.throws(() => validateLocalData(recordBackup(encoded)), /Invalid LopeOS backup/);
  }
  await assert.rejects(() => encodeLocalValue(JSON.parse('{"__proto__":{"polluted":true}}')), /unsafe object property/);
  await assert.rejects(() => encodeLocalValue(new Map()), /unsupported local data type/);
  assert.throws(() => validateLocalData({ ...empty(), version: 2 }), /unsupported local data format/);
  assert.throws(() => validateLocalData({ ...empty(), inject: true }), /unsupported local data format/);
});
