import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

/** CDP over anonymous file descriptors. No debugging TCP port exists. */
export class ChromiumPipe extends EventEmitter {
  pending = new Map();
  sequence = 0;
  buffer = Buffer.alloc(0);
  constructor(executable, { profile, headless = false, environment = process.env, proxyPort } = {}) {
    super();
    const args = [
      `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--disable-blink-features=AutomationControlled', '--disk-cache-size=157286400',
      '--no-default-browser-check', '--disable-sync', '--window-size=1280,800',
      ...(proxyPort ? [`--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []),
      ...(headless ? ['--headless=new'] : ['--kiosk']), 'about:blank',
    ];
    // Deliberately never pass --no-sandbox, --disable-web-security, or TLS bypass flags.
    const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
      ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR',
        'DBUS_SESSION_BUS_ADDRESS', 'PULSE_SERVER', 'PULSE_COOKIE', 'XAUTHORITY', 'TMPDIR'].includes(key)));
    this.process = spawn(executable, args, { env, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.process.stdio[4].on('data', chunk => this.receive(chunk));
    this.process.stdio[3].on('error', () => this.disconnected());
    this.process.once('error', () => this.disconnected());
    this.process.once('exit', () => this.disconnected());
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 64 * 1024 * 1024) { this.process.kill(); return; }
    let end;
    while ((end = this.buffer.indexOf(0)) >= 0) {
      const raw = this.buffer.subarray(0, end).toString('utf8');
      this.buffer = this.buffer.subarray(end + 1);
      let packet;
      try { packet = JSON.parse(raw); } catch { continue; }
      if (packet.id) {
        const request = this.pending.get(packet.id);
        if (!request) continue;
        clearTimeout(request.timer); this.pending.delete(packet.id);
        if (packet.error) request.reject(new Error(`${request.method}: ${packet.error.message}`));
        else request.resolve(packet.result);
      } else if (packet.method) {
        this.emit('event', packet);
        this.emit(packet.method, packet.params, packet.sessionId);
      }
    }
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('Chromium is disconnected.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chromium timed out: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Chromium is disconnected.')); }
      });
    });
  }
  disconnected() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Chromium is disconnected.')); }
    this.pending.clear(); this.emit('disconnected');
  }
  async close() {
    if (this.closed) return;
    const exited = new Promise(resolve => this.process.once('exit', resolve));
    await this.send('Browser.close').catch(() => {});
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
  }
}
