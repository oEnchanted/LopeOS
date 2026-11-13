import { spawn } from 'node:child_process';
import { once } from 'node:events';
const children = [];
let stopping = false;
function run(args, required = false) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.push(child);
  child.once('exit', code => { if (code && !stopping) { if (required) stop(code); else console.warn('Workspace runtime is unavailable; the desktop server remains running.'); } });
  return child;
}
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(child => child.kill('SIGTERM')); setTimeout(() => process.exit(code), 600).unref(); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
run(['services/runtime/server.mjs']);
run(['services/accounts/server.mjs']);
run(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], true);
await Promise.all(children.map(child => once(child, 'exit')));
