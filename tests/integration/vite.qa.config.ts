import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'node:path';
import base from '../../vite.config.ts';

/** Test-only registry extension list isolates Agent 3 QA from unfinished sibling apps. */
export default mergeConfig(base, defineConfig({
  plugins: [{
    name: 'lopeos-application-qa-extensions', enforce: 'pre',
    resolveId(source, importer) {
      if (source === './extensions' && importer?.endsWith('/shell/registry.tsx')) return resolve('tests/integration/qa-extensions.ts');
    },
  }],
  build: { outDir: 'tests/integration/build', emptyOutDir: true },
}));
