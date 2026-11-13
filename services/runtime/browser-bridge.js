import { normalizePath, RuntimeError } from './config.js';
const MAX_TRANSFER = 8 * 1024 * 1024;
/**
 * Agent 4 server-side adapter. resolveSession verifies the caller owns sessionId.
 * Staging callbacks execute in the browser worker's isolated transfer boundary;
 * this control-plane module never resolves or reads an arbitrary host path.
 */
export function createBrowserFileBridge({ runtimeUrl, resolveSession, readStagedDownload, writeStagedUpload, fetchImpl = fetch }) {
  if (!/^https?:$/.test(new URL(runtimeUrl).protocol)) throw new Error('Invalid runtime URL');
  async function request(owner, endpoint, options = {}) {
    const response = await fetchImpl(`${runtimeUrl}/api${endpoint}`, { ...options, headers: { Authorization: `Bearer ${owner.runtimeToken}`, 'Content-Type': 'application/json' }, signal: options.signal ?? AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new RuntimeError(result.error?.code || 'TRANSFER', result.error?.message || 'Workspace transfer failed.', response.status);
    return result;
  }
  return {
    async importDownload(input) {
      const owner = await resolveSession(input.sessionId);
      const name = input.name;
      if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/.test(name) || Buffer.byteLength(name) > 180) throw new RuntimeError('INVALID', 'Invalid download filename.');
      const data = await readStagedDownload({ ...input, owner });
      if (!(data instanceof Uint8Array) || data.byteLength > MAX_TRANSFER) throw new RuntimeError('LIMIT', 'Downloads through the workspace bridge are limited to 8 MiB.', 413);
      try { await request(owner, '/fs/mkdir', { method: 'POST', body: JSON.stringify({ path: '/Downloads' }), signal: input.signal }); }
      catch (e) { if (e.code !== 'CONFLICT') throw e; }
      for (let i = 0; i < 100; i++) {
        const path = `/Downloads/${i ? `${i}-` : ''}${name}`;
        try {
          await request(owner, '/fs/write', { method: 'PUT', body: JSON.stringify({ path, data: Buffer.from(data).toString('base64'), createOnly: true }), signal: input.signal });
          return { fileId: path };
        } catch (e) { if (e.code !== 'CONFLICT') throw e; }
      }
      throw new RuntimeError('CONFLICT', 'Choose a different download filename.', 409);
    },
    async materializeUpload(input) {
      const owner = await resolveSession(input.sessionId), path = normalizePath(input.fileId);
      const result = await request(owner, `/fs/read?encoding=base64&path=${encodeURIComponent(path)}`);
      const data = Buffer.from(result.data, 'base64');
      if (data.byteLength > MAX_TRANSFER) throw new RuntimeError('LIMIT', 'Uploads through the workspace bridge are limited to 8 MiB.', 413);
      // Agent 4 validates destination against the current session's private staging
      // directory and performs an exclusive/no-follow write inside that sandbox.
      return writeStagedUpload({ sessionId: input.sessionId, owner, destination: input.destination, data });
    },
  };
}
