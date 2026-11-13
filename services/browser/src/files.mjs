import { open, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createBrowserFileBridge } from '../../runtime/browser-bridge.js';

/** Sandbox-side capabilities supplied to Agent 2's owner-authorized FileService bridge. */
export function createRuntimeFileBridge({ url, getToken, validateSession = () => {}, stagingRoot, request = (...args) => fetch(...args) }) {
  const origin = new URL(url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid runtime service origin.');
  const root = resolve(stagingRoot);
  async function boundary(sessionId, path, directory = false) {
    validateSession(sessionId);
    const sessionRoot = await realpath(join(root, sessionId));
    const actual = await realpath(directory ? path : resolve(path, '..'));
    if (actual !== sessionRoot && !actual.startsWith(sessionRoot + sep)) throw new Error('The transfer is outside this browser session.');
    return actual;
  }
  function bridge(name = 'selected-file') {
    return createBrowserFileBridge({ runtimeUrl: origin.origin,
      resolveSession: async sessionId => { validateSession(sessionId); const runtimeToken = await getToken();
        if (!runtimeToken) throw new Error('Workspace authorization is unavailable.'); return { runtimeToken }; },
      fetchImpl: (path, options) => request(path, { ...options, redirect: 'error' }),
      readStagedDownload: async input => {
        await boundary(input.sessionId, input.path);
        const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const info = await handle.stat(); if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('Workspace transfers are limited to 8 MiB.');
          if (input.signal.aborted) throw new Error('Transfer canceled.'); return await handle.readFile();
        } finally { await handle.close(); }
      },
      writeStagedUpload: async input => {
        await boundary(input.sessionId, input.destination, true);
        const safeName = basename(name).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160) || 'selected-file';
        const path = join(input.destination, safeName);
        await writeFile(path, input.data, { flag: 'wx', mode: 0o600 }); return { path };
      },
    });
  }
  return {
    importDownload: input => bridge().importDownload(input),
    materializeUpload: input => bridge(basename(input.fileId)).materializeUpload(input),
  };
}
