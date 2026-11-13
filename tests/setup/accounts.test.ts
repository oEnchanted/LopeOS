import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountNameTakenError, AccountStore, ACCOUNT_SESSION_KEY, ACCOUNTS_STORAGE_KEY, deriveAccountName, hashPassword, validateAccountFields, verifyPassword } from '../../packages/sdk/src/accounts.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const fields = { displayName: 'Alex Morgan', accountName: 'alexmorgan', password: '', confirmation: '' };

test('name derivation removes accents and punctuation, starts with a letter, and falls back to user', () => {
  assert.equal(deriveAccountName('Alex Morgan'), 'alexmorgan');
  assert.equal(deriveAccountName('Élodie Muñoz'), 'elodiemunoz');
  assert.equal(deriveAccountName('123 _-Alex.Morgan!'), 'alexmorgan');
  assert.equal(deriveAccountName('你好 123'), 'user');
  assert.equal(deriveAccountName(''), 'user');
});
test('name derivation skips reserved and occupied names, including long suffixes', () => {
  assert.equal(deriveAccountName('Alex Morgan', ['alexmorgan', 'alexmorgan2']), 'alexmorgan3');
  assert.equal(deriveAccountName('Admin'), 'admin2');
  const base = 'a'.repeat(32);
  const taken = [base, ...Array.from({ length: 8 }, (_, i) => base.slice(0, 31) + (i + 2))];
  assert.equal(deriveAccountName(base + 'extra', taken), base.slice(0, 30) + '10');
});
test('validation normalizes names without changing passwords', () => {
  assert.deepEqual(validateAccountFields({ ...fields, displayName: '  Alex\n  Morgan  ', accountName: '  ALEXMORGAN  ' }), { ok: true, displayName: 'Alex Morgan', accountName: 'alexmorgan' });
  assert.equal(validateAccountFields({ ...fields, password: ' spaced ', confirmation: ' spaced ' }).ok, true);
});
test('validation identifies invalid display names, account names, reserved names, and duplicates', () => {
  assert.deepEqual(validateAccountFields({ ...fields, displayName: ' \t ' }), { ok: false, field: 'displayName', message: 'Enter a name.' });
  assert.equal(validateAccountFields({ ...fields, displayName: 'x'.repeat(65) }).ok, false);
  for (const name of ['', '1name', '_name', 'two names', 'élo', 'x'.repeat(33), 'guest', 'shared', 'root', 'system', 'admin', 'administrator', 'everyone', 'nobody']) {
    const result = validateAccountFields({ ...fields, accountName: name });
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.field, 'accountName');
  }
  assert.deepEqual(validateAccountFields(fields, ['AlexMorgan']), { ok: false, field: 'accountName', message: 'That account name is already in use. Choose another.' });
});
test('password mismatch targets confirmation, including an empty first password', () => {
  assert.deepEqual(validateAccountFields({ ...fields, confirmation: 'oops' }), { ok: false, field: 'confirmation', message: 'The passwords do not match.' });
});
test('credentials use PBKDF2 SHA-256 with independent salts and never contain the password', async () => {
  const [first, second] = await Promise.all([hashPassword('correct horse'), hashPassword('correct horse')]);
  assert.ok(first && second);
  assert.equal(first.algorithm, 'PBKDF2-HMAC-SHA-256');
  assert.equal(first.iterations, 600_000);
  assert.equal(Buffer.from(first.salt, 'base64').length, 16);
  assert.equal(Buffer.from(first.hash, 'base64').length, 32);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(JSON.stringify(first).includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse', first), true);
  assert.equal(await verifyPassword('incorrect horse', first), false);
  assert.equal(await verifyPassword('correct horse', { ...first, iterations: 1 }), false);
});
test('empty password is stored without a credential and only accepts empty input', async () => {
  assert.equal(await hashPassword(''), null);
  assert.equal(await verifyPassword('', null), true);
  assert.equal(await verifyPassword('anything', null), false);
});
test('creation, sign-in, reload, and sign-out retain only the account id in session storage', async () => {
  const storage = new MemoryStorage(), session = new MemoryStorage();
  const store = new AccountStore(storage, session);
  assert.deepEqual(await store.list(), []);
  const account = await store.create({ ...fields, password: 'a private password', passwordHint: 'A memorable phrase', avatarDataUrl: 'data:image/jpeg;base64,AA==' });
  assert.equal(account.role, 'admin');
  assert.equal(account.lastLoginAt, null);
  assert.equal(store.getSession(), null);
  assert.equal(storage.getItem(ACCOUNTS_STORAGE_KEY)?.includes('a private password'), false);
  await assert.rejects(store.signIn('alexmorgan', 'wrong'), /incorrect/);
  const signedIn = await store.signInCreated(account);
  assert.ok(signedIn.lastLoginAt);
  assert.equal(session.getItem(ACCOUNT_SESSION_KEY), account.id);
  assert.equal(new AccountStore(storage, session).getSession()?.id, account.id);
  store.signOut();
  assert.equal(store.getSession(), null);
  await assert.rejects(store.signInCreated(account), /Sign in/);
  await store.signIn(' ALEXMORGAN ', 'a private password');
  assert.equal(store.getSession()?.displayName, 'Alex Morgan');
});
test('creation rechecks duplicate names after async hashing and serializes concurrent writes', async () => {
  const store = new AccountStore(new MemoryStorage(), new MemoryStorage());
  const results = await Promise.allSettled([store.create({ ...fields, password: 'one' }), store.create({ ...fields, password: 'two' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const failed = results.find(result => result.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && failed.reason instanceof AccountNameTakenError);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.isNameTaken(' ALEXMORGAN '), true);
});
test('storage failures throw without silently signing in or overwriting unreadable accounts', async () => {
  const storage = new MemoryStorage(), session = new MemoryStorage();
  storage.setItem(ACCOUNTS_STORAGE_KEY, '{broken');
  const store = new AccountStore(storage, session);
  await assert.rejects(store.list(), /could not be read/);
  await assert.rejects(store.create(fields), /could not be read/);
  assert.equal(storage.getItem(ACCOUNTS_STORAGE_KEY), '{broken');
  await assert.rejects(new AccountStore().create(fields), /storage is unavailable/);
  storage.removeItem(ACCOUNTS_STORAGE_KEY);
  const brokenSession = new AccountStore(storage, { ...session, getItem: session.getItem.bind(session), removeItem: session.removeItem.bind(session), setItem() { throw new Error('quota'); } });
  const account = await brokenSession.create(fields);
  await assert.rejects(brokenSession.signInCreated(account), /session could not be saved/);
  assert.equal((await brokenSession.list()).length, 1);
  assert.equal(brokenSession.getSession(), null);
});
test('automatic first sign-in is limited to the exact newly created account object', async () => {
  const storage = new MemoryStorage(), session = new MemoryStorage();
  const store = new AccountStore(storage, session);
  const account = await store.create(fields);
  await assert.rejects(store.signInCreated({ ...account }), /Sign in/);
  await assert.rejects(new AccountStore(storage, session).signInCreated(account), /Sign in/);
  await store.signInCreated(account);
  await assert.rejects(store.signInCreated(account), /Sign in/);
});
test('concurrent automatic sign-in attempts consume the creation capability only once', async () => {
  const store = new AccountStore(new MemoryStorage(), new MemoryStorage());
  const account = await store.create(fields);
  const results = await Promise.allSettled([store.signInCreated(account), store.signInCreated(account)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});
test('separate account stores retain both accounts and reject duplicate names under Web Locks', async () => {
  const storage = new MemoryStorage();
  const first = new AccountStore(storage, new MemoryStorage()), second = new AccountStore(storage, new MemoryStorage());
  await Promise.all([first.create(fields), second.create({ ...fields, accountName: 'anotheralex' })]);
  assert.equal((await first.list()).length, 2);
  const results = await Promise.allSettled([first.create({ ...fields, accountName: 'sam' }), second.create({ ...fields, accountName: 'sam' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await second.list()).length, 3);
});
