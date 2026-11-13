import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import application from '../../vite.config.ts';

// Keep regression sessions stable while other app owners work in the shared repo.
export default mergeConfig(application, {
  cacheDir: '/tmp/lope-writer-vite-cache',
  root: fileURLToPath(new URL('../../',import.meta.url)),
  server: { port: 5183, strictPort: true, hmr: false },
});
