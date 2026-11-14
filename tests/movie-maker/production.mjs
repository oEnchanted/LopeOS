/** Isolated production build of the actual app and shared packages, using the test-only SDK host. */
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
const outDir = '/private/tmp/lope-movie-maker-production';
// Sample media is imported by the app, so the build emits it under assets/.
await build({ configFile: false, plugins: [react()], publicDir: false, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'tests/movie-maker/harness.html' } } });
await preview({ configFile: false, publicDir: false, build: { outDir }, preview: { host: '127.0.0.1', port: 5179, strictPort: true } });
console.log('Movie Maker production test preview: http://127.0.0.1:5179/tests/movie-maker/harness.html');
