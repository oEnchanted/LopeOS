import type { FileEntry, FileService, FileStorageInfo, TerminalEvent, TerminalService, WriteOptions } from '../../contracts/src';
import { mountLopeDrive } from './mounted-files.ts';

export interface RuntimeOptions { baseUrl?: string; getToken?: () => string | Promise<string>; onWorkspaceStatus?: (state: string) => void }
export interface SessionRecord { id: string; cwd: string; cols: number; rows: number; state: 'running' | 'exited'; createdAt: number; exitCode?: number }
export type { WriteOptions } from '../../contracts/src';
export class RuntimeError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 0) { super(message); this.code = code; this.status = status; }
}
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'exited' | 'unavailable';
export interface TerminalCallbacks {
  output(data: string, consumed: () => void): void;
  state?(state: ConnectionState, message?: string): void;
  ready?(session: SessionRecord, truncated: boolean): void;
  gap?(): void;
  exit?(exitCode: number): void;
}
const decode = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
function encode(data: Uint8Array) {
  if (data.byteLength > 8 * 1024 * 1024) throw new RuntimeError('LIMIT', 'The file exceeds the 8 MiB transfer limit.');
  let text = '';
  for (let i = 0; i < data.length; i += 16384) text += String.fromCharCode(...data.subarray(i, i + 16384));
  return btoa(text);
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export class RuntimeClient {
  options: RuntimeOptions;
  visitorBoot: Promise<void> | null = null;
  constructor(options: RuntimeOptions = {}) { this.options = options; }
  async ensureVisitor() {
    if (this.visitorBoot) return this.visitorBoot;
    const boot = async () => {
      let first = true; const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        let response: Response;
        try { response = await fetch(`${this.options.baseUrl || ''}/api/visitor`, { method: first ? 'POST' : 'GET', ...(first ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
        catch { throw new RuntimeError('UNAVAILABLE', 'Your workspace is temporarily unavailable. Please try again shortly.'); }
        let state;
        try { state = await response.json(); } catch { throw new RuntimeError('UNAVAILABLE', 'Your workspace is temporarily unavailable. Please try again shortly.'); }
        if (!response.ok) throw new RuntimeError(state.error?.code || 'UNAVAILABLE', state.error?.message || 'Your workspace is temporarily unavailable.', response.status);
        this.options.onWorkspaceStatus?.(state.state);
        if (state.state === 'ready') return;
        if (state.state === 'unavailable') throw new RuntimeError('UNAVAILABLE', state.message || 'Your workspace could not start. Please try again shortly.', 503);
        first = false;
        await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.min(3000, state.retryAfterMs || 1000))));
      }
      throw new RuntimeError('CAPACITY', 'Your workspace is still starting. Please try again shortly.', 503);
    };
    this.visitorBoot = boot();
    try { await this.visitorBoot; } finally { this.visitorBoot = null; }
  }
  async request<T>(endpoint: string, options: RequestInit = {}, assertCurrent?: () => void): Promise<T> {
    const headers = new Headers(options.headers), token = await this.options.getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const send = async () => {
      assertCurrent?.();
      try { return await fetch(`${this.options.baseUrl || ''}/api${endpoint}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store', signal: options.signal ?? AbortSignal.timeout(20000) }); }
      catch { throw new RuntimeError('UNAVAILABLE', 'Your workspace is temporarily unavailable. Please try again shortly.'); }
    };
    let response = await send();
    if ((response.status === 401 || (response.status === 503 && response.headers.get('X-Lope-Workspace-State'))) && !token && !endpoint.startsWith('/visitor')) {
      await response.body?.cancel(); await this.ensureVisitor(); response = await send();
    }
    let payload;
    try { payload = await response.json(); } catch { throw new RuntimeError('UNAVAILABLE', 'Your workspace is temporarily unavailable. Please try again shortly.', response.status); }
    if (!response.ok) throw new RuntimeError(payload.error?.code || 'RUNTIME', typeof payload.error === 'string' ? payload.error : payload.error?.message || 'The runtime request failed.', response.status);
    return payload as T;
  }
  health() { return this.request<{ ok: boolean; runtime: string; workspaceId: string }>('/health'); }
  identity() { return this.request<{ userId: string; workspaceId: string; home: string }>('/identity'); }
  listSessions() { return this.request<{ sessions: SessionRecord[] }>('/terminal/sessions').then(r => r.sessions); }
  createSession(options: { cwd?: string; cols?: number; rows?: number } = {}) { return this.request<SessionRecord>('/terminal/sessions', post(options)); }
  async closeSession(id: string) { try { await this.request(`/terminal/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { if (!(e instanceof RuntimeError) || e.code !== 'NOT_FOUND') throw e; } }
  connectSession(id: string, callbacks: TerminalCallbacks, options: { cursor?: number } = {}) {
    let socket: WebSocket | null = null, stopped = false, exited = false, attempt = 0;
    let cursor = options.cursor, timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
    let desiredSize: { cols: number; rows: number } | null = null;
    const send = (m: unknown) => { if (socket?.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify(m)); return true; };
    const connect = async () => {
      const current = ++generation;
      callbacks.state?.(attempt ? 'reconnecting' : 'connecting');
      try {
        const token = await this.options.getToken?.();
        if (!token) await this.request('/identity');
        if (stopped || current !== generation) return;
        const url = new URL(`${this.options.baseUrl || ''}/api/ws`, globalThis.location?.href || 'http://localhost');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(url); socket = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', channel: 'terminal', sessionId: id, token, cursor }));
        ws.onmessage = event => {
          if (stopped || current !== generation) return;
          let m; try { m = JSON.parse(event.data); } catch { ws.close(4400, 'Invalid protocol'); return; }
          if (m.type === 'ready') {
            attempt = 0; cursor = Math.max(cursor ?? m.cursor, m.cursor);
            callbacks.ready?.(m.session, m.truncated); callbacks.state?.('connected');
            if (desiredSize) send({ type: 'resize', ...desiredSize });
          } else if (m.type === 'output') {
            // ACK only after xterm has parsed the output. This bounds its write queue.
            if (cursor !== undefined && m.end <= cursor) { ws.send(JSON.stringify({ type: 'ack', cursor: m.end })); return; }
            const data = cursor !== undefined && cursor > m.start ? m.data.slice(cursor - m.start) : m.data;
            callbacks.output(data, () => {
              if (stopped) return;
              cursor = Math.max(cursor ?? 0, m.end);
              if (current === generation && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', cursor: m.end }));
            });
          } else if (m.type === 'gap') { cursor = m.cursor; callbacks.gap?.(); }
          else if (m.type === 'exit') { exited = true; callbacks.state?.('exited', `Shell exited (${m.exitCode}).`); callbacks.exit?.(m.exitCode); }
          else if (m.type === 'error') callbacks.state?.('unavailable', m.error?.message);
        };
        ws.onerror = () => { /* onclose schedules bounded exponential retry. */ };
        ws.onclose = event => {
          if (stopped || current !== generation || exited) return;
          if ([1000, 4001, 4400, 4401, 4404].includes(event.code)) { callbacks.state?.('unavailable', event.code === 4401 ? 'Sign in again to reconnect.' : event.reason || 'This session is unavailable.'); return; }
          callbacks.state?.('reconnecting', 'Connection lost; reconnecting to the same shell…');
          timer = setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(attempt++, 5)) + Math.random() * 250);
        };
      } catch { callbacks.state?.('unavailable', 'Your workspace is temporarily unavailable. Reconnect to try again.'); }
    };
    void connect();
    return {
      input(data: string) {
        if (!data) return;
        if (data.length > 32768) throw new RuntimeError('LIMIT', 'Paste up to 32,768 characters at once, or upload a script through Files.');
        if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) throw new RuntimeError('UNAVAILABLE', 'Input is paused until the terminal reconnects.');
        // Bracketed paste can be large; chunk input without splitting surrogate pairs.
        for (let i = 0; i < data.length;) {
          let end = Math.min(data.length, i + 2048);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
          send({ type: 'input', data: data.slice(i, end) }); i = end;
        }
      },
      inputBinary(data: string) {
        if (data.length > 8192) throw new RuntimeError('LIMIT', 'Binary terminal input exceeds the message limit.');
        if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) throw new RuntimeError('UNAVAILABLE', 'The terminal is reconnecting.');
        send({ type: 'input-binary', data: btoa(data) });
      },
      resize(cols: number, rows: number) { desiredSize = { cols, rows }; send({ type: 'resize', cols, rows }); },
      reconnect() { if (exited) return; generation++; clearTimeout(timer); socket?.close(1000, 'Reconnecting.'); attempt = 0; void connect(); },
      disconnect() { stopped = true; generation++; clearTimeout(timer); socket?.close(1000, 'View detached.'); },
      getCursor: () => cursor,
    };
  }
  subscribeFiles(callback: (path?: string) => void, onError?: (error: Error) => void) {
    let stopped = false, ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined, attempt = 0;
    const connect = async () => {
      try {
        const token = await this.options.getToken?.(); if (!token) await this.request('/identity'); if (stopped) return;
        const url = new URL(`${this.options.baseUrl || ''}/api/ws`, globalThis.location?.href || 'http://localhost');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(url);
        ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', channel: 'files', token }));
        ws.onmessage = event => {
          if (stopped) return;
          const m = JSON.parse(event.data);
          if (m.type === 'files.ready') { attempt = 0; callback(); }
          if (m.type === 'files.changed') callback();
          if (m.type === 'error' || m.type === 'files.error') onError?.(new RuntimeError(m.error.code, m.error.message));
        };
        ws.onclose = event => {
          if (stopped || event.code === 4400) return;
          timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4)));
        };
        ws.onerror = () => {};
      } catch (e) { onError?.(e instanceof Error ? e : new Error('Filesystem subscription unavailable.')); }
    };
    void connect();
    return () => { stopped = true; clearTimeout(timer); ws?.close(1000, 'Subscription ended.'); };
  }
}
let localToken = '';
export const runtimeClient = new RuntimeClient({ getToken: () => localToken });
export function configureRuntime(options: RuntimeOptions) { runtimeClient.options = options; }
export function setRuntimeToken(token: string) { localToken = token.trim(); runtimeClient.options.getToken = () => localToken; }
export const runtimeRequest = <T>(endpoint: string, options?: RequestInit) => runtimeClient.request<T>(endpoint, options);
interface RemoteEntry { name: string; path: string; type: string; size: number; modifiedAt: string | number; version?: string }
const entry = (e: RemoteEntry): FileEntry => ({ name: e.name, path: e.path, type: e.type as FileEntry['type'], size: e.size, modified: new Date(e.modifiedAt).toISOString(), version: e.version });
export function createFileService(client: RuntimeClient) {
  const subscribers = new Map<(path?: string) => void, ((error: Error) => void) | undefined>();
  let unsubscribe: (() => void) | undefined;
  const readBinary = async (path: string) => {
    const r = await client.request<{ data: string; version: string }>(`/fs/read?encoding=base64&path=${encodeURIComponent(path)}`);
    return { data: decode(r.data), version: r.version };
  };
  const writeBinary = async (path: string, data: Uint8Array, options: WriteOptions = {}) => {
    const { assertCurrent, ...wireOptions } = options;
    assertCurrent?.();
    const r = await client.request<RemoteEntry>('/fs/write', { method: 'PUT', body: JSON.stringify({ path, data: encode(data), ...wireOptions }) }, assertCurrent);
    return { ...entry(r), version: r.version! };
  };
  return {
    async list(path: string) { const r = await client.request<{ entries: RemoteEntry[] }>(`/fs/list?path=${encodeURIComponent(path)}`); return r.entries.map(entry); },
    async stat(path: string) { return entry(await client.request<RemoteEntry>(`/fs/stat?path=${encodeURIComponent(path)}`)); },
    async read(path: string) { const r = await readBinary(path); let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(r.data); if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new Error(); }
      catch { throw new RuntimeError('BINARY', 'This file is not UTF-8 text. Download it or open it in an appropriate app.', 415); }
      return { content, version: r.version };
    },
    async write(path: string, content: string, expected?: string | WriteOptions) {
      const r = await writeBinary(path, new TextEncoder().encode(content), typeof expected === 'string' ? { version: expected } : expected);
      return { content, version: r.version };
    },
    readBinary, writeBinary,
    async create(path: string, content: string) { const r = await writeBinary(path, new TextEncoder().encode(content), { createOnly: true }); return { content, version: r.version }; },
    async mkdir(path: string) { await client.request('/fs/mkdir', post({ path })); },
    async move(path: string, destination: string) { await client.request('/fs/move', post({ path, destination })); },
    async copy(path: string, destination: string) { await client.request('/fs/copy', post({ path, destination })); },
    async storage() { return client.request<FileStorageInfo>('/fs/storage'); },
    async rename(path: string, destination: string) { await client.request('/fs/move', post({ path, destination })); },
    async remove(path: string, options: { recursive?: boolean; version?: string } = { recursive: true }) { await client.request('/fs/delete', { method: 'DELETE', body: JSON.stringify({ path, ...options }) }); },
    subscribe(callback: (path?: string) => void, onError?: (error: Error) => void) {
      subscribers.set(callback, onError);
      if (!unsubscribe) unsubscribe = client.subscribeFiles(path => { for (const fn of subscribers.keys()) fn(path); }, error => { for (const fn of subscribers.values()) fn?.(error); });
      return () => { subscribers.delete(callback); if (!subscribers.size) { unsubscribe?.(); unsubscribe = undefined; } };
    },
  } satisfies FileService & Record<string, unknown>;
}
export const runtimeFileService = createFileService(runtimeClient);
export const fileService = mountLopeDrive(runtimeFileService);
// Compatibility adapter for shared SDK consumers. Terminal UI uses connectSession
// directly so its output ACK follows the xterm parse callback.
const connections = new Map<string, ReturnType<RuntimeClient['connectSession']>>();
export const terminalService: TerminalService = {
  async create(options) { const r = await runtimeClient.createSession(options); return { id: r.id, state: 'running', cols: r.cols, rows: r.rows }; },
  attach(sessionId, listener) {
    const c = runtimeClient.connectSession(sessionId, { output(data, ack) { listener({ type: 'output', sessionId, data }); ack(); }, exit(exitCode) { listener({ type: 'exit', sessionId, exitCode }); } });
    connections.set(sessionId, c);
    return () => { c.disconnect(); if (connections.get(sessionId) === c) connections.delete(sessionId); };
  },
  async input(sessionId, data) { const c = connections.get(sessionId); if (!c) throw new RuntimeError('UNAVAILABLE', 'Attach the terminal before sending input.'); c.input(data); },
  async resize(sessionId, cols, rows) { connections.get(sessionId)?.resize(cols, rows); },
  async close(sessionId) { await runtimeClient.closeSession(sessionId); connections.get(sessionId)?.disconnect(); connections.delete(sessionId); },
};
export type { TerminalEvent };
