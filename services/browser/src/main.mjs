import { BrowserEngine } from './engine.mjs';
import { createBrowserServer } from './server.mjs';
import { resolve } from 'node:path';
import { createRuntimeFileBridge } from './files.mjs';
import { readFile } from 'node:fs/promises';

const token = process.env.LOPE_BROWSER_TOKEN;
if (!token || token.length < 32) throw new Error('Set LOPE_BROWSER_TOKEN to a random secret of at least 32 characters.');
if (process.platform === 'linux' && process.getuid?.() === 0) throw new Error('Run the browser worker as an unprivileged user. Chromium sandboxing is required.');
const port = Number(process.env.LOPE_BROWSER_PORT || 4175);
const executable = process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
const streamEnabled = !!process.env.SELKIES_URL && !!process.env.SELKIES_BASIC_AUTH_PASSWORD;
const engine = new BrowserEngine({ executable,
  dataRoot: resolve(process.env.LOPE_BROWSER_DATA || 'services/browser/.data'),
  headless: process.env.LOPE_BROWSER_HEADLESS === 'true',
  streamUrl: streamEnabled ? '/api/browser/stream/selkies/' : null,
  files: process.env.LOPE_RUNTIME_TRANSFER_URL ? createRuntimeFileBridge({ url: process.env.LOPE_RUNTIME_TRANSFER_URL,
    stagingRoot: resolve(process.env.LOPE_BROWSER_DATA || 'services/browser/.data', 'transfers'), validateSession: id => engine.get(id),
    getToken: async () => process.env.LOPE_RUNTIME_TRANSFER_TOKEN || (process.env.LOPE_RUNTIME_TRANSFER_TOKEN_FILE ? (await readFile(process.env.LOPE_RUNTIME_TRANSFER_TOKEN_FILE, 'utf8')).trim() : null) }) : null });
await engine.start();
let closing = false;
const shutdown = async () => { if (closing) return; closing = true; server.close(); await engine.close(); process.exit(0); };
const server = createBrowserServer(engine, { token,
  origins: (process.env.LOPE_BROWSER_ORIGINS || 'http://127.0.0.1:5173').split(','),
  hosts: (process.env.LOPE_BROWSER_HOSTS || '127.0.0.1,localhost').split(','),
  selkies: streamEnabled ? { url: process.env.SELKIES_URL,
    user: process.env.SELKIES_BASIC_AUTH_USER || 'lope', password: process.env.SELKIES_BASIC_AUTH_PASSWORD } : null,
  idleMs: Number(process.env.LOPE_BROWSER_IDLE_MS || 1800000), onIdle: shutdown,
});
server.listen(port, process.env.LOPE_BROWSER_BIND || '127.0.0.1', () => {
  console.log(`Lope Browser worker ready on port ${port}; media ${streamEnabled ? 'configured' : 'unavailable'}.`);
});
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
