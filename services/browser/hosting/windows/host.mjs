import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (config.version !== 1 || !/^[A-Za-z0-9_.-]+$/.test(config.distro) || new URL(config.origin).origin !== config.origin) throw new Error('Invalid browser host configuration.');
Object.assign(process.env, { LOPE_BROWSER_SITE_ORIGIN: config.origin, LOPE_BROWSER_HOST_DATA: config.data,
  LOPE_BROWSER_WSL_DISTRO: config.distro, LOPE_BROWSER_MAX_WORKERS: String(config.maxWorkers || 2) });
await import('../main.mjs');
