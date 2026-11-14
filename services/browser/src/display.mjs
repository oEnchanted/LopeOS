import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Chromium's own tab capture, encoded by the bundled extension and paced by the viewer's acknowledgements. */
export const DISPLAY_EXTENSION = fileURLToPath(new URL('./display-extension/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./display-extension/manifest.json', import.meta.url), 'utf8'));
// Chromium derives an unpacked extension's ID from its public key.
export const DISPLAY_EXTENSION_ID = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16).toString('hex')]
  .map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
const OUTPUT = 'lopeDisplayOutput';
export const CODEC_STRINGS = { vp9: 'vp09.00.10.08', av1: 'av01.0.08M.08', h264: 'avc1.42E033' };
const VIDEO = 1, AUDIO = 2, JPEG = 3;
const BUTTONS = new Set(['none', 'left', 'middle', 'right', 'back', 'forward']);
// Ctrl shortcuts carry their editing command, so they act the same whatever platform runs Chromium.
const EDIT_COMMANDS = { a: ['selectAll'], v: ['paste'], z: ['undo'], 'shift+z': ['redo'], y: ['redo'] };
const COPY_SENTINEL = '⁣lope-copy⁣';
const CURSORS = new Set(['auto', 'default', 'none', 'context-menu', 'help', 'pointer', 'progress', 'wait', 'cell', 'crosshair', 'text', 'vertical-text',
  'alias', 'copy', 'move', 'no-drop', 'not-allowed', 'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize', 'n-resize', 'e-resize', 's-resize',
  'w-resize', 'ne-resize', 'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'zoom-in', 'zoom-out']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const number = (value, low = -100000, high = 100000) => Number.isFinite(value) ? clamp(value, low, high) : 0;
const integer = (value, low, high) => Number.isInteger(value) ? clamp(value, low, high) : low;

/** Maps a Mac keyboard onto the Linux Chromium that renders pages: Command acts as Control. */
export function macKey(event) {
  const { key, code, keyCode, modifiers } = event;
  if (key === 'Meta') return { ...event, key: 'Control', code: code === 'MetaRight' ? 'ControlRight' : 'ControlLeft', keyCode: 17, modifiers: (modifiers & ~4) | 2, text: '' };
  if (modifiers & 4) {
    const line = { ArrowLeft: ['Home', 36, 0], ArrowRight: ['End', 35, 0], ArrowUp: ['Home', 36, 2], ArrowDown: ['End', 35, 2] }[key];
    if (line) return { ...event, key: line[0], code: line[0], keyCode: line[1], modifiers: (modifiers & ~4) | line[2], text: '' };
    return { ...event, modifiers: (modifiers & ~4) | 2, text: '' };
  }
  // Option moves and deletes by word.
  if ((modifiers & 1) && ['ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'].includes(key)) return { ...event, modifiers: (modifiers & ~1) | 2, text: '' };
  return event;
}

/** Picks the rendering density and an encoder-friendly size for a viewer's window. */
export function displayGeometry({ width, height, dpr }, { maxPixels, codec }) {
  const css = { width: Math.round(clamp(Number(width) || 0, 200, 7680)), height: Math.round(clamp(Number(height) || 0, 150, 4320)) };
  const ratio = clamp(Number(dpr) || 1, 0.5, 4);
  let dsf = ratio >= 1.75 ? 2 : ratio >= 1.25 ? 1.5 : 1;
  // Chromium's software H.264 encoder cannot keep up with HiDPI frames.
  if (codec === 'h264') dsf = 1;
  while (dsf > 1 && css.width * css.height * dsf * dsf > maxPixels) dsf = dsf > 1.5 ? 1.5 : 1;
  const align = dsf === 1.5 ? 4 : dsf === 1 ? 2 : 1;
  css.width -= css.width % align; css.height -= css.height % align;
  return { ...css, dsf, frameWidth: Math.round(css.width * dsf), frameHeight: Math.round(css.height * dsf) };
}

export class DisplayHub {
  constructor(engine, { fps = Number(process.env.LOPE_BROWSER_STREAM_FPS) || 30, maxPixels = Number(process.env.LOPE_BROWSER_STREAM_MAX_PIXELS) || 4_700_000 } = {}) {
    this.engine = engine;
    this.fps = clamp(fps, 5, 60);
    this.maxPixels = clamp(maxPixels, 300_000, 16_000_000);
    this.displays = new Map();
    this.encoders = {};
    this.video = false;
  }
  get cdp() { return this.engine.cdp; }

  async start() {
    try {
      const { id } = await this.cdp.send('Extensions.loadUnpacked', { path: DISPLAY_EXTENSION });
      if (id !== DISPLAY_EXTENSION_ID) throw new Error('The display extension has an unexpected identity.');
      await this.attachExtension();
      this.encoders = await this.call('document', 'lopeDisplay.probe()') ?? {};
      this.video = ['vp9', 'av1', 'h264'].some(codec => this.encoders[codec]);
    } catch (error) {
      // Pages still stream as JPEG through Chromium's screencast.
      this.video = false; this.failure = error instanceof Error ? error.message : String(error);
    }
    return this;
  }

  async attachExtension() {
    const origin = `chrome-extension://${DISPLAY_EXTENSION_ID}/`;
    this.worker = await this.attach(info => info.type === 'service_worker' && info.url === origin + 'background.js');
    await this.evaluate(this.worker, 'lopeDisplay.ready()');
    this.document = await this.attach(info => info.url === origin + 'offscreen.html');
    await this.cdp.send('Runtime.enable', {}, this.document.session);
    await this.cdp.send('Runtime.addBinding', { name: OUTPUT }, this.document.session);
  }

  async attach(match, timeout = 15000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const info = (await this.cdp.send('Target.getTargets')).targetInfos.find(match);
      if (info) {
        const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        const target = { id: info.targetId, session: sessionId };
        // A worker's target appears before its script has run.
        while (Date.now() < until) {
          if (await this.evaluate(target, "typeof lopeDisplay === 'object'").catch(() => false)) return target;
          await sleep(40);
        }
        break;
      }
      await sleep(40);
    }
    throw new Error('The display extension did not start.');
  }

  async evaluate(target, expression) {
    if (!target) throw new Error('The display extension is detached.');
    const result = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target.session);
    if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description ?? 'The display extension failed.').split('\n')[0]);
    return result.result?.value;
  }

  /** Calls the extension, reattaching once if Chromium replaced its worker or document. */
  async call(which, expression) {
    try { return await this.evaluate(this[which], expression); }
    catch (error) {
      if (this.engine.stopping || this[which] && !/session|target|context|detached|closed|not found|Cannot find/i.test(error.message)) throw error;
      await this.recover();
      return this.evaluate(this[which], expression);
    }
  }

  async recover() {
    this.recovering ??= (async () => {
      try { await this.attachExtension(); }
      catch {
        // A stopped worker is woken by its document; a closed document is recreated by its worker.
        await this.evaluate(this.document, 'lopeDisplay.wake()').catch(() => {});
        await this.attachExtension();
      }
      // Captures ran in the document Chromium replaced; start them again.
      for (const display of this.displays.values()) if (display.socket && display.mode === 'video' && display.running) {
        display.running = false; this.control(display, () => this.capture(display, true));
      }
    })().finally(() => { this.recovering = null; });
    return this.recovering;
  }

  targetDestroyed(targetId) {
    if (this.worker?.id === targetId) this.worker = null;
    if (this.document?.id === targetId) this.document = null;
  }

  sessionFor(cdpSession) { return cdpSession && cdpSession === this.document?.session; }

  /** One viewer per browser session; a newer connection replaces the older one. */
  connect(sessionId, socket) {
    if (!this.engine.sessions.has(sessionId)) { socket.close(4004, 'Session ended'); return; }
    let display = this.displays.get(sessionId);
    if (display?.socket) { display.socket.sendText(JSON.stringify({ type: 'replaced' })); display.socket.close(4001, 'Opened elsewhere'); }
    if (!display) {
      display = { sessionId, key: sessionId, socket: null, queue: [], nextId: 0, ackTarget: 0, acked: 0, screencast: new Map(),
        sent: { frames: 0, bytes: 0, refinements: 0, keyframes: 0 }, task: Promise.resolve() };
      this.displays.set(sessionId, display);
    }
    display.socket = socket; display.hello = null; display.cursor = null; display.editable = null;
    socket.on('message', (data, binary) => { if (display.socket === socket && !binary) this.message(display, data); });
    socket.on('close', () => { if (display.socket === socket) this.disconnect(display); });
  }

  message(display, data) {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    this.engine.emit('activity');
    switch (message.type) {
      case 'hello': this.control(display, () => this.hello(display, message)); return;
      case 'resize': if (display.hello) this.control(display, () => this.resize(display, message)); return;
      case 'ack': this.ack(display, message.id); return;
      case 'keyframe': if (display.mode === 'video' && display.running) this.call('document', `lopeDisplay.keyframe(${JSON.stringify(display.key)})`).catch(() => {}); return;
      case 'audio':
        display.audio = !!message.enabled && !!display.hello?.audio;
        if (display.mode === 'video' && display.running) this.call('document', `lopeDisplay.audio(${JSON.stringify(display.key)}, ${display.audio})`).catch(() => {});
        return;
      default: this.input(display, message);
    }
  }

  /** Capture changes run one at a time per viewer, in order. */
  control(display, task) {
    display.task = display.task.then(task).catch(error => {
      if (display.socket) display.socket.sendText(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message.slice(0, 200) : 'The display failed.' }));
    });
    return display.task;
  }

  async hello(display, message) {
    const session = this.engine.sessions.get(display.sessionId);
    if (!session || !display.socket) return;
    const codecs = Array.isArray(message.codecs) ? message.codecs.filter(item => typeof item === 'string') : [];
    display.hello = { mac: message.mac === true, touch: message.touch === true, audio: message.audio !== false && !!this.encoders.opus };
    // Pages see the viewer's own time zone and languages, as in the viewer's browser.
    const languages = (Array.isArray(message.languages) ? message.languages : []).filter(item => typeof item === 'string' && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{1,8}){0,3}$/.test(item)).slice(0, 6);
    const timeZone = typeof message.timeZone === 'string' && /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/.test(message.timeZone) && message.timeZone.length <= 64 ? message.timeZone : null;
    session.client = { ...(languages.length ? { languages } : {}), ...(timeZone ? { timeZone } : {}) };
    display.audio = display.hello.audio && message.muted !== true;
    // Private sessions live in DevTools browser contexts, which extensions cannot capture.
    const codec = session.mode === 'private' || !this.video ? null : ['vp9', 'av1', 'h264'].find(name => this.encoders[name] && codecs.includes(name));
    display.mode = codec ? 'video' : 'jpeg'; display.codec = codec ?? 'jpeg';
    await this.stop(display);
    await this.size(display, message);
    await this.capture(display, true);
  }

  async size(display, message) {
    const session = this.engine.sessions.get(display.sessionId);
    const geometry = displayGeometry(message, { maxPixels: this.maxPixels, codec: display.codec });
    display.geometry = geometry;
    session.viewport = { width: geometry.width, height: geometry.height, dsf: geometry.dsf, touch: display.hello.touch };
    await this.engine.applyViewport(session);
  }

  async resize(display, message) {
    const before = display.geometry;
    const next = displayGeometry(message, { maxPixels: this.maxPixels, codec: display.codec });
    if (before && next.width === before.width && next.height === before.height && next.dsf === before.dsf) return;
    await this.size(display, message);
    await this.capture(display, false, true);
  }

  async capture(display, fresh = false, resized = false) {
    const session = this.engine.sessions.get(display.sessionId);
    const tab = session && this.engine.targets.get(session.activeTabId);
    if (!display.socket || !tab || !display.geometry) return;
    if (!fresh && !resized && display.running && display.tabId === tab.id) return;
    const { frameWidth: width, frameHeight: height } = display.geometry;
    const previous = display.tabId;
    display.tabId = tab.id;
    if (display.mode === 'video') {
      const streamId = await this.call('worker', `lopeDisplay.streamId(${JSON.stringify(tab.id)})`);
      if (display.running && !fresh) {
        await this.call('document', `lopeDisplay.retarget(${JSON.stringify(display.key)}, ${JSON.stringify({ streamId, width, height })})`);
      } else {
        await this.call('document', `lopeDisplay.start(${JSON.stringify(display.key)}, ${JSON.stringify({ streamId, width, height,
          codec: display.codec, fps: this.fps, audio: display.audio, firstId: display.nextId + 1 })})`);
      }
    } else {
      if (previous) await this.stopScreencast(display, previous);
      // Chromium sends the next picture only after this one is acknowledged.
      await this.engine.send(tab, 'Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    }
    display.running = true;
    this.send(display, { type: 'config', mode: display.mode, codec: CODEC_STRINGS[display.codec] ?? 'jpeg', width: display.geometry.width,
      height: display.geometry.height, dsf: display.geometry.dsf, frameWidth: width, frameHeight: height, audio: display.mode === 'video' && display.audio });
    const cursor = display.cursor; display.cursor = null;
    if (cursor) this.cursor(tab, cursor);
  }

  async stop(display) {
    clearTimeout(display.refineTimer);
    if (!display.running) return;
    display.running = false;
    if (display.mode === 'video') await this.call('document', `lopeDisplay.stop(${JSON.stringify(display.key)})`).catch(() => {});
    else if (display.tabId) await this.stopScreencast(display, display.tabId);
  }

  async stopScreencast(display, tabId) {
    const tab = this.engine.targets.get(tabId);
    for (const [id, frame] of display.screencast) if (frame.tabId === tabId) display.screencast.delete(id);
    if (tab) await this.engine.send(tab, 'Page.stopScreencast').catch(() => {});
  }

  disconnect(display) {
    display.socket = null; display.queue.length = 0;
    this.control(display, () => this.stop(display));
  }

  /** Session ended (a private session closed): drop its viewer. */
  sessionClosed(sessionId) {
    const display = this.displays.get(sessionId);
    if (!display) return;
    display.socket?.close(4004, 'Session ended');
    this.displays.delete(sessionId);
    void this.stop(display);
  }

  /** The browser selected another tab in this session. */
  activated(session) {
    const display = this.displays.get(session.id);
    if (display?.socket && display.geometry && display.tabId !== session.activeTabId) this.control(display, () => this.capture(display));
  }

  send(display, message) { display.socket?.sendText(JSON.stringify(message)); }

  /** Output from the extension's document: encoded media and capture events. */
  output(payload) {
    let message;
    try { message = JSON.parse(payload); } catch { return; }
    const display = this.displays.get(message?.k);
    if (!display?.socket || display.mode !== 'video') return;
    if (message.t === 'v') {
      if (typeof message.d !== 'string' || !Number.isInteger(message.id)) return;
      const data = Buffer.from(message.d, 'base64');
      const header = Buffer.alloc(12);
      header[0] = VIDEO; header[1] = (message.key ? 1 : 0) | (message.r ? 2 : 0);
      header.writeUInt16BE(message.w & 0xffff, 2); header.writeUInt16BE(message.h & 0xffff, 4); header[6] = message.q & 0xff;
      header.writeUInt32BE(message.id >>> 0, 8);
      display.nextId = Math.max(display.nextId, message.id);
      // Credits bound what is in flight; a socket this far behind has stopped reading.
      if (display.socket.bufferedAmount > 32 * 1024 * 1024) { display.socket.close(4008, 'Viewer stopped reading'); return; }
      display.socket.sendBinary(header, data);
      Object.assign(display.sent, { frames: display.sent.frames + 1, bytes: display.sent.bytes + data.length,
        refinements: display.sent.refinements + (message.r ? 1 : 0), keyframes: display.sent.keyframes + (message.key ? 1 : 0) });
      if (!message.r) {
        // Refine the picture once the screen has been still briefly.
        clearTimeout(display.refineTimer);
        display.refineTimer = setTimeout(() => {
          if (display.running) this.call('document', `lopeDisplay.refine(${JSON.stringify(display.key)})`).catch(() => {});
        }, 220);
        display.refineTimer.unref?.();
      }
    } else if (message.t === 'a') {
      if (!display.audio || typeof message.d !== 'string') return;
      const data = Buffer.from(message.d, 'base64');
      const header = Buffer.alloc(16);
      header[0] = AUDIO; header[1] = message.ch & 0xff; header.writeUInt32BE(message.sr >>> 0, 4); header.writeDoubleBE(Number(message.ts) || 0, 8);
      display.socket.sendBinary(header, data);
    } else if (message.t === 'ended') {
      // The captured tab closed; show whichever tab the session selected next.
      if (display.running) this.control(display, () => this.capture(display, false, true));
    }
  }

  screencastFrame(cdpSession, params) {
    const tab = [...this.engine.targets.values()].find(item => item._cdp === cdpSession);
    if (!tab) return;
    const display = [...this.displays.values()].find(item => item.mode === 'jpeg' && item.running && item.tabId === tab.id && item.socket);
    if (!display) { this.engine.send(tab, 'Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {}); return; }
    const id = ++display.nextId;
    display.screencast.set(id, { tabId: tab.id, frame: params.sessionId });
    const data = Buffer.from(params.data, 'base64');
    const header = Buffer.alloc(12);
    header[0] = JPEG; header.writeUInt16BE(Math.round((params.metadata?.deviceWidth ?? 0) * (display.geometry?.dsf ?? 1)) & 0xffff, 2);
    header.writeUInt16BE(Math.round((params.metadata?.deviceHeight ?? 0) * (display.geometry?.dsf ?? 1)) & 0xffff, 4);
    header.writeUInt32BE(id >>> 0, 8);
    display.socket.sendBinary(header, data);
    Object.assign(display.sent, { frames: display.sent.frames + 1, bytes: display.sent.bytes + data.length });
  }

  ack(display, id) {
    // Only frames this viewer was actually sent can be acknowledged.
    if (!Number.isInteger(id) || id < 1 || id > display.nextId) return;
    if (display.mode === 'jpeg') {
      for (const [frameId, frame] of display.screencast) {
        if (frameId > id) break;
        display.screencast.delete(frameId);
        const tab = this.engine.targets.get(frame.tabId);
        if (tab) this.engine.send(tab, 'Page.screencastFrameAck', { sessionId: frame.frame }).catch(() => {});
      }
      return;
    }
    // Acknowledgements are cumulative; only the newest needs to reach the encoder.
    display.ackTarget = Math.max(display.ackTarget, id);
    if (display.acking) return;
    display.acking = true;
    (async () => {
      try {
        while (display.ackTarget > display.acked && display.running) {
          const target = display.ackTarget; display.acked = target;
          await this.call('document', `lopeDisplay.ack(${JSON.stringify(display.key)}, ${target})`);
        }
      } catch {} finally { display.acking = false; }
    })();
  }

  cursor(tab, value) {
    const cursor = CURSORS.has(value) ? value : 'default';
    const display = [...this.displays.values()].find(item => item.tabId === tab.id && item.socket);
    if (!display || display.cursor === cursor) return;
    display.cursor = cursor; this.send(display, { type: 'cursor', cursor });
  }

  editable(tab, value) {
    const display = [...this.displays.values()].find(item => item.tabId === tab.id && item.socket);
    if (!display || display.editable === !!value) return;
    display.editable = !!value; this.send(display, { type: 'editable', value: !!value });
  }

  input(display, message) {
    const queue = display.queue, last = queue.at(-1);
    // Pointer motion and scrolling merge while Chromium is busy; clicks and keys never do.
    if (message.type === 'mouse' && message.action === 'move' && last?.type === 'mouse' && last.action === 'move') queue[queue.length - 1] = message;
    else if (message.type === 'wheel' && last?.type === 'wheel' && last.modifiers === message.modifiers) {
      last.dx = number(last.dx) + number(message.dx); last.dy = number(last.dy) + number(message.dy); last.x = message.x; last.y = message.y;
    } else if (message.type === 'touch' && message.action === 'move' && last?.type === 'touch' && last.action === 'move') queue[queue.length - 1] = message;
    else queue.push(message);
    if (queue.length > 400) queue.splice(0, queue.length - 400);
    if (!display.draining) void this.drain(display);
  }

  async drain(display) {
    display.draining = true;
    try {
      while (display.queue.length && display.socket) {
        const message = display.queue.shift();
        try { await this.dispatch(display, message); } catch { /* A tab that navigated or closed drops its input. */ }
      }
    } finally { display.draining = false; }
  }

  async dispatch(display, message) {
    const session = this.engine.sessions.get(display.sessionId);
    const tab = session && this.engine.targets.get(session.activeTabId);
    if (!tab) return;
    const send = (method, params) => this.engine.send(tab, method, params);
    const modifiers = integer(message.modifiers, 0, 15);
    const text = typeof message.text === 'string' && message.text.length <= 1_000_000 ? message.text : '';
    switch (message.type) {
      case 'mouse': {
        const type = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' }[message.action];
        if (!type) return;
        await send('Input.dispatchMouseEvent', { type, x: number(message.x, 0, 20000), y: number(message.y, 0, 20000),
          button: BUTTONS.has(message.button) ? message.button : 'none', buttons: integer(message.buttons, 0, 31),
          clickCount: type === 'mouseMoved' ? 0 : integer(message.clicks, 1, 3), modifiers, pointerType: 'mouse' });
        return;
      }
      case 'wheel':
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: number(message.x, 0, 20000), y: number(message.y, 0, 20000),
          deltaX: number(message.dx, -20000, 20000), deltaY: number(message.dy, -20000, 20000), modifiers, pointerType: 'mouse' });
        return;
      case 'touch': {
        const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' }[message.action];
        if (!type) return;
        const points = (Array.isArray(message.points) ? message.points : []).slice(0, 10).map(point => ({
          x: number(point?.x, 0, 20000), y: number(point?.y, 0, 20000), id: integer(point?.id, 0, 1_000_000), radiusX: 4, radiusY: 4, force: 1 }));
        await send('Input.dispatchTouchEvent', { type, touchPoints: points, modifiers });
        return;
      }
      case 'key': await this.key(display, tab, message); return;
      case 'text': if (text) await send('Input.insertText', { text }); return;
      // An input method's in-progress text, then the text it commits.
      case 'composition': await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); return;
      case 'commit':
        if (text) await send('Input.insertText', { text });
        else await send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
        return;
      case 'paste': if (text) await this.paste(tab, text); return;
    }
  }

  async key(display, tab, message) {
    if (message.action !== 'down' && message.action !== 'up') return;
    let event = { key: typeof message.key === 'string' ? message.key.slice(0, 32) : '', code: typeof message.code === 'string' ? message.code.slice(0, 32) : '',
      keyCode: integer(message.keyCode, 0, 255), modifiers: integer(message.modifiers, 0, 15),
      text: typeof message.text === 'string' && message.text.length <= 4 ? message.text : '' };
    if (display.hello?.mac) event = macKey(event);
    const location = integer(message.location, 0, 3);
    const params = { key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode, modifiers: event.modifiers,
      location, isKeypad: location === 3, autoRepeat: message.repeat === true };
    if (message.action === 'up') { await this.engine.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params }); return; }
    const shortcut = (event.modifiers & 2) && !(event.modifiers & 5) && event.key.length === 1 ? event.key.toLowerCase() : null;
    if (shortcut === 'c' || shortcut === 'x') { await this.copy(display, tab, params, shortcut === 'x'); return; }
    const commands = shortcut ? EDIT_COMMANDS[(event.modifiers & 8 ? 'shift+' : '') + shortcut] : null;
    await this.engine.send(tab, 'Input.dispatchKeyEvent', { type: event.text ? 'keyDown' : 'rawKeyDown', ...params,
      ...(event.text ? { text: event.text, unmodifiedText: event.text } : {}), ...(commands ? { commands } : {}) });
  }

  /** Runs the page's own copy, then hands Chromium's clipboard text to the viewer. */
  async copy(display, tab, params, cut) {
    const ready = await this.call('document', `lopeDisplay.clipboard(${JSON.stringify(COPY_SENTINEL)})`).then(() => true, () => false);
    await this.engine.send(tab, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params, commands: [cut ? 'cut' : 'copy'] });
    let text = null;
    for (let attempt = 0; ready && attempt < 6; attempt++) {
      await sleep(attempt ? 40 : 10);
      text = await this.call('document', 'lopeDisplay.clipboard()').catch(() => null);
      if (text !== COPY_SENTINEL) break;
    }
    this.send(display, { type: 'clipboard', text: typeof text === 'string' && text && text !== COPY_SENTINEL ? text.slice(0, 1_000_000) : null });
  }

  /** Places the viewer's text on Chromium's clipboard and pastes it, so the page sees a real paste. */
  async paste(tab, text) {
    const placed = await this.call('document', `lopeDisplay.clipboard(${JSON.stringify(text)})`).then(Boolean, () => false);
    if (!placed) { await this.engine.send(tab, 'Input.insertText', { text }); return; }
    const params = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 };
    await this.engine.send(tab, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params, commands: ['paste'] });
    await this.engine.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }

  async stats(sessionId) {
    const display = this.displays.get(sessionId);
    if (!display) return null;
    const encoder = display.mode === 'video' && display.running
      ? await this.call('document', `lopeDisplay.stats(${JSON.stringify(display.key)})`).catch(() => null) : null;
    return { mode: display.mode, codec: display.codec, geometry: display.geometry ?? null, sent: { ...display.sent }, encoder };
  }

  async close() {
    for (const display of this.displays.values()) { display.socket?.close(1001, 'Browser stopping'); clearTimeout(display.refineTimer); }
    this.displays.clear();
  }
}
