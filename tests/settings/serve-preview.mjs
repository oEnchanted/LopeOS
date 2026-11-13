/** Immutable production build snapshot for QA while other owners keep editing. */
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const assets = new Map();
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(resolve(directory, entry.name), key);
    else assets.set(key, await readFile(resolve(directory, entry.name)));
  }
}
await collect(resolve(process.env.LOPE_QA_BUILD_DIR || 'dist'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1:4182').pathname;
  const key = pathname === '/' ? '/index.html' : pathname;
  const asset = assets.get(key);
  if (!asset) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(key)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(asset);
});
server.listen(4182, '127.0.0.1', () => console.log('QA production snapshot: http://127.0.0.1:4182'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
