import http from 'node:http';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { authenticate, loadConfig, normalizePath, RuntimeError } from './config.js';
import { DockerWorkspace } from './docker.js';
import { Sessions } from './sessions.js';

const MAX_BODY = 12 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const errorObject = e => ({ code: e instanceof RuntimeError ? e.code : 'INTERNAL', message: e instanceof RuntimeError ? e.message : 'The runtime operation failed.' });
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new RuntimeError('LIMIT', 'Request exceeds the 8 MiB file transfer limit.', 413); chunks.push(chunk); }
  try { const q = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!q || Array.isArray(q) || typeof q !== 'object') throw new Error(); return q; }
  catch { throw new RuntimeError('INVALID', 'Expected a JSON object.'); }
}
export function createRuntime(config, workspace = new DockerWorkspace({ stateDirectory: config.stateDirectory }), visitors = null) {
  const sessions = new Sessions(workspace, config), watchers = new Map(), queues = new Map(), buckets = new Map(), active = new Map();
  let inflight = 0;
  const identity = (req, res) => {
    if (req.headers.authorization) return authenticate(req.headers.authorization.replace(/^Bearer /, ''), config);
    if (visitors) { const record = visitors.authenticate(req.headers.cookie); res?.setHeader('Set-Cookie', visitors.cookie(record)); return record.principal; }
    return authenticate(undefined, config);
  };
  const requester = req => {
    const direct = req.socket.remoteAddress || '';
    const forwarded = req.headers['x-forwarded-for'];
    return config.trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : direct;
  };
  let bootstrapActive = 0;
  const rate = (key, cost = 1) => {
    const now = Date.now(), b = buckets.get(key) || { tokens: 120, at: now };
    b.tokens = Math.min(120, b.tokens + (now - b.at) / 1000 * 30); b.at = now;
    if (b.tokens < cost) throw new RuntimeError('RATE_LIMIT', 'Too many requests. Please retry shortly.', 429);
    b.tokens -= cost; buckets.set(key, b);
    if (buckets.size > 10000) for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
  };
  const notify = (owner, reason = 'changed') => {
    for (const ws of watchers.get(owner.workspaceId)?.sockets || []) {
      if (ws.bufferedAmount > 65536) { ws.close(1013, 'Filesystem subscriber is too slow.'); continue; }
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'files.changed', reason, at: Date.now() }));
    }
  };
  // Serialize API writes and their version checks across every client for a workspace.
  async function file(owner, q) {
    const previous = queues.get(owner.workspaceId) || { promise: Promise.resolve(), count: 0 };
    if (previous.count >= 16) throw new RuntimeError('RATE_LIMIT', 'Workspace operations are busy.', 429);
    const entry = { count: previous.count + 1 };
    const result = previous.promise.catch(() => {}).then(() => workspace.file(owner, q));
    entry.promise = result; queues.set(owner.workspaceId, entry);
    try { return await result; } finally {
      const current = queues.get(owner.workspaceId);
      current.count--;
      if (current.promise === result) queues.delete(owner.workspaceId);
    }
  }
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Origin is not allowed.' } });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const requestUrl = new URL(req.url, 'http://runtime.invalid');
      if (visitors && requestUrl.pathname === '/api/visitor') {
        if (!['POST', 'GET'].includes(req.method)) throw new RuntimeError('METHOD', 'Method not allowed.', 405);
        if (req.method === 'POST' && (!config.origins.includes(origin) || !req.headers['content-type']?.startsWith('application/json'))) throw new RuntimeError('FORBIDDEN', 'A same-origin workspace request is required.', 403);
        if (bootstrapActive >= 16) throw new RuntimeError('RATE_LIMIT', 'Please try again shortly.', 429);
        bootstrapActive++;
        try {
          let record;
          if (req.method === 'POST') {
            if (Number(req.headers['content-length']) > 1024) throw new RuntimeError('LIMIT', 'Workspace request is too large.', 413);
            let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024) throw new RuntimeError('LIMIT', 'Workspace request is too large.', 413); }
            record = (await visitors.obtain(req.headers.cookie, requester(req))).record;
            res.setHeader('Set-Cookie', visitors.cookie(record));
          } else record = visitors.authenticate(req.headers.cookie);
          rate(record.principal.userId);
          const state = workspace.begin(record.principal);
          return json(res, 200, { ...state, workspaceId: record.principal.workspaceId, retentionDays: Math.floor(visitors.retentionMs / 86400000), retryAfterMs: 1000 });
        } finally { bootstrapActive--; }
      }
      const owner = identity(req, res);
      if (visitors && !req.headers.authorization && !['GET', 'HEAD'].includes(req.method) && !config.origins.includes(origin)) throw new RuntimeError('FORBIDDEN', 'A same-origin workspace request is required.', 403);
      rate(owner.userId);
      if (inflight >= 16 || (active.get(owner.userId) || 0) >= 4) throw new RuntimeError('RATE_LIMIT', 'Too many concurrent runtime operations.', 429);
      inflight++; active.set(owner.userId, (active.get(owner.userId) || 0) + 1);
      let released = false;
      const release = () => { if (released) return; released = true; inflight--; active.set(owner.userId, active.get(owner.userId) - 1); };
      res.once('finish', release); res.once('close', release);
      if (Number(req.headers['content-length']) > MAX_BODY) throw new RuntimeError('LIMIT', 'Request exceeds the transfer limit.', 413);
      const url = new URL(req.url, 'http://runtime.invalid'), route = url.pathname, method = req.method;
      if (visitors && !req.headers.authorization && route !== '/api/identity') {
        const state = workspace.begin(owner);
        if (state.state !== 'ready') { res.setHeader('X-Lope-Workspace-State', state.state); throw new RuntimeError('WORKSPACE_STARTING', 'Your private workspace is starting…', 503); }
      }
      if (route === '/api/identity' && method === 'GET') return json(res, 200, { userId: owner.userId, workspaceId: owner.workspaceId, home: '/home/lope', filesystemRoot: '/', compatibility: 'Linux/Unix', maxTransferBytes: 8 * 1024 * 1024 });
      if (route === '/api/health' && method === 'GET') { await workspace.ready(owner); return json(res, 200, { ok: true, runtime: 'linux-pty', workspaceId: owner.workspaceId }); }
      if (route === '/api/terminal/sessions' && method === 'GET') return json(res, 200, { sessions: sessions.list(owner) });
      if (['/api/terminal/sessions', '/api/terminal/create'].includes(route) && method === 'POST') return json(res, 201, await sessions.create(owner, await body(req)));
      const terminal = route.match(/^\/api\/terminal\/([a-f0-9]{32})(?:\/close)?$/);
      if (terminal && (method === 'DELETE' || method === 'POST')) { await sessions.close(owner, terminal[1]); return json(res, 200, { ok: true }); }
      const operation = route.match(/^\/api\/fs\/(list|stat|read|write|mkdir|move|copy|storage|rename|delete|remove)$/)?.[1];
      if (operation) {
        const expectedMethod = { list: 'GET', stat: 'GET', read: 'GET', storage: 'GET', write: 'PUT', mkdir: 'POST', move: 'POST', copy: 'POST', rename: 'POST', delete: 'DELETE', remove: 'DELETE' }[operation];
        if (method !== expectedMethod) throw new RuntimeError('METHOD', 'Method not allowed.', 405);
        const b = method === 'GET' ? {} : await body(req);
        const q = { op: { rename: 'move', remove: 'delete' }[operation] || operation, path: normalizePath(method === 'GET' ? url.searchParams.get('path') ?? '/' : b.path) };
        if (q.op === 'write') {
          if (typeof b.content === 'string' && b.data === undefined) q.data = Buffer.from(b.content, 'utf8').toString('base64');
          else q.data = b.data;
          if (typeof q.data !== 'string') throw new RuntimeError('INVALID', 'Expected file content.');
          if (q.data.length > Math.ceil(MAX_FILE / 3) * 4) throw new RuntimeError('LIMIT', 'The file exceeds the 8 MiB transfer limit.', 413);
          q.version = b.version; q.createOnly = b.createOnly === true;
        }
        if (q.op === 'move' || q.op === 'copy') q.destination = normalizePath(b.destination ?? b.newPath);
        if (q.op === 'delete' || q.op === 'mkdir') q.recursive = b.recursive === true;
        if (q.op === 'delete') q.version = b.version;
        const result = await file(owner, q);
        if (!['read', 'stat', 'list', 'storage'].includes(q.op)) notify(owner);
        if (q.op === 'list') return json(res, 200, { entries: result });
        if (q.op === 'read') {
          if (url.searchParams.get('encoding') === 'base64') return json(res, 200, result);
          let content;
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(result.data, 'base64')); if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new Error(); }
          catch { throw new RuntimeError('BINARY', 'This file is not UTF-8 text. Use a binary transfer to read it.', 415); }
          return json(res, 200, { content, version: result.version });
        }
        return json(res, q.op === 'mkdir' ? 201 : 200, result ?? { ok: true });
      }
      throw new RuntimeError('NOT_FOUND', 'Route not found.', 404);
    } catch (e) { if (!res.destroyed) json(res, e.status || 500, { error: errorObject(e) }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxConnections = 256;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24576, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/ws' || !config.origins.includes(req.headers.origin) || wss.clients.size >= 128) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    let owner, credential, session, channel, alive = true, messages = 2000, messageAt = Date.now();
    const timeout = setTimeout(() => ws.close(4401, 'Authentication required.'), 5000);
    ws.on('error', () => {});
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      try { if (owner) credential ? authenticate(credential, config) : identity(req); } catch { ws.close(4401, 'Credential expired.'); return; }
      if (!alive) return ws.terminate(); alive = false; ws.ping();
    }, 25000);
    ws.on('close', () => { clearTimeout(timeout); clearInterval(heartbeat); if (owner && channel === 'files') { const w = watchers.get(owner.workspaceId); w?.sockets.delete(ws); if (!w?.sockets.size) watchers.delete(owner.workspaceId); } });
    ws.on('message', (raw, binary) => {
      try {
        const now = Date.now(); messages = Math.min(2000, messages + (now - messageAt) * 2); messageAt = now;
        if (--messages < 0) throw new RuntimeError('RATE_LIMIT', 'WebSocket message rate exceeded.', 429);
        if (binary) throw new RuntimeError('INVALID', 'Expected JSON protocol messages.');
        let m; try { m = JSON.parse(raw); } catch { throw new RuntimeError('INVALID', 'Malformed JSON message.'); }
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new RuntimeError('INVALID', 'Invalid protocol message.');
        if (!owner) {
          if (m.type !== 'auth') throw new RuntimeError('UNAUTHENTICATED', 'Authenticate before sending messages.', 401);
          credential = m.token || req.headers.authorization?.replace(/^Bearer /, ''); owner = credential ? authenticate(credential, config) : identity(req); channel = m.channel; clearTimeout(timeout);
          ws.runtimeOwner = owner;
          rate(owner.userId);
          if (channel === 'terminal') session = sessions.attach(owner, m.sessionId, ws, m.cursor);
          else if (channel === 'files') {
            let w = watchers.get(owner.workspaceId);
            if (!w) { w = { owner, sockets: new Set(), busy: false, snapshot: null }; watchers.set(owner.workspaceId, w); }
            if (w.sockets.size >= 16) throw new RuntimeError('LIMIT', 'Too many filesystem subscriptions.', 429);
            w.sockets.add(ws); ws.send(JSON.stringify({ type: 'files.ready' }));
          } else throw new RuntimeError('INVALID', 'Unknown runtime channel.');
          return;
        }
        credential ? authenticate(credential, config) : identity(req);
        // ACKs must not compete with keyboard input or throttle output consumption.
        if (m.type !== 'ack') rate(owner.userId, ['input', 'input-binary'].includes(m.type) ? Math.max(0.05, (m.data?.length || 0) / 1024) : 1);
        if (channel !== 'terminal') throw new RuntimeError('INVALID', 'This channel is read-only.');
        sessions.message(session, ws, m);
      } catch (e) { ws.send(JSON.stringify({ type: 'error', error: errorObject(e) })); ws.close(e.status === 401 ? 4401 : e.status === 404 ? 4404 : 4400, errorObject(e).code); }
    });
  });
  const poll = setInterval(() => {
    for (const w of watchers.values()) {
      if (w.busy) continue; w.busy = true;
      file(w.owner, { op: 'snapshot', path: '/' }).then(snapshot => {
        if (w.snapshot !== null && w.snapshot !== snapshot) notify(w.owner);
        w.snapshot = snapshot;
      }).catch(e => { for (const ws of w.sockets) if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'files.error', error: errorObject(e) })); }).finally(() => { w.busy = false; });
    }
  }, 1500); poll.unref();
  async function close() {
    clearInterval(poll);
    for (const ws of wss.clients) ws.terminate();
    await sessions.shutdown();
    wss.close();
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  }
  const isConnected = owner => [...wss.clients].some(ws => ws.runtimeOwner?.userId === owner.userId);
  const closeOwner = async owner => {
    for (const ws of wss.clients) if (ws.runtimeOwner?.userId === owner.userId) ws.close(4401, 'Workspace session ended.');
    await sessions.closeOwner(owner);
  };
  return { server, sessions, close, isConnected, closeOwner };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig(), runtime = createRuntime(config);
    runtime.server.listen(config.port, config.host, () => console.log(`LopeOS isolated runtime: http://${config.host}:${config.port} (credentials are never logged)`));
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(1), 8000); await runtime.close(); clearTimeout(deadline); process.exit(0); });
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
