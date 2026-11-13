import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { sha256 } from './config.js';

/** Local-only identity bootstrap; secrets stay in private files for the dev proxy. */
export async function prepareDevelopment() {
  const dir = fileURLToPath(new URL('../../.runtime/', import.meta.url));
  await fs.mkdir(dir, { mode: 0o700, recursive: true }); await fs.chmod(dir, 0o700);
  await fs.writeFile(path.join(dir, '.gitignore'), '*\n', { mode: 0o600 });
  const tokenFile = path.join(dir, 'token');
  let token;
  try { token = (await fs.readFile(tokenFile, 'utf8')).trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; token = randomBytes(32).toString('base64url'); await fs.writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' }); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid .runtime/token. Use a dedicated principal registry for custom credentials.');
  await fs.chmod(tokenFile, 0o600);
  const principalFile = path.join(dir, 'principals.json');
  await fs.writeFile(principalFile, JSON.stringify([{ userId: 'local', workspaceId: 'local', container: 'lope-local', tokenHash: sha256(token) }], null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(principalFile, 0o600);
  return principalFile;
}
