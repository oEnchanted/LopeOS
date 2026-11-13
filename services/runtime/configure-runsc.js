import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SANDBOX_RUNTIME, RUNTIME_ARGUMENTS } from './sandbox-policy.js';

export function daemonConfiguration(current, binary) {
  if (!current || typeof current !== 'object' || Array.isArray(current) || !['/usr/bin/runsc', '/usr/local/bin/runsc'].includes(binary) || (current.runtimes && (typeof current.runtimes !== 'object' || Array.isArray(current.runtimes)))) throw new Error('Invalid Docker sandbox configuration.');
  return { ...current, runtimes: { ...current.runtimes, [SANDBOX_RUNTIME]: { path: binary, runtimeArgs: [...RUNTIME_ARGUMENTS] } } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Configure the sandbox on the Linux/WSL2 host as root.');
    const binary = process.argv[2], info = await fs.lstat(binary);
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022)) throw new Error('The sandbox runtime must be a root-owned, protected executable.');
    const file = '/etc/docker/daemon.json'; await fs.mkdir(path.dirname(file), { recursive: true });
    let raw = '{}'; try { raw = await fs.readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = JSON.stringify(daemonConfiguration(JSON.parse(raw), binary), null, 2) + '\n';
    await fs.writeFile(file + `.lope-backup-${Date.now()}`, raw, { mode: 0o600, flag: 'wx' });
    await fs.writeFile(file + '.lope-new', next, { mode: 0o600 }); await fs.rename(file + '.lope-new', file);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
