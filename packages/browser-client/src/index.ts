export * from './contracts.ts';
export * from './navigation.ts';
export * from './suggestions.ts';
import type { BrowserCommand, BrowserMode, BrowserSession } from './contracts.ts';
import { MAX_OPENED_FILE_BYTES, openableFileType } from './navigation.ts';

export class BrowserClient {
  private readonly request: typeof fetch;
  private readonly base: string;
  constructor(request: typeof fetch = (...args) => globalThis.fetch(...args), base = '/api/browser') {
    this.request = request; this.base = base;
  }
  private async json<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.request(this.base + path, { ...options, headers, credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = payload?.error;
      const message = typeof error === 'string' ? error : error?.message;
      throw new Error(typeof message === 'string' && message.trim()
        ? message
        : response.status === 401 ? 'Sign in to reconnect your browser.' : 'The browser runtime is unavailable.');
    }
    return response.json() as Promise<T>;
  }
  create(mode: BrowserMode = 'normal') { return this.json<BrowserSession>('/sessions', { method: 'POST', body: JSON.stringify({ mode }) }); }
  get(id: string) { return this.json<BrowserSession>(`/sessions/${encodeURIComponent(id)}`); }
  command(id: string, command: BrowserCommand) { return this.json<BrowserSession>(`/sessions/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }); }
  destroy(id: string) { return this.json<{ closed: boolean }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  touch(id: string) { return this.json<{ alive: boolean }>(`/sessions/${encodeURIComponent(id)}/activity`, { method: 'POST' }); }
  uploadWorkspace(id: string, requestId: string, fileIds: string[]) {
    return this.json<BrowserSession>(`/sessions/${id}/uploads/${requestId}`, { method: 'POST', body: JSON.stringify({ fileIds }) });
  }
  async uploadDevice(id: string, requestId: string, file: File) { return this.uploadFiles(id, requestId, [file]); }
  /** Streams each file to the worker's disk, then hands them to the page's file chooser. */
  async uploadFiles(id: string, requestId: string, files: File[]) {
    if (!files.length || files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 1024 * 1024 * 1024) throw new Error('Choose up to 20 files totaling at most 1 GB.');
    const staged: string[] = [];
    for (const file of files) {
      const response = await this.request(`${this.base}/sessions/${id}/uploads/${requestId}/files`, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || typeof value.id !== 'string') throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || 'The file upload failed.');
      staged.push(value.id);
    }
    return this.json<BrowserSession>(`/sessions/${id}/uploads/${requestId}`, { method: 'POST', body: JSON.stringify({ staged }) });
  }
  /** Sends one HTML file the user chose to open; the worker shows it in a tab on its own origin. */
  async openFile(id: string, file: File) {
    if (!openableFileType(file.name)) throw new Error('Lope Browser can open HTML files (.html, .htm or .xhtml).');
    if (file.size > MAX_OPENED_FILE_BYTES) throw new Error('Lope Browser can open HTML files up to 32 MB.');
    return this.json<BrowserSession>(`/sessions/${encodeURIComponent(id)}/opened-files`, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
  }
  async download(id: string, transferId: string): Promise<Blob> {
    const response = await this.request(`${this.base}/sessions/${id}/downloads/${transferId}/file`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('This download is no longer available.');
    return response.blob();
  }
  /** Reconnects to authoritative full snapshots. No page screenshots pass through this channel. */
  subscribe(id: string, onState: (state: BrowserSession) => void, onConnection: (connected: boolean) => void = () => {}, onExpired?: () => void) {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    let attempt = 0;
    let connected: boolean | undefined;
    let lastReceived = 0;
    let reconnectNow = false;
    const reportConnection = (next: boolean) => {
      if (!closed && connected !== next) { connected = next; onConnection(next); }
    };
    const connect = async () => {
      if (closed || active) return;
      clearTimeout(retry); retry = undefined;
      const controller = new AbortController(); active = controller;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      // The worker sends a heartbeat every 15 seconds. A stalled connection must not
      // leave the controls looking connected indefinitely after sleep/network loss.
      let heartbeat: ReturnType<typeof setTimeout>;
      const received = () => {
        lastReceived = Date.now(); clearTimeout(heartbeat);
        heartbeat = setTimeout(() => controller.abort(), 45000);
      };
      received();
      try {
        const response = await this.request(`${this.base}/sessions/${encodeURIComponent(id)}/events`, {
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/event-stream' },
        });
        if (closed) { await response.body?.cancel().catch(() => {}); return; }
        if (controller.signal.aborted) throw new Error('Disconnected');
        if ([401, 404, 410].includes(response.status) && onExpired) {
          reportConnection(false); closed = true; removeListeners(); onExpired(); return;
        }
        if (!response.ok || !response.body) throw new Error('Disconnected');
        reader = response.body.getReader();
        const cancelReader = () => { void reader?.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancelReader, { once: true });
        const decoder = new TextDecoder(); let buffer = '';
        while (!closed && !controller.signal.aborted) {
          const { value, done } = await reader.read(); if (done || closed || controller.signal.aborted) break;
          received();
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 4 * 1024 * 1024) throw new Error('Invalid browser event.');
          let boundary: RegExpExecArray | null;
          // Intermediaries may use CRLF; SSE also permits comments, event fields,
          // multiple data lines and no space after the colon.
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const message = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = message.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data && !closed && !controller.signal.aborted) {
              onState(JSON.parse(data) as BrowserSession); reportConnection(true); attempt = 0;
            }
          }
        }
      } catch { /* The visible connection state exposes failures. */ }
      finally {
        clearTimeout(heartbeat!);
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (active === controller) active = undefined;
      }
      if (!closed) {
        reportConnection(false);
        const delay = reconnectNow ? 0 : Math.min(10000, 500 * 2 ** attempt++);
        reconnectNow = false; retry = setTimeout(connect, delay);
      }
    };
    const resume = (event: Event) => {
      if (closed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      if (!active) { attempt = 0; void connect(); }
      else if (event.type === 'online' || Date.now() - lastReceived >= 45000) {
        attempt = 0; reconnectNow = true; active.abort();
      }
    };
    const removeListeners = () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', resume);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume);
    };
    if (typeof window !== 'undefined') window.addEventListener('online', resume);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume);
    void connect(); return () => { closed = true; active?.abort(); clearTimeout(retry); removeListeners(); };
  }
}
