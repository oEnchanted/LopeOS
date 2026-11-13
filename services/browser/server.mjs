// Loopback development bootstrap. Production gateways launch src/main.mjs with a per-owner token.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const tokenFile = resolve('.runtime/browser-token');
process.env.LOPE_BROWSER_TOKEN ||= randomBytes(32).toString('hex');
process.env.LOPE_BROWSER_DATA ||= resolve('.browser-data');
process.env.CHROMIUM_EXECUTABLE ||= process.env.LOPE_CHROMIUM_EXECUTABLE || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
process.env.LOPE_BROWSER_HEADLESS ||= process.env.SELKIES_URL ? 'false' : 'true';
await mkdir(resolve('.runtime'), { recursive: true, mode: 0o700 });
await writeFile(tokenFile, process.env.LOPE_BROWSER_TOKEN, { mode: 0o600 }); await chmod(tokenFile, 0o600);
await import('./src/main.mjs');
for (const signal of ['SIGINT', 'SIGTERM']) process.prependListener(signal, async () => {
  try { if ((await readFile(tokenFile, 'utf8')) === process.env.LOPE_BROWSER_TOKEN) await rm(tokenFile, { force: true }); } catch {}
});
