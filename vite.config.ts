import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { releasePlugin } from './scripts/release-plugin.ts';
const packageVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
// Published releases replace the patch number with the deploy workflow's run
// number, which increases on every run, so each update clients see is higher.
const releaseNumber = process.env.LOPE_RELEASE_NUMBER;
if (releaseNumber !== undefined && !/^[1-9]\d{0,8}$/.test(releaseNumber)) throw new Error('LOPE_RELEASE_NUMBER must be a positive whole number.');
if (releaseNumber && !/^\d+\.\d+\.\d+$/.test(packageVersion)) throw new Error('package.json version must be major.minor.patch to number releases.');
const appVersion = releaseNumber ? packageVersion.replace(/\d+$/, releaseNumber) : packageVersion;
const buildId = new Date().toISOString();

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion), 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId) },
  plugins: [react(), releasePlugin(appVersion, buildId)],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.runtime/**', '**/.accounts-data/**', '**/.browser-data/**', '**/.browser-host/**', '**/services/browser/.data/**'] },
    proxy: {
      '/api/accounts': { target: 'http://127.0.0.1:4176' },
      '/api/browser': {
        target: 'http://127.0.0.1:4175', ws: true,
        configure(proxy) {
          const authorize = (request: import('node:http').ClientRequest) => {
            try { request.setHeader('Authorization', `Bearer ${readFileSync('.runtime/browser-token', 'utf8').trim()}`); } catch { /* worker starts independently */ }
          };
          proxy.on('proxyReq', authorize); proxy.on('proxyReqWs', authorize);
        },
      },
      '/api': {
        target: 'http://127.0.0.1:4174', ws: true,
        configure(proxy) {
          proxy.on('proxyReq', (request) => {
            try { if (process.env.LOPE_PUBLIC_VISITORS !== '1') request.setHeader('Authorization', `Bearer ${readFileSync('.runtime/token', 'utf8').trim()}`); } catch { /* service starts independently */ }
          });
          proxy.on('proxyReqWs', (request) => { try { if (process.env.LOPE_PUBLIC_VISITORS !== '1') request.setHeader('Authorization', `Bearer ${readFileSync('.runtime/token', 'utf8').trim()}`); } catch {} });
        },
      },
    },
  },
});
