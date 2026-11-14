import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { getModelReleases } from '../apps/web/src/updates/model-updates.ts';
import { assertWorkerAccepts } from './release-validation.ts';

/** Describe the exact published bytes, including Vite's copied public assets. */
export function releasePlugin(version: string, build: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'lope-release',
    configResolved(value) { config = value; },
    configureServer(server) {
      server.middlewares.use('/__lope/version.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ version, build, development: true }));
      });
    },
    async closeBundle() {
      if (config.command !== 'build') return;
      const output = resolve(config.root, config.build.outDir);
      const assets: { url: string; size: number; sha256: string }[] = [];
      async function walk(directory: string, relative = ''): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          // Optional local AI downloads have their own verified cache and lifecycle.
          if (name === 'models' || name === '__lope' || name === 'lope-sw.js' || name.endsWith('.map') || entry.name.startsWith('.')) continue;
          if (entry.isDirectory()) await walk(join(directory, entry.name), name);
          else if (entry.isFile()) {
            const bytes = await readFile(join(directory, entry.name));
            assets.push({ url: '/' + name.split('/').map(encodeURIComponent).join('/'), size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
          }
        }
      }
      await walk(output);
      assets.sort((a, b) => a.url.localeCompare(b.url));
      if (!assets.some(asset => asset.url === '/index.html')) throw new Error('The LopeOS release is missing index.html.');
      const models = await getModelReleases();
      const release = { format: 1 as const, version, build, releasedAt: build, totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0), assets, models };
      assertWorkerAccepts(release, await readFile(join(output, 'lope-sw.js'), 'utf8'));
      await mkdir(join(output, '__lope'), { recursive: true });
      await writeFile(join(output, '__lope/version.json'), JSON.stringify(release));
    },
  };
}
