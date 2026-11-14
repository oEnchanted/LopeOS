import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserIdentity } from './identity.mjs';
import { createBrowserGateway } from './gateway.mjs';
import { DockerBrowserAllocator } from './docker.mjs';
import { startWslLifetime } from './wsl-lifetime.mjs';

const origin = process.env.LOPE_BROWSER_SITE_ORIGIN;
if (!origin || new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:') throw new Error('Set the exact HTTPS LOPE_BROWSER_SITE_ORIGIN.');
const directory = resolve(process.env.LOPE_BROWSER_HOST_DATA || '.browser-host');
await mkdir(directory, { recursive: true, mode: 0o700 });
const lockPath = join(directory, 'gateway.lock'); let lock;
try { lock = await open(lockPath, 'wx', 0o600); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const pid = Number(await readFile(lockPath, 'utf8'));
  if (!Number.isInteger(pid) || pid < 1) throw new Error('The browser gateway lock needs an operator check.');
  try { process.kill(pid, 0); throw new Error('The browser gateway is already running.'); }
  catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
  await rm(lockPath); lock = await open(lockPath, 'wx', 0o600);
}
await lock.writeFile(String(process.pid));
const unlock = async () => { await lock.close(); await rm(lockPath, { force: true }); };
let service, lifetime, closing;
const close = () => closing ??= (async () => {
  try { await service?.close(); }
  finally { try { await lifetime?.stop(); } finally { await unlock(); } }
})();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void close().finally(() => process.exit(0)); });
try {
  const secretPath = join(directory, 'identity-key'); let secret;
  try { secret = await readFile(secretPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; secret = randomBytes(32).toString('hex'); await writeFile(secretPath, secret, { flag: 'wx', mode: 0o600 }); }
  const identity = new BrowserIdentity({ secret, accountsUrl: process.env.LOPE_BROWSER_ACCOUNTS_URL || 'http://127.0.0.1:4176', production: true });
  const allocator = new DockerBrowserAllocator({ directory: join(directory, 'workers'), image: process.env.LOPE_BROWSER_IMAGE || 'lope-browser:local', distro: process.env.LOPE_BROWSER_WSL_DISTRO });
  const maxWorkers = Number(process.env.LOPE_BROWSER_MAX_WORKERS || 2);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 16) throw new Error('Invalid browser capacity.');
  lifetime = await startWslLifetime({ distro: process.env.LOPE_BROWSER_WSL_DISTRO, onUnexpectedExit: error => {
    console.error(error.message);
    void close().finally(() => process.exit(1));
  } });
  await allocator.verify();
  service = createBrowserGateway({ identity, allocator, origins: [origin], maxWorkers });
  await new Promise((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(Number(process.env.LOPE_BROWSER_GATEWAY_PORT || 4177), '127.0.0.1', () => {
      service.server.off('error', reject); resolve();
    });
  });
  console.log('Lope Browser account gateway ready on loopback.');
} catch (error) { await close(); throw error; }
