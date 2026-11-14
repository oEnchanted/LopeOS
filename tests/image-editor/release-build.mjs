import { build } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const outDir = 'dist-photoshop-audit';
await build({ build: { outDir, emptyOutDir: true, rollupOptions: { input: {
  desktop: 'index.html',
  editor: 'tests/image-editor/release.html',
  handoff: 'tests/image-editor/release-handoff.html',
} } } });
async function hashes(dir) {
  const output = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(output, await hashes(file));
    else output[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return output;
}
const artifacts = await hashes(outDir);
const sources = {};
const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n');
for (const file of [...new Set(paths)].sort()) {
  if (!/^(apps\/|packages\/|services\/|scripts\/|tests\/image-editor\/|tests\/lightroom\/|vite\.config|package|pnpm|tsconfig|index\.html)/.test(file) || /\.(png|jpg|jpeg|webp|gif|pdf|tif)$/.test(file)) continue;
  try { sources[file] = createHash('sha256').update(await readFile(file)).digest('hex'); } catch {}
}
await writeFile('docs/image-editor/release-audit/build-manifest.json', JSON.stringify({
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  buildId: createHash('sha256').update(JSON.stringify(artifacts)).digest('hex'),
  builtAt: new Date().toISOString(), outDir, node: process.version, artifacts, sources,
}, null, 2) + '\n');
