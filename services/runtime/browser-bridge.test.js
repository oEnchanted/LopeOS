import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFileBridge } from './browser-bridge.js';

test('browser transfers use server-resolved credentials, create-only downloads and scoped staging callbacks', async () => {
  const requests = [], resolved = [], staged = [];
  const bridge = createBrowserFileBridge({
    runtimeUrl: 'http://127.0.0.1:4174',
    async resolveSession(id) { resolved.push(id); if (id !== 'owned-session') throw new Error('Not owned'); return { runtimeToken: 'private-server-credential' }; },
    async readStagedDownload(input) { assert.equal(input.path, 'private/stage'); return Uint8Array.from([0, 255, 17]); },
    async writeStagedUpload(input) { staged.push(input); return { path: '/private/upload.bin' }; },
    async fetchImpl(url, init) {
      assert.equal(init.headers.Authorization, 'Bearer private-server-credential'); requests.push({ url, init });
      if (url.includes('/fs/read')) return { ok: true, json: async () => ({ data: Buffer.from([0, 255, 17]).toString('base64') }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(await bridge.importDownload({ sessionId: 'owned-session', transferId: 'download', name: 'archive.bin', path: 'private/stage', signal: new AbortController().signal }), { fileId: '/Downloads/archive.bin' });
  assert.equal(JSON.parse(requests[1].init.body).createOnly, true);
  assert.deepEqual(await bridge.materializeUpload({ sessionId: 'owned-session', fileId: '/Downloads/archive.bin', destination: '/private/stage' }), { path: '/private/upload.bin' });
  assert.deepEqual([...staged[0].data], [0, 255, 17]); assert.deepEqual(resolved, ['owned-session', 'owned-session']);
  await assert.rejects(bridge.materializeUpload({ sessionId: 'not-owned', fileId: '/Downloads/archive.bin', destination: '/private/stage' }), /Not owned/);
  await assert.rejects(bridge.importDownload({ sessionId: 'owned-session', name: '../../secret' }), { code: 'INVALID' });
});
