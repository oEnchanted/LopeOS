import { randomBytes } from 'node:crypto';
import { dimensions, normalizePath, RuntimeError } from './config.js';
import { ReplayBuffer } from './replay.js';

const WINDOW = 65536;
const socketOpen = ws => ws?.readyState === 1;
const send = (ws, value) => { if (socketOpen(ws)) ws.send(JSON.stringify(value)); };
export class Sessions {
  constructor(workspaces, config) {
    this.workspaces = workspaces; this.config = config; this.items = new Map(); this.pending = new Map();
    this.timer = setInterval(() => this.sweep(), 1000); this.timer.unref();
  }
  view(s) { return { id: s.id, cwd: s.cwd, cols: s.cols, rows: s.rows, state: s.state, createdAt: s.createdAt, exitCode: s.exitCode }; }
  list(owner) { return [...this.items.values()].filter(s => s.owner.userId === owner.userId).map(s => this.view(s)); }
  get(owner, id) {
    const s = this.items.get(id);
    if (!s || s.owner.userId !== owner.userId || s.owner.workspaceId !== owner.workspaceId) throw new RuntimeError('NOT_FOUND', 'Terminal session not found.', 404);
    return s;
  }
  async create(owner, request = {}) {
    const count = this.list(owner).length + (this.pending.get(owner.userId) || 0);
    if (count >= this.config.maxSessions) throw new RuntimeError('LIMIT', 'Close a terminal tab before creating another.', 429);
    this.pending.set(owner.userId, (this.pending.get(owner.userId) || 0) + 1);
    try {
      const size = dimensions(request.cols ?? 80, request.rows ?? 24), cwd = normalizePath(request.cwd ?? '/');
      const entry = await this.workspaces.file(owner, { op: 'stat', path: cwd });
      if (entry.type !== 'directory') throw new RuntimeError('INVALID', 'The working directory must be a directory.');
      const id = randomBytes(16).toString('hex');
      const process = await this.workspaces.terminal(owner, id, { ...size, cwd, shell: this.config.shell });
      const s = { id, owner, cwd, ...size, createdAt: Date.now(), state: 'running', process, replay: new ReplayBuffer(), reader: null, detachedAt: Date.now(), paused: false };
      this.items.set(id, s);
      process.onData(data => { s.replay.append(data); this.pump(s); });
      process.onExit(({ exitCode }) => {
        s.state = 'exited'; s.exitCode = exitCode; s.detachedAt = Date.now(); this.pump(s);
        this.workspaces.closeTerminal(owner, id).catch(() => {});
      });
      return this.view(s);
    } finally { this.pending.set(owner.userId, this.pending.get(owner.userId) - 1); }
  }
  attach(owner, id, ws, cursor) {
    const s = this.get(owner, id);
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new RuntimeError('INVALID', 'Invalid terminal replay cursor.');
    if (s.reader) s.reader.ws.close(4001, 'Attached in another connection.');
    const from = cursor === undefined ? s.replay.start : Math.max(s.replay.start, Math.min(cursor, s.replay.end));
    const r = { ws, sent: from, ack: from, exited: false };
    s.reader = r; s.detachedAt = null;
    send(ws, { type: 'ready', session: this.view(s), cursor: from, truncated: cursor !== undefined ? cursor < s.replay.start : s.replay.start > 0 });
    ws.on('close', () => { if (s.reader === r) { s.reader = null; s.detachedAt = Date.now(); this.flow(s, false); } });
    this.pump(s);
    return s;
  }
  flow(s, pause) {
    if (s.state !== 'running' || pause === s.paused) return;
    s.paused = pause;
    try { pause ? s.process.pause() : s.process.resume(); } catch { /* The process may have exited this tick. */ }
  }
  pump(s) {
    const r = s.reader;
    if (!r || !socketOpen(r.ws)) { this.flow(s, false); return; }
    if (r.sent < s.replay.start) {
      // This is possible after a detached producer outruns replay before the next tick.
      send(r.ws, { type: 'gap', cursor: s.replay.start }); r.sent = s.replay.start; r.ack = r.sent;
    }
    while (r.sent - r.ack < WINDOW && r.ws.bufferedAmount < 131072 && r.sent < s.replay.end) {
      const chunk = s.replay.read(r.sent, Math.min(16384, WINDOW - (r.sent - r.ack)));
      if (!chunk.data) break;
      send(r.ws, { type: 'output', ...chunk }); r.sent = chunk.end;
    }
    this.flow(s, r.sent - r.ack >= WINDOW || r.ws.bufferedAmount >= 131072);
    if (s.state === 'exited' && r.sent === s.replay.end && !r.exited) {
      r.exited = true; send(r.ws, { type: 'exit', exitCode: s.exitCode });
    }
  }
  message(s, ws, m) {
    const r = s.reader;
    if (!r || r.ws !== ws) throw new RuntimeError('CONFLICT', 'Terminal is attached elsewhere.', 409);
    if (m.type === 'ack') {
      if (!Number.isSafeInteger(m.cursor) || m.cursor < r.ack || m.cursor > r.sent) throw new RuntimeError('INVALID', 'Invalid output acknowledgement.');
      r.ack = m.cursor; this.pump(s);
    } else if (m.type === 'input') {
      if (s.state !== 'running') throw new RuntimeError('EXITED', 'The shell has exited.', 409);
      if (typeof m.data !== 'string' || m.data.length > 8192) throw new RuntimeError('INVALID', 'Terminal input exceeds the message limit.');
      s.process.write(m.data);
    } else if (m.type === 'input-binary') {
      if (s.state !== 'running') throw new RuntimeError('EXITED', 'The shell has exited.', 409);
      if (typeof m.data !== 'string' || m.data.length > 10924 || m.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.data)) throw new RuntimeError('INVALID', 'Invalid binary terminal input.');
      const data = Buffer.from(m.data, 'base64');
      if (data.length > 8192) throw new RuntimeError('INVALID', 'Binary input exceeds the message limit.');
      s.process.writeBinary(data);
    } else if (m.type === 'resize') {
      const size = dimensions(m.cols, m.rows);
      if (s.state === 'running') s.process.resize(size.cols, size.rows);
      Object.assign(s, size);
    } else throw new RuntimeError('INVALID', 'Unknown terminal message.');
  }
  async close(owner, id) {
    const s = this.get(owner, id);
    if (s.closing) return s.closing;
    s.closing = (async () => {
      // Kill the container-side job-control session before terminating the Docker PTY client.
      await this.workspaces.closeTerminal(owner, id);
      try { s.process.kill(); } catch {}
      s.reader?.ws.close(1000, 'Terminal closed.'); this.items.delete(id);
    })();
    try { await s.closing; } catch (e) { s.closing = null; throw e; }
  }
  sweep() {
    for (const s of this.items.values()) {
      if (s.reader) this.pump(s);
      if (s.detachedAt && Date.now() - s.detachedAt > this.config.detachedMs) this.close(s.owner, s.id).catch(() => {});
    }
  }
  async closeOwner(owner) {
    const results = await Promise.allSettled([...this.items.values()].filter(s => s.owner.userId === owner.userId).map(s => this.close(owner, s.id)));
    const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
  }
  async shutdown() {
    clearInterval(this.timer);
    return Promise.allSettled([...this.items.values()].map(s => this.close(s.owner, s.id)));
  }
}
