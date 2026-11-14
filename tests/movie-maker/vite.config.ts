import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';
// Keep long offline export checks stable while other workspace agents edit modules.
export default mergeConfig(base, defineConfig({ optimizeDeps: { entries: ['tests/movie-maker/engine.html', 'tests/movie-maker/harness.html'], include: ['react', 'react-dom/client', 'lucide-react'] }, server: { host: '127.0.0.1', port: 5188, strictPort: true, hmr: false } }));
