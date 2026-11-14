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
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined; let attempt = 0;
    const connect = async () => {
      try {
        const response = await this.request(`${this.base}/sessions/${id}/events`, { signal: controller.signal, credentials: 'same-origin' });
        if ([401, 404, 410].includes(response.status) && onExpired && !controller.signal.aborted) { onConnection(false); onExpired(); return; }
        if (!response.ok || !response.body) throw new Error('Disconnected');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 4 * 1024 * 1024) throw new Error('Invalid browser event.');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (message.startsWith('data: ')) { onState(JSON.parse(message.slice(6)) as BrowserSession); onConnection(true); attempt = 0; }
          }
        }
      } catch { /* The visible connection state exposes failures. */ }
      if (!controller.signal.aborted) { onConnection(false); retry = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++)); }
    };
    void connect(); return () => { controller.abort(); clearTimeout(retry); };
  }
}
