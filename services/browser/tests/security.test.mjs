import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicAddress, publicDestination } from '../src/network.mjs';
import { createBrowserServer } from '../src/server.mjs';
import { createRuntimeFileBridge } from '../src/files.mjs';
import { destination, displayAddress } from '../../../packages/browser-client/src/navigation.ts';

test('URL parsing rejects executable/file schemes and credentials, and encodes searches', () => {
  assert.equal(destination('example.com/path?q=a'), 'https://example.com/path?q=a');
  assert.equal(destination('hello & world'), 'https://duckduckgo.com/?q=hello%20%26%20world');
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:password@example.com']) assert.throws(() => destination(value));
  assert.equal(displayAddress('https://example.com/'), 'example.com');
  assert.match(displayAddress('https://xn--pple-43d.com'), /xn--/);
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
