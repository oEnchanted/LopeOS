// node-pty's macOS prebuilt spawn helper may arrive without its executable bit.
// Repair only the installed helper for this platform; never change its contents.
import { createRequire } from 'node:module';
import { chmod, stat } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.dirname(require.resolve('node-pty/package.json'));
for (const relative of [`prebuilds/${process.platform}-${process.arch}/spawn-helper`, 'build/Release/spawn-helper']) {
  const file = path.join(root, relative);
  try { const s = await stat(file); if ((s.mode & 0o111) !== 0o111) await chmod(file, s.mode | 0o111); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
