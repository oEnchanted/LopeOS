import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const PREFIX = '/api/browser';
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body));
}
async function body(request, limit = 64 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error('Request is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const parse = bytes => { try { return JSON.parse(bytes.toString()); } catch { throw new Error('Invalid JSON request.'); } };

/** This worker belongs to exactly one authenticated owner. An external gateway assigns it. */
export function createBrowserServer(engine, options) {
  if (!options.token || options.token.length < 32) throw new Error('A strong, session-specific worker token is required.');
  const expected = Buffer.from(`Bearer ${options.token}`);
  const streams = new Map();
  const privateCleanup = new Map();
  let lastActivity = Date.now();
  function authorized(request) {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const origin = request.headers.origin;
    const validOrigin = !origin || options.origins.includes(origin);
    const validHost = !options.hosts || options.hosts.includes((request.headers.host ?? '').split(':')[0]);
    return validOrigin && validHost && expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }
  function proxy(request, response, upgradeHead) {
    if (!options.selkies) { if (upgradeHead) response.destroy(); else json(response, 503, { error: 'Streaming is not configured.' }); return; }
    const target = new URL(options.selkies.url);
    // Selkies is configured with exactly this subfolder. Only session routes pass through.
    const path = request.url;
    let decoded;
    try { decoded = decodeURIComponent(new URL(path, 'http://worker').pathname); }
    catch { if (upgradeHead) response.destroy(); else json(response, 400, { error: 'Invalid stream path.' }); return; }
    if (/\/(api\/tokens|api\/switch|metrics)(?:[/?]|$)/.test(decoded)) {
      if (upgradeHead) response.destroy(); else json(response, 403, { error: 'Administrative stream routes are private.' }); return;
    }
    const headers = { host: target.host, authorization: `Basic ${Buffer.from(`${options.selkies.user}:${options.selkies.password}`).toString('base64')}` };
    // A small allowlist prevents leaking LopeOS cookies, worker tokens and host headers.
    for (const key of ['content-type', 'content-length', 'accept', 'range', 'upgrade', 'connection',
      'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
      if (request.headers[key]) headers[key] = request.headers[key];
    }
    if (request.headers.origin) headers.origin = request.headers.origin;
    const upstream = httpRequest({ hostname: target.hostname, port: target.port || 80, path, method: request.method, headers });
    upstream.on('error', () => {
      if (upgradeHead) response.destroy(); else if (!response.headersSent) json(response, 502, { error: 'The streaming runtime is unavailable.' }); else response.destroy();
    });
    if (upgradeHead) {
      upstream.on('upgrade', (reply, socket, head) => {
        const safeHeaders = Object.entries(reply.headers).filter(([key]) => ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions'].includes(key));
        response.write(`HTTP/1.1 101 Switching Protocols\r\n${safeHeaders.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (head.length) response.write(head); if (upgradeHead.length) socket.write(upgradeHead);
        socket.pipe(response).pipe(socket);
        response.on('error', () => socket.destroy()); socket.on('error', () => response.destroy());
        response.on('close', () => socket.destroy());
      });
      upstream.on('response', () => response.destroy()); upstream.end();
    } else {
      upstream.on('response', reply => {
        const headers = { ...reply.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
        delete headers['set-cookie']; delete headers['www-authenticate'];
        response.writeHead(reply.statusCode, headers); reply.pipe(response);
      });
      request.pipe(upstream); response.on('close', () => upstream.destroy());
    }
  }
  const server = createServer(async (request, response) => {
    if (!authorized(request)) { json(response, 401, { error: 'Sign in to reconnect your browser.' }); return; }
    lastActivity = Date.now();
    try {
      const path = new URL(request.url, 'http://worker').pathname;
      if (path.startsWith(`${PREFIX}/stream/`)) { proxy(request, response); return; }
      if (path === `${PREFIX}/health` && request.method === 'GET') {
        json(response, 200, { status: engine.normal.status, engine: engine.version, streaming: !!engine.streamUrl }); return;
      }
      if (path === `${PREFIX}/sessions` && request.method === 'POST') {
        const input = parse(await body(request));
        if (!['normal', 'private'].includes(input.mode)) throw new Error('Unknown session mode.');
        const state = input.mode === 'private' ? await engine.createPrivate() : engine.snapshot('normal');
        if (input.mode === 'normal') await engine.activate(engine.normal, engine.normal.tabs.find(t => t.id === engine.normal.activeTabId));
        json(response, 200, state); return;
      }
      const match = path.match(/^\/api\/browser\/sessions\/([a-zA-Z\d-]+)(?:\/(.*))?$/);
      if (!match) { json(response, 404, { error: 'Browser endpoint not found.' }); return; }
      const [, sessionId, action = ''] = match;
      engine.get(sessionId);
      if (action === 'activity' && request.method === 'POST') { json(response, 200, { alive: true }); return; }
      if (!action && request.method === 'GET') { json(response, 200, engine.snapshot(sessionId)); return; }
      if (!action && request.method === 'DELETE') { await engine.destroy(sessionId); json(response, 200, { closed: true }); return; }
      if (action === 'commands' && request.method === 'POST') {
        const command = parse(await body(request));
        if (!command || typeof command.type !== 'string') throw new Error('Invalid browser command.');
        json(response, 200, await engine.command(sessionId, command)); return;
      }
      if (action === 'events' && request.method === 'GET') {
        const count = streams.get(sessionId) ?? 0;
        if (count >= 5) { json(response, 429, { error: 'Too many browser connections.' }); return; }
        streams.set(sessionId, count + 1);
        clearTimeout(privateCleanup.get(sessionId)); privateCleanup.delete(sessionId);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const send = snapshot => { if (snapshot.id === sessionId && !response.destroyed) {
          if (response.writableLength > 1024 * 1024) { response.destroy(); return; }
          response.write(`data: ${JSON.stringify(snapshot)}\n\n`); } };
        send(engine.snapshot(sessionId)); engine.on('state', send);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        response.on('close', () => {
          clearInterval(heartbeat); engine.off('state', send); const remaining = (streams.get(sessionId) ?? 1) - 1; streams.set(sessionId, remaining);
          if (!remaining && engine.sessions?.get(sessionId)?.mode === 'private') {
            const timeout = setTimeout(() => { privateCleanup.delete(sessionId); engine.destroy(sessionId).catch(() => {}); }, 60000);
            timeout.unref(); privateCleanup.set(sessionId, timeout);
          }
        }); return;
      }
      const upload = action.match(/^uploads\/([a-zA-Z\d-]+)$/);
      if (upload && request.method === 'POST') {
        const type = request.headers['content-type'] ?? '';
        let files;
        if (type.startsWith('application/json')) {
          const value = parse(await body(request));
          if (!Array.isArray(value.fileIds) || value.fileIds.some(v => typeof v !== 'string')) throw new Error('Invalid file selection.');
          files = value.fileIds.map(fileId => ({ fileId }));
        } else if (type.startsWith('multipart/form-data')) {
          const raw = await body(request, 33 * 1024 * 1024);
          const form = await new Response(raw, { headers: { 'Content-Type': type } }).formData();
          const selected = form.getAll('files');
          if (!selected.length || selected.length > 20 || selected.some(file => typeof file === 'string') || selected.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new Error('Choose up to 20 files totaling at most 32 MiB.');
          files = await Promise.all(selected.map(async file => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })));
        } else {
          const raw = await body(request, 32 * 1024 * 1024);
          const filename = request.headers['x-file-name'];
          if (typeof filename !== 'string') throw new Error('Select a file to upload.');
          files = [{ name: decodeURIComponent(filename), bytes: raw }];
        }
        await engine.upload(sessionId, upload[1], files); json(response, 200, engine.snapshot(sessionId)); return;
      }
      const download = action.match(/^downloads\/([a-zA-Z\d-]+)\/file$/);
      if (download && request.method === 'GET') {
        const item = engine.downloads.get(download[1]);
        if (!item || item.sessionId !== sessionId || !['completed', 'failed'].includes(item.transfer.state) || item.transfer.fileId) throw new Error('Download is unavailable.');
        const file = await stat(item.path);
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.transfer.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const stream = createReadStream(item.path); stream.on('error', () => response.destroy()); stream.pipe(response); return;
      }
      json(response, 405, { error: 'Unsupported browser operation.' });
    } catch (error) {
      // Avoid logging page addresses, request bodies, cookies, or CDP errors.
      const message = error instanceof Error ? error.message : 'The browser operation failed.';
      json(response, 400, { error: message });
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (!authorized(request) || !request.url.startsWith(`${PREFIX}/stream/`)) { socket.destroy(); return; }
    lastActivity = Date.now(); proxy(request, socket, head);
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  const idle = setInterval(() => { if (options.idleMs && Date.now() - lastActivity > options.idleMs) options.onIdle?.(); }, 30000);
  idle.unref(); server.on('close', () => { clearInterval(idle); for (const timeout of privateCleanup.values()) clearTimeout(timeout); });
  return server;
}
