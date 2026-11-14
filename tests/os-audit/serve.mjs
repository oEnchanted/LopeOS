/**
 * OS AUDIT ONLY: serve an immutable build snapshot on loopback, optionally with the
 * proposed production security headers, so header/CSP changes are measured in a
 * real browser before they reach the Caddy template.
 *
 *   LOPE_AUDIT_BUILD=<dir> LOPE_AUDIT_PORT=4190 LOPE_AUDIT_HEADERS=1 node tests/os-audit/serve.mjs
 */
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { productionHeaders } from './security-headers.mjs';

const root = resolve(process.env.LOPE_AUDIT_BUILD || 'tests/os-audit/build');
const port = Number(process.env.LOPE_AUDIT_PORT || 4190);
const withHeaders = process.env.LOPE_AUDIT_HEADERS === '1';
const assets = new Map();
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(resolve(directory, entry.name), key);
    else assets.set(key, await readFile(resolve(directory, entry.name)));
  }
}
await collect(root);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const reports = [];
let fault = null;
const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/__audit/csp-report' && request.method === 'POST') {
    let body = ''; request.on('data', chunk => { if (body.length < 65536) body += chunk; });
    request.on('end', () => { reports.push(body); response.writeHead(204); response.end(); });
    return;
  }
  if (url.pathname === '/__audit/csp-reports') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(reports)); return; }
  // Real network-level fault injection (no browser interception): POST /__audit/fault?match=<regex>, DELETE clears.
  if (url.pathname === '/__audit/fault') {
    fault = request.method === 'DELETE' ? null : new RegExp(url.searchParams.get('match') || '^$');
    response.writeHead(204, { 'Cache-Control': 'no-store' }); response.end(); return;
  }
  if (fault?.test(url.pathname)) { response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end('Service unavailable (audit fault)'); return; }
  const key = url.pathname === '/' ? '/index.html' : url.pathname;
  const asset = assets.get(key) ?? (extname(key) ? undefined : assets.get('/index.html'));
  const headers = { 'Content-Type': types[extname(asset === assets.get('/index.html') ? '/index.html' : key)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(withHeaders ? productionHeaders({ reportUri: '/__audit/csp-report' }) : {}) };
  if (!asset) { response.writeHead(404, headers); response.end('Not found'); return; }
  response.writeHead(200, headers); response.end(asset);
});
server.listen(port, '127.0.0.1', () => console.log(`OS audit snapshot ${root} on http://127.0.0.1:${port} headers=${withHeaders}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
