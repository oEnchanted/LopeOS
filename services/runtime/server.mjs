// Stable entry for the desktop's dev:runtime command. No host-shell fallback.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareDevelopment } from './dev.js';
const publicMode = process.env.LOPE_PUBLIC_VISITORS === '1';
const registry = process.env.LOPE_PRINCIPALS_FILE || (!publicMode ? await prepareDevelopment() : undefined);
const child = spawn(process.execPath, [fileURLToPath(new URL(publicMode ? './public-server.js' : './server.js', import.meta.url))], { stdio: 'inherit', env: { ...process.env, ...(registry ? { LOPE_PRINCIPALS_FILE: registry } : {}) } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
