import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { chromium } from '@playwright/test';

const port = Number(process.env.LOPE_BROWSER_PORT || 4175);
const existing = await new Promise(resolve => {
  const socket = createConnection({ port, host: '127.0.0.1' });
  socket.setTimeout(500); socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
if (existing) { console.log(`Browser worker already listens on port ${port}.`); process.exit(0); }
await mkdir('.runtime', { recursive: true, mode: 0o700 });
let token;
try { token = (await readFile('.runtime/browser-token', 'utf8')).trim(); }
catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('base64url'); await writeFile('.runtime/browser-token', token, { mode: 0o600, flag: 'wx' }); }
await chmod('.runtime/browser-token', 0o600);
const child = spawn(process.execPath, ['services/browser/src/main.mjs'], { stdio: 'inherit', env: {
  ...process.env, LOPE_BROWSER_TOKEN: token, LOPE_BROWSER_PORT: String(port), LOPE_BROWSER_DATA: process.env.LOPE_BROWSER_DATA || '.browser-data', LOPE_BROWSER_HEADLESS: process.env.LOPE_BROWSER_HEADLESS || 'true',
  CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
} });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
