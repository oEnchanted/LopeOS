import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { publicAddress, publicDestination } from '../src/network.mjs';
import { createBrowserServer } from '../src/server.mjs';
import { createRuntimeFileBridge } from '../src/files.mjs';
import { destination, displayAddress, openedFile, openedFileUrl, openableFileType, safeHostUrl } from '../../../packages/browser-client/src/navigation.ts';

test('worker seccomp permits the Chromium namespace jail with no outer capabilities and keeps host restrictions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-seccomp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'seccomp.json');
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../hosting/linux/make-seccomp.mjs', import.meta.url)),
    fileURLToPath(new URL('../hosting/linux/docker-default-seccomp.json', import.meta.url)),
    output,
  ]);
  const profile = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO');
  const unrestricted = profile.syscalls.filter(rule => rule.action === 'SCMP_ACT_ALLOW' && !rule.includes && !rule.excludes && !rule.args);
  for (const syscall of ['clone', 'setns', 'unshare', 'chroot']) {
    assert.ok(unrestricted.some(rule => rule.names.includes(syscall)), `${syscall} must work after the worker drops all outer capabilities`);
  }
  for (const syscall of ['mount', 'bpf', 'keyctl', 'perf_event_open']) {
    assert.ok(!unrestricted.some(rule => rule.names.includes(syscall)), `${syscall} must retain Docker's host restrictions`);
  }
  assert.ok(profile.syscalls.some(rule => rule.names.includes('clone3') && rule.action === 'SCMP_ACT_ERRNO' && rule.errnoRet === 38));
});

test('URL parsing rejects executable/file schemes and credentials, and encodes searches', () => {
  assert.equal(destination('example.com/path?q=a'), 'https://example.com/path?q=a');
  assert.equal(destination('hello & world'), 'https://duckduckgo.com/?q=hello%20%26%20world');
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:password@example.com']) assert.throws(() => destination(value));
  assert.equal(displayAddress('https://example.com/'), 'example.com');
  assert.match(displayAddress('https://xn--pple-43d.com'), /xn--/);
});

test('opened HTML files have reserved per-file addresses that never count as websites', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e', url = openedFileUrl(id, 'Report #1 100%.html');
  assert.equal(new URL(url).hostname, `${id}.file.lope.invalid`);
  assert.deepEqual(openedFile(url), { id, name: 'Report #1 100%.html' });
  assert.deepEqual(openedFile(url + '?view=1#top'), { id, name: 'Report #1 100%.html' });
  assert.equal(displayAddress(url), 'Report #1 100%.html');
  assert.equal(safeHostUrl(url), null); // Not bookmarked, kept in history, restored, or sent to the host browser.
  assert.equal(destination(url), url);
  for (const value of [`http://${id}.file.lope.invalid/a.html`, 'https://file.lope.invalid/a.html', 'https://not-an-id.file.lope.invalid/a.html',
    `https://${id}.file.lope.invalid.example.com/a.html`, 'https://example.com/a.html']) assert.equal(openedFile(value), null, value);
  assert.equal(openableFileType('Page.HTM'), 'text/html'); assert.equal(openableFileType('a.xhtml'), 'application/xhtml+xml');
  for (const name of ['notes.txt', 'html', 'page.html.exe', 'folder.html/']) assert.equal(openableFileType(name), null, name);
});

test('egress rejects private, mapped IPv6, multicast, metadata, mixed DNS and non-web ports', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.17.0.1', '192.168.0.1', '100.100.100.200', '0.0.0.0', '224.0.0.1', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(publicDestination('rebind.example', 443, { resolve }));
  await assert.rejects(publicDestination('example.com', 22, { resolve: async () => [{ address: '8.8.8.8', family: 4 }] }));
  assert.deepEqual(await publicDestination('example.com', 443, { resolve: async () => [{ address: '8.8.8.8', family: 4 }] }), { address: '8.8.8.8', family: 4, port: 443 });
});

test('worker rejects missing/wrong credentials, hostile origins, cross-session files and malformed commands', async t => {
  const engine = Object.assign(new EventEmitter(), {
    normal: { status: 'ready' }, version: 'test', get: id => { if (id !== 'normal') throw new Error('Browser session not found.'); },
    snapshot: () => ({ id: 'normal', tabs: [] }), downloads: new Map(),
  });
  const token = 'a'.repeat(64);
  const server = createBrowserServer(engine, { token, origins: ['http://lope.test'], hosts: ['127.0.0.1'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/browser`;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(base + '/health')).status, 401);
  assert.equal((await fetch(base + '/health', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(base + '/health', { headers: { ...headers, Origin: 'https://attacker.test' } })).status, 401);
  assert.equal((await fetch(base + '/health', { headers })).status, 200);
  assert.equal((await fetch(base + '/sessions/someone-else', { headers })).status, 400);
  assert.equal((await fetch(base + '/sessions/normal/downloads/another-session/file', { headers })).status, 400);
  assert.equal((await fetch(base + '/sessions/normal/commands', { method: 'POST', headers, body: 'null' })).status, 400);
  assert.equal((await fetch(base + '/sessions/normal/commands', { method: 'POST', headers, body: '{broken' })).status, 400);
});

test('runtime bridge sends only the selected binary file with owner credential and create-only writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-transfer-')); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'normal'); await mkdir(directory);
  const input = join(directory, 'download'); await writeFile(input, Buffer.from([0, 1, 255, 7]));
  const calls = [];
  const bridge = createRuntimeFileBridge({ url: 'http://runtime.test/', getToken: async () => 'owner-token', stagingRoot: root, validateSession: id => assert.equal(id, 'normal'), request: async (url, options) => {
    calls.push({ url: String(url), options }); return Response.json(options.method ? {} : { data: Buffer.from('selected').toString('base64') });
  } });
  const result = await bridge.importDownload({ sessionId: 'normal', transferId: '12345678-long-id', name: 'chosen.bin', path: input, signal: new AbortController().signal });
  assert.equal(result.fileId, '/Downloads/chosen.bin');
  assert.deepEqual(JSON.parse(calls[1].options.body), { path: result.fileId, data: 'AAH/Bw==', createOnly: true });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer owner-token'); assert.equal(calls[0].options.redirect, 'error');
  const selected = await bridge.materializeUpload({ sessionId: 'normal', fileId: '/Documents/selected.txt', destination: directory });
  assert.equal(await readFile(selected.path, 'utf8'), 'selected');
  assert.equal(calls.length, 3); assert.match(calls[2].url, /path=%2FDocuments%2Fselected.txt/);
});

test('stream proxy authenticates upgrades and strips LopeOS cookies and credentials upstream', async t => {
  const seen = []; const sockets = new Set();
  const upstream = createServer((req,res) => { seen.push(req.headers); res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': 'remote=unsafe' }); res.end('trusted stream client'); });
  upstream.on('upgrade', (req,socket) => {
    seen.push(req.headers); sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); socket.on('error',()=>{});
    const accept = createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data',data=>socket.write(data));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const worker = createBrowserServer({ normal:{status:'ready'} }, {token:'t'.repeat(64),origins:['http://lope.test'],selkies:{url:`http://127.0.0.1:${upstream.address().port}`,user:'lope',password:'stream-secret'}});
  worker.listen(0,'127.0.0.1');await once(worker,'listening');
  t.after(()=>{for(const socket of sockets)socket.destroy();upstream.closeAllConnections();upstream.close();worker.closeAllConnections();worker.close();});
  const origin=`http://127.0.0.1:${worker.address().port}`;
  const headers={Authorization:`Bearer ${'t'.repeat(64)}`,Origin:'http://lope.test',Cookie:'lope-auth=private'};
  const response=await fetch(origin+'/api/browser/stream/selkies/',{headers});assert.equal(await response.text(),'trusted stream client');assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(seen[0].cookie,undefined);assert.equal(seen[0].authorization,`Basic ${Buffer.from('lope:stream-secret').toString('base64')}`);
  assert.equal((await fetch(origin+'/api/browser/stream/api/tokens',{headers,method:'POST'})).status,403);
  assert.equal((await fetch(origin+'/api/browser/stream/%61pi/tokens',{headers,method:'POST'})).status,403);
  const result=await new Promise((resolve,reject)=>{
    const req=httpRequest(origin+'/api/browser/stream/websockets',{headers:{...headers,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='} });
    req.on('error',reject);req.on('upgrade',(res,socket)=>{socket.on('error',reject);socket.once('data',data=>{socket.destroy();resolve(data.toString());});socket.write('echo');});req.end();
  });assert.equal(result,'echo');assert.equal(seen[1].cookie,undefined);assert.equal(seen[1].origin,'http://lope.test');
});

test('address suggestions put the typed action first, rank host matches and prefer switching to open tabs', async () => {
  const { addressSuggestions } = await import('../../../packages/browser-client/src/suggestions.ts');
  const tab = (id, url, title) => ({ id, url, title, pinned: false, loading: false, canGoBack: false, canGoForward: false, zoom: 1 });
  const sources = {
    activeTabId: 'a', tabs: [tab('a', 'https://news.example/', 'News'), tab('b', 'https://wiki.example.org/Lope', 'Lope article')],
    bookmarks: [{ id: 'm', url: 'https://wiki.example.org/Lope', title: 'Lope article', createdAt: 0 }],
    history: [{ id: '1', url: 'https://docs.example/wiki-guide', title: 'Writing guide', visitedAt: 2 },
      { id: '2', url: 'https://wiki.example.org/Lope', title: 'Lope article', visitedAt: 1 }],
  };
  const rows = addressSuggestions('wiki', sources);
  assert.deepEqual(rows[0], { kind: 'search', title: 'wiki', url: 'https://duckduckgo.com/?q=wiki' });
  assert.deepEqual(rows.slice(1).map(row => [row.kind, row.url]), [['tab', 'https://wiki.example.org/Lope'], ['history', 'https://docs.example/wiki-guide']]);
  assert.equal(rows[1].tabId, 'b');
  assert.equal(addressSuggestions('example.org', sources)[0].kind, 'url');
  assert.equal(addressSuggestions('news', sources).some(row => row.tabId === 'a'), false); // Never the current tab.
  assert.deepEqual(addressSuggestions('javascript:alert(1)', sources), []);
  assert.deepEqual(addressSuggestions('  ', sources), []);
});

test('GPU detection parser and worker allocation arguments configure OpenGL', async () => {
  const { parseGpuReport, gpuOptions } = await import('../hosting/docker.mjs');
  const { gpuArguments } = await import('../src/cdp.mjs');

  assert.deepEqual(parseGpuReport('KIND=wsl\n'), { kind: 'wsl' });
  const wslOptions = gpuOptions({ kind: 'wsl' });
  assert.ok(wslOptions.args.includes('/dev/dxg'));
  assert.ok(wslOptions.env.includes('LOPE_BROWSER_GPU=wsl'));
  assert.ok(wslOptions.env.includes('GALLIUM_DRIVER=d3d12'));

  assert.deepEqual(parseGpuReport('KIND=dri\nNODE=/dev/dri/renderD128\nGID=108\nDRIVER=i915\n'), {
    kind: 'dri', node: '/dev/dri/renderD128', gid: '108', driver: 'i915',
  });
  const driOptions = gpuOptions({ kind: 'dri', node: '/dev/dri/renderD128', gid: '108', driver: 'i915' });
  assert.ok(driOptions.args.includes('/dev/dri/renderD128'));
  assert.ok(driOptions.args.includes('108'));
  assert.ok(driOptions.env.includes('LOPE_BROWSER_GPU=dri'));

  const nvidiaOptions = gpuOptions({ kind: 'dri', node: '/dev/dri/renderD128', gid: '108', driver: 'nvidia' });
  assert.ok(nvidiaOptions.args.includes('--gpus'));
  assert.ok(nvidiaOptions.env.includes('NVIDIA_DRIVER_CAPABILITIES=all'));

  assert.deepEqual(parseGpuReport('KIND=none\nREASON=No GPU render node on this host\n'), {
    kind: 'none', reason: 'No GPU render node on this host',
  });
  assert.deepEqual(parseGpuReport('invalid-format'), { kind: 'none', reason: 'No usable GPU was found' });
  assert.deepEqual(gpuOptions({ kind: 'none' }), { args: [], env: [] });

  assert.deepEqual(gpuArguments(undefined), ['--enable-unsafe-swiftshader', '--disable-smooth-scrolling']);
  assert.deepEqual(gpuArguments('none'), ['--enable-unsafe-swiftshader', '--disable-smooth-scrolling']);
  assert.deepEqual(gpuArguments('wsl'), ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas']);
  const driArgs = gpuArguments('dri');
  assert.ok(driArgs.includes('--ignore-gpu-blocklist'));
  assert.ok(driArgs.includes('--enable-gpu-rasterization'));
  assert.ok(driArgs.some(arg => arg.includes('AcceleratedVideoDecodeLinuxGL')));
});

test('the host install manifest ships every runtime file the gateway, image and worker load', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'services/browser/hosting/windows/runtime-files.json'), 'utf8'));
  const { stdout } = await promisify(execFile)('git', ['ls-files', 'packages/browser-client/src', 'services/browser/src', 'services/browser/infra', 'services/browser/hosting/linux', 'services/browser/hosting/*.mjs'], { cwd: root });
  const required = stdout.split('\n').filter(Boolean);
  assert.ok(required.length > 20);
  // The deploy job downloads only listed files, so a missing entry breaks the image build or the worker.
  assert.deepEqual(required.filter(file => !manifest.includes(file)), []);
  for (const file of manifest) await readFile(join(root, file));
});

test('the streaming smoke test opens its fixture with the browser the image installs', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dockerfile = await readFile(join(root, 'services/browser/infra/Dockerfile'), 'utf8');
  const smoke = await readFile(join(root, 'services/browser/hosting/windows/smoke-stream.mjs'), 'utf8');
  const executable = dockerfile.match(/CHROMIUM_EXECUTABLE=(\S+)/)?.[1];
  assert.equal(executable, '/usr/local/bin/lope-chrome');
  // On x86-64 the image ships Google Chrome only; Debian's /usr/bin/chromium is absent.
  assert.match(smoke, new RegExp(`exec ${executable} --user-data-dir=`));
  assert.doesNotMatch(smoke, /\/usr\/bin\/chromium/);
});
