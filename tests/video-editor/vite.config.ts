import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],optimizeDeps:{entries:['tests/video-editor/engine.html','tests/video-editor/harness.html'],include:['react','react-dom/client','lucide-react']},server:{host:'127.0.0.1',port:5190,strictPort:true,hmr:false}});
