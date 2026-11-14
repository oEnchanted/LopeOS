import { EventEmitter } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { DISPLAY_EXTENSION_ID } from './display.mjs';

/**
 * Switches for the GPU the host lent this worker (LOPE_BROWSER_GPU). With none,
 * Chromium keeps its own software path (SwiftShader for WebGL). The GPU process
 * sandbox stays on either way.
 */
export function gpuArguments(gpu) {
  // Without a GPU every animated scroll frame is drawn in software and then encoded; jump instead.
  if (gpu !== 'dri' && gpu !== 'wsl') return ['--enable-unsafe-swiftshader', '--disable-smooth-scrolling'];
  // The host found a real GPU. Chromium's blocklist does not recognize Mesa's
  // D3D12 driver or a GPU with no PCI identity inside a container.
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas'];
  // Hardware video decoding needs a VA-API render node, which WSL's D3D12 path lacks.
  if (gpu === 'dri') args.push('--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder,VaapiIgnoreDriverChecks');
  return args;
}

/**
 * The user agent the same Chromium sends when it runs with a window. Headless mode would
 * otherwise announce "HeadlessChrome", which many sign-in and bot-protection pages refuse.
 */
export function browserUserAgent(versionText, platform = process.platform) {
  const major = /\b(\d{2,4})\.\d+\.\d+\.\d+\b/.exec(String(versionText))?.[1];
  if (!major) return null;
  const system = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
function installedVersion(executable) {
  try { return execFileSync(executable, ['--version'], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

// The GL stack for session applications, and Mesa's D3D12 driver on WSL.
const GRAPHICS_ENVIRONMENT = ['LD_LIBRARY_PATH', 'GALLIUM_DRIVER', 'MESA_LOADER_DRIVER_OVERRIDE', 'LIBGL_KOPPER_DRI2', 'LIBVA_DRIVER_NAME',
  '__GLX_VENDOR_LIBRARY_NAME', '__EGL_VENDOR_LIBRARY_FILENAMES', '__EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES'];

/** CDP over anonymous file descriptors. No debugging TCP port exists. */
export class ChromiumPipe extends EventEmitter {
  pending = new Map();
  sequence = 0;
  parts = [];
  partsLength = 0;
  constructor(executable, { profile, environment = process.env, proxyPort } = {}) {
    super();
    const version = installedVersion(executable);
    this.fullVersion = /\b(\d{2,4}\.\d+\.\d+\.\d+)\b/.exec(version)?.[1] ?? null;
    this.userAgent = browserUserAgent(version);
    const args = [
      `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--disable-blink-features=AutomationControlled', '--disk-cache-size=157286400',
      '--no-default-browser-check', '--disable-sync', '--window-size=1280,800',
      // Pages render offscreen. LopeOS shows the selected tab through Chromium's own tab
      // capture, which the bundled display extension encodes; only the worker can load it,
      // over this pipe, and only it may capture tabs without a click.
      '--headless=new', '--enable-unsafe-extension-debugging', `--allowlisted-extension-id=${DISPLAY_EXTENSION_ID}`,
      '--force-color-profile=srgb',
      ...(this.userAgent ? [`--user-agent=${this.userAgent}`] : []),
      // No desktop keyring exists here; a keyring unlock prompt would block the browser.
      '--password-store=basic',
      ...(proxyPort ? [`--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []),
      ...gpuArguments(environment.LOPE_BROWSER_GPU),
      'about:blank',
    ];
    // Deliberately never pass --no-sandbox, --disable-gpu-sandbox, --disable-web-security, or TLS bypass flags.
    const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
      ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'TMPDIR', 'FONTCONFIG_PATH', ...GRAPHICS_ENVIRONMENT].includes(key)));
    this.process = spawn(executable, args, { env, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.process.stdio[4].on('data', chunk => this.receive(chunk));
    this.process.stdio[3].on('error', () => this.disconnected());
    this.process.once('error', () => this.disconnected());
    this.process.once('exit', () => this.disconnected());
  }
  /** Messages are NUL-terminated JSON; media payloads make some of them large, so only new bytes are scanned. */
  receive(chunk) {
    let start = 0, end;
    while ((end = chunk.indexOf(0, start)) >= 0) {
      const tail = chunk.subarray(start, end);
      const raw = this.partsLength ? Buffer.concat([...this.parts, tail], this.partsLength + tail.length) : tail;
      this.parts = []; this.partsLength = 0; start = end + 1;
      this.dispatch(raw.toString('utf8'));
    }
    if (start < chunk.length) {
      this.parts.push(chunk.subarray(start)); this.partsLength += chunk.length - start;
      if (this.partsLength > 64 * 1024 * 1024) this.process.kill();
    }
  }
  dispatch(raw) {
    let packet;
    try { packet = JSON.parse(raw); } catch { return; }
    if (packet.id) {
      const request = this.pending.get(packet.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(packet.id);
      if (packet.error) request.reject(new Error(`${request.method}: ${packet.error.message}`));
      else request.resolve(packet.result);
    } else if (packet.method) {
      this.emit('event', packet);
      this.emit(packet.method, packet.params, packet.sessionId);
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
  /** What Chromium actually draws with, as reported by its GPU process. */
  async graphics() {
    const { gpu } = await this.send('SystemInfo.getInfo');
    const status = gpu?.featureStatus ?? {}, device = gpu?.devices?.find(entry => entry.deviceString) ?? {};
    const renderer = String(gpu?.auxAttributes?.glRenderer || device.deviceString || '').slice(0, 160);
    return { accelerated: String(status.gpu_compositing ?? '').startsWith('enabled') && !/swiftshader|llvmpipe|softpipe|basic render/i.test(renderer),
      renderer: renderer || null, compositing: status.gpu_compositing ?? null, rasterization: status.rasterization ?? null, webgl: status.webgl ?? null, video: status.video_decode ?? null };
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
