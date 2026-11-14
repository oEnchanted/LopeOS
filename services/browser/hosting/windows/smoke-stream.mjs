/**
 * Disposable, loopback-only media/input smoke gate. Run on the Windows WSL owner
 * with Node 24+, the reviewed image installed, and Playwright Chromium available.
 * No Caddy/account APIs are used. It does not establish audio/IME/cross-browser
 * acceptance; those remain in tests/streaming.acceptance.md.
 *
 * LOPE_BROWSER_WSL_DISTRO=Ubuntu-24.04
 * LOPE_BROWSER_SMOKE_PLAYWRIGHT=<absolute path to playwright/index.mjs> (optional)
 * LOPE_BROWSER_SMOKE_CHROMIUM=<Chromium executable> (optional)
 * PLAYWRIGHT_BROWSERS_PATH=<private temporary browser installation> (optional)
 */
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DockerBrowserAllocator } from '../docker.mjs';

const result = { kind: 'lope-browser-stream-smoke', passed: false, stage: 'configuration', node: process.versions.node,
  checks: { worker: false, mediaFrames: false, movingPixels: false, remotePointerAndKeyboard: false, contextMenuSave: false, largeUpload: false }, cleanup: false };
const distro = process.env.LOPE_BROWSER_WSL_DISTRO || 'Ubuntu-24.04';
let temporary, allocator, worker, server, browser, debugPage;
// Optional: a directory for failure screenshots and a redacted error, for operators only.
const debugDirectory = process.env.LOPE_BROWSER_SMOKE_DEBUG_DIR;
const sockets = new Set();
const id = randomUUID(), ownerKey = randomBytes(32).toString('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(250); }
  throw new Error('Smoke deadline exceeded.');
}
async function playwright() {
  const entry = process.env.LOPE_BROWSER_SMOKE_PLAYWRIGHT;
  if (entry) { if (!isAbsolute(entry)) throw new Error('Use an absolute Playwright package entry path.'); return import(pathToFileURL(entry).href); }
  try { return await import('playwright'); } catch { return import('@playwright/test'); }
}
function forward(request, response, head) {
  if (!worker || !request.url?.startsWith('/api/browser/')) { head ? response.destroy() : response.writeHead(404).end(); return; }
  const target = new URL(worker.url);
  const headers = { host: target.host, authorization: `Bearer ${worker.token}` };
  for (const key of ['origin', 'content-type', 'content-length', 'accept', 'range', 'upgrade', 'connection',
    'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    if (request.headers[key]) headers[key] = request.headers[key];
  }
  const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: request.url, method: request.method, headers });
  upstream.on('error', () => { if (head || response.headersSent) response.destroy(); else response.writeHead(502).end(); });
  if (head) {
    upstream.on('upgrade', (reply, socket, upstreamHead) => {
      const headers = Object.entries(reply.headers).filter(([name]) => ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions'].includes(name));
      response.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) response.write(upstreamHead); if (head.length) socket.write(head);
      socket.pipe(response).pipe(socket);
      socket.on('error', () => response.destroy()); response.on('error', () => socket.destroy());
      response.on('close', () => socket.destroy());
    });
    upstream.on('response', () => response.destroy()); upstream.end();
  } else {
    upstream.on('response', reply => {
      const headers = { ...reply.headers, 'cache-control': 'no-store' };
      delete headers['set-cookie']; delete headers['www-authenticate'];
      response.writeHead(reply.statusCode, headers); reply.pipe(response);
    });
    request.pipe(upstream); response.on('close', () => upstream.destroy());
  }
}
async function api(path, method = 'GET', body) {
  const response = await fetch(worker.url + '/api/browser/' + path, {
    method, headers: { authorization: `Bearer ${worker.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Worker smoke operation failed.');
  return response.json();
}
async function removeDisposableProfile() {
  // Only the random profile created by this invocation may be removed. No recursive
  // deletion: validate its loop backing file, unmount it, then remove known files.
  await allocator.host('bash', ['-c', `set -euo pipefail
[[ $1 =~ ^[a-f0-9]{64}$ ]] || exit 1
exec 9>/var/lib/lope-browser/profile.lock; flock 9
profile=/var/lib/lope-browser/profiles/$1
[[ -d $profile ]] || exit 0
[[ ! -L $profile && ! -L $profile/home && ! -L $profile/profile.ext4 ]] || exit 1
active=$(docker ps -q --filter "label=lope.browser.owner=$1")
[[ -z $active ]] || exit 1
if mountpoint -q "$profile/home"; then
  device=$(findmnt -n -o SOURCE --target "$profile/home")
  [[ $device = /dev/loop* && $(losetup -n -O BACK-FILE "$device") = "$profile/profile.ext4" ]] || exit 1
  umount "$profile/home"
fi
rm -f "$profile/profile.ext4" "$profile/last-used"
rmdir "$profile/home" "$profile"
`, 'lope-browser-smoke-cleanup', ownerKey]);
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required.');
  if (!/^[A-Za-z0-9_.-]+$/.test(distro)) throw new Error('Invalid WSL distribution.');
  const { chromium } = await playwright();
  temporary = await mkdtemp(join(tmpdir(), 'lope-browser-smoke-'));
  allocator = new DockerBrowserAllocator({ directory: temporary, distro: process.platform === 'win32' ? distro : undefined,
    image: process.env.LOPE_BROWSER_IMAGE || 'lope-browser:local', deploymentId: 'lopeos-smoke' });
  result.stage = 'host-policy';
  await allocator.verify();
  server = createServer((request, response) => {
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`<!doctype html><html><head><title>Lope streaming smoke host</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style></head><body>
<iframe id="stream" src="/api/browser/stream/${id}/" allow="autoplay"></iframe><script>
window.smokeStats=null; const frame=document.getElementById('stream');
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='stats')window.smokeStats=event.data.data;});
frame.onload=()=>{frame.contentWindow.postMessage({type:'resetResolutionToWindow'},location.origin);frame.contentWindow.postMessage({type:'setMute',value:true},location.origin);frame.contentWindow.postMessage({type:'statsOpen',open:true},location.origin);};
setInterval(()=>frame.contentWindow.postMessage({type:'getStats'},location.origin),250);
</script></body></html>`);
    } else forward(request, response);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => forward(request, socket, head));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  result.stage = 'isolated-worker';
  const startedAt = Date.now();
  worker = await allocator.create({ id, ownerKey, origin });
  result.startMs = Date.now() - startedAt;
  result.checks.worker = true;
  const health = await api('health'); result.engine = health.engine;
  await api('sessions', 'POST', { mode: 'normal' });
  // A data URL exercises the existing Chromium process without opening host egress
  // or granting a private-network test exception. It contains no account content.
  const fixture = `<!doctype html><html><head><title>Lope streaming smoke</title><style>html,body{margin:0;overflow:hidden}canvas{position:fixed;inset:0;width:100vw;height:100vh}input,button{position:fixed;top:40px;height:64px;box-sizing:border-box;font:24px sans-serif}input{left:40px;width:400px}button{left:480px;width:180px}</style></head><body><canvas id="motion"></canvas><input id="text" aria-label="Smoke input"><button id="send">Submit</button><input type="file" id="upload" aria-label="Smoke upload" style="position:fixed;left:40px;top:360px;width:300px;height:60px"><img id="pic" alt="Smoke image" style="position:fixed;left:40px;top:160px;width:240px;height:160px" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27160%27%3E%3Crect width=%27240%27 height=%27160%27 fill=%27%23336%27/%3E%3C/svg%3E"><script>const c=document.getElementById('motion'),x=c.getContext('2d');function draw(t){c.width=innerWidth;c.height=innerHeight;x.fillStyle='hsl('+((t/13)%360)+',85%,50%)';x.fillRect(0,0,c.width,c.height);requestAnimationFrame(draw)}requestAnimationFrame(draw);document.getElementById('upload').onchange=e=>{const f=e.target.files[0];document.title='Lope smoke file '+(f?f.size:0)};document.getElementById('send').onclick=()=>document.title='Lope smoke submitted '+document.getElementById('text').value;</script></body></html>`;
  const fixtureUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fixture);
  await allocator.docker(['exec', worker.name, 'bash', '-c',
    'source "${XDG_RUNTIME_DIR:-/tmp/runtime-ubuntu}/container-env"; exec /usr/local/bin/lope-chrome --user-data-dir=/profiles/normal/chromium --kiosk --new-window "$1"',
    'lope-browser-smoke-fixture', fixtureUrl], { timeout: 20000 });
  const tab = await until(async () => (await api('sessions/normal')).tabs.find(tab => tab.title === 'Lope streaming smoke'));
  await api('sessions/normal/commands', 'POST', { type: 'tab.activate', tabId: tab.id });
  result.stage = 'stream-client';
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.LOPE_BROWSER_SMOKE_CHROMIUM ? { executablePath: process.env.LOPE_BROWSER_SMOKE_CHROMIUM } : {}) });
  result.client = browser.version();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  debugPage = page;
  let binaryFrames = 0;
  page.on('websocket', socket => socket.on('framereceived', frame => { if (typeof frame.payload !== 'string') binaryFrames++; }));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => Number(window.smokeStats?.clientFps) > 0 && window.smokeStats?.isVideoPipelineActive === true, null, { timeout: 45000 });
  result.checks.mediaFrames = true;
  result.clientFps = await page.evaluate(() => Number(window.smokeStats.clientFps));
  const frame = page.frames().find(frame => frame.url().startsWith(origin + '/api/browser/stream/'));
  if (!frame) throw new Error('Stream frame was not created.');
  const geometry = await frame.evaluate(() => {
    const canvas = document.getElementById('videoCanvas');
    // Selkies can move presentation to a video element or OffscreenCanvas sink.
    const sink = ['videoWorkerCanvas', 'videoStream', 'videoCanvas'].map(id => document.getElementById(id)).find(element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    });
    if (!canvas || !sink) return { width: 0, height: 0 };
    const rect = sink.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, remoteWidth: canvas.width, remoteHeight: canvas.height };
  });
  if (geometry.width < 640 || geometry.height < 400 || geometry.remoteWidth < 640 || geometry.remoteHeight < 400) throw new Error('Stream viewport is too small.');
  const clip = { x: Math.round(geometry.x + geometry.width * .6), y: Math.round(geometry.y + geometry.height * .6), width: 100, height: 100 };
  const first = createHash('sha256').update(await page.screenshot({ clip })).digest('hex');
  await delay(750);
  const second = createHash('sha256').update(await page.screenshot({ clip })).digest('hex');
  if (first === second) throw new Error('Stream pixels did not change while the remote fixture animated.');
  result.checks.movingPixels = true;
  // The player's own numbers (frame rate, latency, codec, size) while the fixture animates. Numbers and short labels only.
  await delay(3000);
  result.stats = await page.evaluate(() => Object.fromEntries(Object.entries(window.smokeStats ?? {})
    .filter(([, value]) => typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 40)).slice(0, 60)));
  if (debugDirectory) await page.screenshot({ path: join(debugDirectory, 'before-input.png') }).catch(() => {});
  result.stage = 'remote-input';
  const remotePoint = (x, y) => ({ x: geometry.x + x * geometry.width / geometry.remoteWidth, y: geometry.y + y * geometry.height / geometry.remoteHeight });
  const inputPoint = remotePoint(160, 72), buttonPoint = remotePoint(560, 72);
  // Move first and let the stream deliver the pointer position before pressing, as a
  // person's pointer does; Selkies sends motion at frame rate but buttons immediately.
  const click = async point => { await page.mouse.move(point.x, point.y, { steps: 5 }); await delay(400); await page.mouse.down(); await delay(80); await page.mouse.up(); };
  await click(inputPoint);
  await page.keyboard.type('smoke42', { delay: 65 });
  await delay(400);
  await click(buttonPoint);
  await until(async () => (await api('sessions/normal')).tabs.some(tab => tab.title === 'Lope smoke submitted smoke42'));
  result.checks.remotePointerAndKeyboard = true;
  result.stage = 'context-menu';
  // Kiosk Chromium has no native context menu; the worker reports right-clicks for LopeOS's own menu.
  const picture = remotePoint(160, 240);
  await page.mouse.move(picture.x, picture.y, { steps: 5 }); await delay(400);
  await page.mouse.down({ button: 'right' }); await delay(80); await page.mouse.up({ button: 'right' });
  const menu = await until(async () => (await api('sessions/normal')).contextMenu, 15000);
  if (!menu.image?.startsWith('data:image/svg+xml')) throw new Error('The context menu did not identify the image.');
  await api('sessions/normal/commands', 'POST', { type: 'context.saveImage', menuId: menu.id });
  await until(async () => (await api('sessions/normal')).downloads.some(item => item.state === 'completed' && item.totalBytes > 0), 15000);
  result.checks.contextMenuSave = true;
  result.stage = 'large-upload';
  // Above the former 32 MB cap: the file streams to the worker's disk, then the page receives it.
  const chooserPoint = remotePoint(190, 390);
  await page.mouse.move(chooserPoint.x, chooserPoint.y, { steps: 5 }); await delay(400);
  await page.mouse.down(); await delay(80); await page.mouse.up();
  const chooser = await until(async () => (await api('sessions/normal')).uploads[0], 15000);
  const uploadBytes = 40 * 1024 * 1024;
  const staged = await fetch(`${worker.url}/api/browser/sessions/normal/uploads/${chooser.id}/files`, { method: 'POST',
    headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'application/octet-stream', 'x-file-name': 'smoke-upload.bin' },
    body: new Uint8Array(uploadBytes), signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!staged.ok) throw new Error('The staged upload failed.');
  const { id: stagedId } = await staged.json();
  await api(`sessions/normal/uploads/${chooser.id}`, 'POST', { staged: [stagedId] });
  await until(async () => (await api('sessions/normal')).tabs.some(tab => tab.title === `Lope smoke file ${uploadBytes}`), 20000);
  result.checks.largeUpload = true;
  result.binaryFramesObserved = binaryFrames;
  result.passed = true; result.stage = 'complete';
} catch (error) {
  // Error strings can contain command arguments, credentials, URLs or page content.
  // Report only the fixed stage and booleans; use a separate reviewed host check.
  result.passed = false;
  // A worker that never started: its redacted output is the only way to see why.
  if (typeof error?.workerLog === 'string') result.workerLog = error.workerLog;
  if (error?.code) result.error = String(error.code).slice(0, 40);
  result.gpu = allocator?.gpu?.kind ?? null;
  if (debugDirectory) {
    const redact = value => String(value).replace(/[a-f0-9]{32,}/gi, '[hex]').replace(/(token|password|authorization|bearer)\S*/gi, '$1 [redacted]').slice(0, 600);
    console.log('debug error:', redact(error?.message ?? error));
    try { console.log('debug tabs:', JSON.stringify((await api('sessions/normal')).tabs.map(tab => tab.title))); } catch {}
    await debugPage?.screenshot({ path: join(debugDirectory, 'failure.png') }).catch(() => {});
  }
} finally {
  await browser?.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
  let stopped = !worker;
  if (worker) { try { await allocator.destroy(worker); stopped = true; } catch {} }
  if (allocator && stopped) {
    try { await removeDisposableProfile(); result.cleanup = true; } catch { result.cleanup = false; }
  }
  if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
  if (!result.cleanup) result.passed = false;
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
