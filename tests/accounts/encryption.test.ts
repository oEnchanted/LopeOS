import test from 'node:test';
import assert from 'node:assert/strict';
import { EncryptedVault, credentials, recoveryCredentials, checksum } from '../../apps/web/src/accounts/encryption.ts';

test('encrypted files and names survive unlock and recovery, rejecting tampering and unrelated keys', async () => {
  const password = 'a long independent test phrase';
  const created = await EncryptedVault.create('alice', password);
  const plain = new TextEncoder().encode('private file contents');
  const entry = { key: 'drive:private-name.txt', hash: await checksum(plain), size: plain.length, modifiedAt: new Date().toISOString() };
  const cipher = await created.vault.encryptBlob(entry, plain);
  const manifest = await created.vault.encodeManifest([entry]);
  assert.equal(new TextDecoder().decode(cipher.bytes).includes('private file contents'), false);
  assert.equal(JSON.stringify(manifest).includes('private-name'), false);
  assert.notEqual(created.password, password);
  const proof = await recoveryCredentials(created.recoveryKey);
  assert.notEqual(proof.proof, created.recoveryKey.replaceAll('-', ''));
  assert.equal(created.recoveryProof, proof.proof);
  const locked = await EncryptedVault.unlock(created.envelope, 'ALICE', password);
  assert.deepEqual(await locked.decodeManifest(manifest), [entry]);
  assert.deepEqual(await locked.decryptBlob(entry, cipher.bytes), plain);
  await assert.rejects(EncryptedVault.unlock(created.envelope, 'alice', 'wrong password'));
  const corrupt = structuredClone(manifest); corrupt[0].key = corrupt[0].key.slice(0, -2) + (corrupt[0].key.endsWith('00') ? '01' : '00');
  await assert.rejects(locked.decodeManifest(corrupt));
  const corruptBytes = cipher.bytes.slice(); corruptBytes[12] ^= 1;
  await assert.rejects(locked.decryptBlob(entry, corruptBytes));
  const recovered = await EncryptedVault.recover(created.envelope, created.recoveryKey);
  const updated = await recovered.rewrap('alice', 'a new long password phrase');
  assert.equal(updated.envelope.id, created.envelope.id);
  await assert.rejects(EncryptedVault.recover(updated.envelope, created.recoveryKey));
  const reopened = await EncryptedVault.unlock(updated.envelope, 'alice', 'a new long password phrase');
  await reopened.decodeManifest(manifest);
  assert.deepEqual(await reopened.decryptBlob(entry, cipher.bytes), plain);
  const other = await EncryptedVault.create('bob', password);
  await assert.rejects(other.vault.decodeManifest(manifest));
  created.vault.destroy(); await assert.rejects(created.vault.encryptBlob(entry, plain));
  proof.wrapping.fill(0); locked.destroy(); recovered.destroy(); reopened.destroy(); other.vault.destroy();
});

test('authentication and wrapping credentials are domain separated and account bound', async () => {
  const a = await credentials('alice', 'test password phrase'), b = await credentials('bob', 'test password phrase');
  assert.notEqual(a.password, b.password);
  assert.notEqual(a.password, Array.from(a.wrapping, n => n.toString(16).padStart(2, '0')).join(''));
  a.wrapping.fill(0); b.wrapping.fill(0);
});
