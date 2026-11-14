import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'node:path';
import base from '../../vite.config.ts';

/** OS audit build: real shell + core apps, with sibling extensions swapped for an audit fixture. */
export default mergeConfig(base, defineConfig({
  plugins: [{
    name: 'lopeos-os-audit-extensions', enforce: 'pre',
    resolveId(source, importer) {
      if (source === './extensions' && importer?.endsWith('/shell/registry.tsx')) return resolve('tests/os-audit/os-extensions.ts');
    },
  }],
  build: { outDir: process.env.LOPE_AUDIT_OUT || 'tests/os-audit/build', emptyOutDir: true },
}));
