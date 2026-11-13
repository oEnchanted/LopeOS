import test from 'node:test';
import { EncryptedVault } from '../../apps/web/src/accounts/encryption.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('background account host shuts down cleanly and preserves sign-in across replacement', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-account-host-'));
  await mkdir(join(root, 'logs'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const data = join(root, 'data'), origin = 'https://test.lopeos.invalid';
  await writeFile(join(root, 'config.json'), JSON.stringify({ data, origin, port, server: fileURLToPath(new URL('./server.mjs', import.meta.url)) }));
  let child, exited;
  t.after(async () => { if (child && child.exitCode === null) { child.kill(); await exited; } await rm(root, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [fileURLToPath(new URL('./windows/host.mjs', import.meta.url)), root], { stdio: 'ignore' });
    exited = once(child, 'exit');
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, await readFile(join(root, 'logs/service.log'), 'utf8').catch(() => 'Host exited'));
      if (await fetch(`http://127.0.0.1:${port}/api/accounts/session`).then(r => r.ok).catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Account host did not start');
  };
  const encrypted = await EncryptedVault.create('deploy_test', 'test-only-password-123');
  const request = async action => {
    const response = await fetch(`http://127.0.0.1:${port}/api/accounts/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountName: 'deploy_test', displayName: 'Deployment Test', password: encrypted.password, credentialVersion: 1, vault: encrypted.envelope, recoveryProof: encrypted.recoveryProof }) });
    assert.equal(response.status, action === 'register' ? 201 : 200);
    return response.json();
  };
  await start(); const before = await request('register');
  await writeFile(join(root, 'stop'), 'stop'); assert.equal((await exited)[0], 0);
  await assert.rejects(readFile(join(data, '.lock')), { code: 'ENOENT' });
  await rm(join(root, 'stop')); await start();
  const after = await request('login'); assert.equal(after.account.id, before.account.id);
  await writeFile(join(root, 'stop'), 'stop'); assert.equal((await exited)[0], 0);
});
