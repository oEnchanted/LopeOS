import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { HostingError } from './identity.mjs';

const PREFIX = '/api/browser';
function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readJSON(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 16384) { req.resume(); throw new HostingError(413, 'LIMIT', 'This browser request is too large.'); } chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new HostingError(400, 'REQUEST', 'Send a valid browser request.'); }
}

/** Public, cookie-authenticated gateway. Worker tokens never reach the client. */
export function createBrowserGateway({ identity, allocator, origins, idleMs = 600000, attachedIdleMs = 10800000, revokeMs = 5000, maxWorkers = 4, request = fetch, now = Date.now }) {
  if (!origins?.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Exact browser origins are required.');
  const workers = new Map(), sessions = new Map(), pending = new Map(), buckets = new Map();
  let closing = false;
  const resources = new Set();
  function guard(req, upgrade = false) {
    if (closing) throw new HostingError(503, 'STOPPING', 'The browser service is restarting. Reconnect shortly.');
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !origins.includes(origin)) ||
      ((upgrade || !['GET', 'HEAD'].includes(req.method)) && !origins.includes(origin))) throw new HostingError(403, 'ORIGIN', 'This website cannot control your Lope Browser.');
    const host = req.headers.host;
    if (!origins.some(origin => new URL(origin).host === host)) throw new HostingError(403, 'HOST', 'This browser host is not allowed.');
  }
  function rate(key) {
    const time = now(), bucket = buckets.get(key) ?? { credits: 6, at: time };
    bucket.credits = Math.min(6, bucket.credits + (time - bucket.at) / 60000); bucket.at = time;
    if (bucket.credits < 1) throw new HostingError(429, 'RATE_LIMIT', 'Please wait before starting another browser.');
    bucket.credits--; buckets.set(key, bucket);
    if (buckets.size > 4096) for (const [id, value] of buckets) if (time - value.at > 600000) buckets.delete(id);
  }
  async function obtain(owner, req) {
    const existing = workers.get(owner.key);
    if (existing) {
      try {
        const health = await request(existing.url + PREFIX + '/health', { headers: { Authorization: `Bearer ${existing.token}` }, signal: AbortSignal.timeout(2000), redirect: 'error' });
        const ready = health.ok; await health.body?.cancel();
        if (ready && !existing.stopping) { existing.owner = owner; existing.lastActive = now(); return existing; }
      } catch { /* Recreate a missing worker from its owned profile, using a new lease. */ }
      await stop(existing);
    }
    if (pending.has(owner.key)) return pending.get(owner.key);
    if (workers.size + pending.size >= maxWorkers) throw new HostingError(503, 'CAPACITY', 'All browser slots are in use. Try again shortly.');
    const peer = req.socket.remoteAddress ?? '', forwarded = req.headers['x-forwarded-for'];
    const address = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
    rate(owner.key); rate(identity.hash('ip:' + address));
    const operation = (async () => {
      const id = randomUUID(); const allocated = await allocator.create({ id, ownerKey: owner.key, origin: req.headers.origin });
      const worker = { ...allocated, id, owner, lastActive: now(), connections: new Set(), normalId: null };
      if (closing) { await allocator.destroy(worker); throw new HostingError(503, 'STOPPING', 'The browser service is restarting.'); }
      workers.set(owner.key, worker); return worker;
    })();
    pending.set(owner.key, operation);
    try { return await operation; } finally { pending.delete(owner.key); }
  }
  function publicSession(worker, backendId) {
    const found = [...sessions.values()].find(session => session.worker === worker && session.backendId === backendId);
    if (found) return found;
    const session = { id: randomUUID(), backendId, worker }; sessions.set(session.id, session); return session;
  }
  function snapshot(worker, value) {
    if (!value || !Array.isArray(value.tabs) || typeof value.id !== 'string') throw new HostingError(502, 'WORKER', 'The browser worker returned invalid state.');
    const session = publicSession(worker, value.id);
    if (value.mode === 'normal') worker.normalId = session.id;
    return { ...value, id: session.id, streamUrl: value.streamUrl ? `${PREFIX}/stream/${worker.id}/` : null,
      hosting: { remote: true, accountId: worker.owner.accountId, profile: 'server' } };
  }
  function headers(req, worker) {
    const result = { Authorization: `Bearer ${worker.token}`, Host: '127.0.0.1' };
    for (const key of ['origin', 'accept', 'content-type', 'content-length', 'x-file-name', 'range', 'connection', 'upgrade',
      'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) if (req.headers[key]) result[key] = req.headers[key];
    return result;
  }
  async function stop(worker) {
    if (worker.stopping) return worker.stopping;
    worker.stopping = (async () => {
      for (const connection of worker.connections) connection.destroy();
      for (const [id, session] of sessions) if (session.worker === worker) sessions.delete(id);
      try { await allocator.destroy(worker); } finally { workers.delete(worker.owner.key); }
    })(); return worker.stopping;
  }
  const errorResponse = (res, error) => json(res, error instanceof HostingError ? error.status : 503,
    { error: { code: error instanceof HostingError ? error.code : 'RUNTIME', message: error instanceof HostingError ? error.message : 'The browser runtime could not start. Please try again shortly.' } });

  async function proxy(req, res, worker, path, { events = false, binary = false, stream = false, session } = {}) {
    await new Promise((resolve, reject) => {
      const target = new URL(worker.url);
      const upstream = httpRequest({ hostname: target.hostname, port: target.port, path, method: req.method, headers: headers(req, worker) });
      upstream.on('error', () => { if (!res.headersSent) reject(new HostingError(502, 'DISCONNECTED', 'Your browser worker disconnected. Reconnect to restore it.')); else res.destroy(); resolve(); });
      upstream.on('response', reply => {
        const type = String(reply.headers['content-type'] ?? '');
        const outgoing = { ...reply.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        delete outgoing['set-cookie']; delete outgoing['www-authenticate']; delete outgoing['content-length'];
        worker.connections.add(res); resources.add(res);
        res.on('close', () => { worker.connections.delete(res); resources.delete(res); upstream.destroy(); worker.lastActive = now(); });
        if (events && reply.statusCode === 200 && type.includes('text/event-stream')) {
          res.writeHead(200, { ...outgoing, 'x-accel-buffering': 'no' }); res.flushHeaders();
          reply.setEncoding('utf8'); let buffer = '';
          reply.on('data', chunk => {
            buffer += chunk;
            if (Buffer.byteLength(buffer) > 4 * 1024 * 1024 || res.writableLength > 1024 * 1024) { res.destroy(); return; }
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              if (!packet.startsWith('data: ')) { res.write(packet + '\n\n'); continue; }
              try { res.write('data: ' + JSON.stringify(snapshot(worker, JSON.parse(packet.slice(6)))) + '\n\n'); }
              catch { res.destroy(); }
            }
          }); reply.on('end', () => { res.end(); resolve(); }); reply.on('error', () => { res.destroy(); resolve(); }); return;
        }
        if (binary || stream || !type.includes('application/json')) {
          res.writeHead(reply.statusCode ?? 502, outgoing); reply.pipe(res); reply.on('end', resolve); reply.on('error', () => { res.destroy(); resolve(); }); return;
        }
        const chunks = []; let size = 0;
        reply.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) { upstream.destroy(); reject(new HostingError(502, 'WORKER', 'Browser state exceeded its limit.')); } else chunks.push(chunk); });
        reply.on('end', () => {
          try {
            let value = JSON.parse(Buffer.concat(chunks));
            if (reply.statusCode >= 200 && reply.statusCode < 300 && value.tabs) value = snapshot(worker, value);
            if (req.method === 'DELETE' && session && reply.statusCode === 200) sessions.delete(session.id);
            json(res, reply.statusCode ?? 502, value); resolve();
          } catch { reject(new HostingError(502, 'WORKER', 'The browser worker returned invalid state.')); }
        });
      }); req.pipe(upstream);
    });
  }
  const server = createServer({ headersTimeout: 15000, requestTimeout: 120000, maxHeaderSize: 16384 }, async (req, res) => {
    try {
      guard(req); const url = new URL(req.url, 'http://browser');
      if (url.pathname === PREFIX + '/health' && req.method === 'GET') {
        json(res, 200, { status: 'ready', service: 'lope-browser-gateway', capacity: maxWorkers, profiles: 'isolated-server', endToEndEncrypted: false }); return;
      }
      const creating = url.pathname === PREFIX + '/sessions' && req.method === 'POST';
      const owner = await identity.resolve(req.headers.cookie, { create: creating });
      const expected = req.headers['x-lope-browser-account'];
      if (expected !== undefined && expected !== (owner.accountId ?? 'guest')) throw new HostingError(409, 'ACCOUNT_CHANGED', 'Your account changed. Reconnect the browser.');
      if (owner.setCookie) res.setHeader('Set-Cookie', owner.setCookie);
      if (creating) {
        const input = await readJSON(req);
        if (!['normal', 'private'].includes(input.mode)) throw new HostingError(400, 'MODE', 'Choose a normal or private browser session.');
        const worker = await obtain(owner, req);
        const response = await request(worker.url + PREFIX + '/sessions', { method: 'POST', headers: { Authorization: `Bearer ${worker.token}`, 'Content-Type': 'application/json', Origin: req.headers.origin },
          body: JSON.stringify({ mode: input.mode }), signal: AbortSignal.timeout(30000), redirect: 'error' });
        const value = await response.json(); if (!response.ok) { json(res, response.status, value); return; }
        json(res, 200, snapshot(worker, value)); return;
      }
      const media = url.pathname.match(/^\/api\/browser\/stream\/([a-f0-9-]{36})\//i);
      if (media) {
        const worker = workers.get(owner.key);
        if (!worker || worker.id !== media[1] || worker.stopping) throw new HostingError(404, 'SESSION', 'This browser stream is no longer available.');
        await proxy(req, res, worker, req.url, { stream: true }); return;
      }
      const match = url.pathname.match(/^\/api\/browser\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/i);
      const session = match && sessions.get(match[1]);
      if (!session || session.worker.owner.key !== owner.key || session.worker.stopping) throw new HostingError(404, 'SESSION', 'This browser session is no longer available. Reconnect to start a new one.');
      const worker = session.worker; worker.owner = owner;
      // Replacing the login cookie for the same account must not inherit an old live stream lease.
      worker.lastActive = now();
      const path = `${PREFIX}/sessions/${session.backendId}${match[2] ? '/' + match[2] : ''}${url.search}`;
      await proxy(req, res, worker, path, { events: match[2] === 'events', binary: /^downloads\/[\w-]+\/file$/.test(match[2] ?? ''), session });
    } catch (error) { if (!res.headersSent) errorResponse(res, error); else res.destroy(); }
  });
  server.on('upgrade', async (req, client, head) => {
    try {
      guard(req, true);
      const owner = await identity.resolve(req.headers.cookie);
      const match = new URL(req.url, 'http://browser').pathname.match(/^\/api\/browser\/stream\/([a-f0-9-]{36})\//i);
      const worker = workers.get(owner.key);
      if (!match || !worker || worker.id !== match[1] || worker.stopping) throw new HostingError(404, 'SESSION', 'Browser stream unavailable.');
      if (worker.connections.size >= 16) throw new HostingError(429, 'LIMIT', 'Too many browser connections.');
      const target = new URL(worker.url);
      const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: req.url, headers: headers(req, worker) });
      upstream.on('upgrade', (reply, remote, remoteHead) => {
        worker.connections.add(client); resources.add(client);
        const safe = Object.entries(reply.headers).filter(([key]) => ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions'].includes(key));
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${safe.map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (remoteHead.length) client.write(remoteHead); if (head.length) remote.write(head);
        remote.pipe(client).pipe(remote); client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
        client.on('close', () => { worker.connections.delete(client); resources.delete(client); remote.destroy(); worker.lastActive = now(); });
      }); upstream.on('response', () => client.destroy()); upstream.on('error', () => client.destroy()); client.on('close', () => upstream.destroy()); upstream.end();
    } catch { client.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
  });
  let auditing = false;
  const sweep = async () => {
    if (auditing) return; auditing = true;
    // Free a slot 10 minutes after the last viewer disconnects. While the stream or event
    // feed is open someone is watching, so only a 3-hour silence counts as abandoned.
    try {
      for (const worker of [...workers.values()]) {
        const idle = now() - worker.lastActive;
        if ((worker.connections.size ? idle > attachedIdleMs : idle > idleMs) || !await identity.revalidate(worker.owner)) await stop(worker);
      }
    }
    finally { auditing = false; }
  };
  const timer = setInterval(() => sweep().catch(() => {}), revokeMs); timer.unref();
  return { server, workers, sessions, sweep, async close() {
    closing = true; clearInterval(timer);
    for (const resource of resources) resource.destroy(); server.closeAllConnections();
    await Promise.allSettled([...pending.values()]);
    await Promise.allSettled([...workers.values()].map(stop));
    await new Promise(resolve => server.close(resolve));
  } };
}
