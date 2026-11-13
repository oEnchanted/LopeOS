/** Test-only deployment server. Mutates releases on disk-free isolated browser origins. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm' };
function release(build, files) {
  const assets = [...files].map(([url, bytes]) => ({ url, size: bytes.length, sha256: hash(bytes) }));
  return { files, manifest: { format: 1, version: '0.1.0', build, releasedAt: build, totalBytes: assets.reduce((sum, item) => sum + item.size, 0), assets } };
}
function fixture(label, build) {
  return release(build, new Map([
    ['/index.html', Buffer.from(`<!doctype html><html><head><title>Release ${label}</title></head><body><h1 id="release">Release ${label}</h1><script src="/assets/fixture.js"></script></body></html>`)],
    ['/assets/fixture.js', Buffer.from(`window.fixtureRelease = '${label}';`)],
    ['/assets/lazy.txt', Buffer.from(`Lazy asset from ${label}`)],
  ]));
}
const fixtures = { a: fixture('A', '2026-11-13T00:00:00.000Z'), b: fixture('B', '2026-11-14T00:00:00.000Z') };
let production;
async function productionReleases() {
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/__lope/version.json'), 'utf8'));
  if (!manifest.assets?.length) throw new Error('Run npm run build before software update browser tests.');
  const files = new Map(await Promise.all(manifest.assets.map(async item => [item.url, await readFile(resolve(root, 'dist', item.url.replace(/^\//, '')))])));
  const build = new Date(Date.parse(manifest.build) + 60_000).toISOString();
  const next = new Map([...files].map(([url, bytes]) => {
    if (/\.(?:js|mjs|json|html)$/.test(url)) {
      const text = bytes.toString();
      if (text.includes(manifest.build)) return [url, Buffer.from(text.replaceAll(manifest.build, build))];
    }
    return [url, bytes];
  }));
  next.set('/assets/update-test.bin', Buffer.alloc(512 * 1024, 71));
  const b = release(build, next); b.manifest.version = manifest.version;
  return { a: { files, manifest }, b };
}
let state = { mode: 'fixture', release: 'a', corrupt: false, delay: 0 };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/__test__/configure' && request.method === 'POST') {
      let input = ''; for await (const chunk of request) input += chunk;
      const settings = JSON.parse(input || '{}');
      if (settings.mode === 'production' && !production) production = await productionReleases();
      state = { ...state, ...settings };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ...state, build: (state.mode === 'production' ? production : fixtures)[state.release].manifest.build })); return;
    }
    if (pathname === '/__test__/health') { response.end('ready'); return; }
    if (pathname === '/lope-sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.setHeader('Service-Worker-Allowed', '/');
      response.end(await readFile(resolve(root, 'public/lope-sw.js'))); return;
    }
    const selected = (state.mode === 'production' ? production : fixtures)[state.release];
    if (pathname === '/__lope/version.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(selected.manifest)); return; }
    if (pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/identity') { response.end(JSON.stringify({ userId: 'update-test', workspaceId: 'update-tests' })); return; }
      response.writeHead(503); response.end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Test service is offline.' } })); return;
    }
    const asset = pathname === '/' ? '/index.html' : pathname;
    let bytes = selected.files.get(asset);
    if (!bytes) { response.writeHead(404); response.end('Not found'); return; }
    if (asset === '/assets/lazy.txt' || asset === '/assets/update-test.bin') {
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.corrupt) bytes = Buffer.alloc(bytes.length, 88);
    }
    response.setHeader('Content-Type', mime[extname(asset)] || 'application/octet-stream');
    response.setHeader('Content-Length', bytes.length);
    response.end(bytes);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
server.listen(4186, '127.0.0.1', () => console.log('Software update test server listening on http://127.0.0.1:4186'));
