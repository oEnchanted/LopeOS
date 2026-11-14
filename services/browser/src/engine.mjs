import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, realpath, stat } from 'node:fs/promises';
import { release } from 'node:os';
import { join, basename, resolve, sep } from 'node:path';
import { ChromiumPipe } from './cdp.mjs';
import { DisplayHub } from './display.mjs';
import { createEgressProxy } from './network.mjs';
import { PAGE_BINDING, PAGE_SCRIPT, PAGE_WORLD, findExpression } from './page-scripts.mjs';
import { SEARCH_PROVIDERS, destination, safeHostUrl, openedFile, openedFileUrl, openableFileType, OPENED_FILE_DOMAIN, MAX_OPENED_FILE_BYTES } from '../../../packages/browser-client/src/navigation.ts';

// HTML files opened from LopeDrive. Each is answered by request interception on its own
// reserved origin, so it never reaches the network and nothing else on that origin exists.
const OPENED_FILES_PER_SESSION = 20;
const OPENED_BYTES_PER_SESSION = 128 * 1024 * 1024;
const MISSING_FILE_PAGE = Buffer.from(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>File not available</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:34em;margin:4em auto;padding:0 1em"><h1 style="font-size:20px">This file isn’t available</h1>
<p>Lope Browser shows the HTML file you open from Files, but not other files it links to. Files also close when the browser restarts.</p>
<p>Open the file again from Files.</p>`);
// Untitled opened files show their name, not the reserved address Chromium reports.
const pageTitle = (url, title) => { const file = openedFile(url); return file && (!title || title.includes(OPENED_FILE_DOMAIN)) ? file.name : title; };

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico' };
function savedFileName(url, type) {
  const extension = IMAGE_TYPES[String(type).split(';')[0].trim().toLowerCase()];
  let name = 'image';
  if (!url.startsWith('data:')) {
    try { const parsed = new URL(url); name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || parsed.hostname; } catch {}
  }
  if (extension && !/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + extension;
  return name;
}

const id = () => randomUUID();
const internal = tab => tab.url === 'about:blank';
const DIALOG_TYPES = new Set(['alert', 'confirm', 'prompt', 'beforeunload']);
const originOf = url => { try { const value = new URL(url); return /^https?:$/.test(value.protocol) ? value.origin : ''; } catch { return ''; } };
// Headless windows report this much browser frame above the page, like a windowed browser.
const WINDOW_FRAME_HEIGHT = 87;
const cleanName = name => basename(name).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160) || 'download';
const publicTab = tab => Object.fromEntries(Object.entries(tab).filter(([key]) => !key.startsWith('_')));
// Opened files do not outlive the worker, so restarts restore website tabs only.
const restorable = session => {
  const tabs = session.tabs.filter(tab => !openedFile(tab.url));
  return { tabs: tabs.map(t => ({ url: t.url, pinned: t.pinned })), activeIndex: tabs.findIndex(t => t.id === session.activeTabId) };
};

export class BrowserEngine extends EventEmitter {
  sessions = new Map();
  targets = new Map();
  frames = new Map();
  attaching = new Map();
  downloads = new Map();
  uploadRequests = new Map();
  closedTabs = new Map();
  openedFiles = new Map();
  selectContexts = new Map();
  windowSizes = new Map();
  dirty = new Set();
  constructor(options) {
    super(); this.options = options;
    this.profileRoot = resolve(options.dataRoot);
    this.transferRoot = resolve(options.transferRoot || join(this.profileRoot, 'transfers'));
    this.gpuEnabled = options.webgl ?? options.gpu ?? !!process.env.LOPE_BROWSER_GPU;
  }
  async start() {
    this.generation = id();
    await mkdir(this.profileRoot, { recursive: true, mode: 0o700 });
    // Transfers now live on the persistent profile volume; drop leftovers from an earlier run.
    await rm(this.transferRoot, { recursive: true, force: true }).catch(() => {});
    this.normal = this.makeSession('normal', 'normal');
    let saved;
    try { saved = JSON.parse(await readFile(join(this.profileRoot, 'session.json'), 'utf8')); } catch {}
    if (saved?.version === 1) {
      this.normal.history = saved.history ?? []; this.normal.bookmarks = saved.bookmarks ?? [];
      this.normal.searchProvider = ['google', 'bing'].includes(saved.searchProvider) ? saved.searchProvider : 'duckduckgo';
    }
    this.egress = await createEgressProxy({ testOrigins: this.options.testOrigins ?? [] });
    this.cdp = new ChromiumPipe(this.options.executable, {
      profile: join(this.profileRoot, 'chromium'), proxyPort: this.egress.port,
    });
    this.cdp.on('event', packet => { this.onEvent(packet).catch(() => {}); });
    this.cdp.on('disconnected', () => {
      for (const session of this.sessions.values()) { session.status = 'crashed'; this.changed(session); }
    });
    // Chromium does not report document.title changes as Target.targetInfoChanged, so
    // keep each session's active tab title current (unread counts, media titles).
    this.titleTimer = setInterval(() => { this.syncActiveTitles().catch(() => {}); }, 2000);
    this.titleTimer.unref?.();
    // Headless Chromium names itself HeadlessChrome; report the browser it is.
    this.version = (await this.cdp.send('Browser.getVersion')).product.replace(/^HeadlessChrome\//, 'Chrome/');
    const graphics = this.graphics = await this.cdp.graphics().catch(() => null);
    if (graphics?.accelerated) this.gpuEnabled = true;
    // WebGL also runs without a GPU, in SwiftShader. Only Chromium's own "off" states mean none.
    this.webglEnabled = this.gpuEnabled || !/^(disabled|unavailable_off)/.test(graphics?.webgl ?? '');
    this.display = await new DisplayHub(this, this.options.display).start();
    await this.configureContext(this.normal);
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    for (const info of targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('devtools:'))) await this.attach(info);
    if (!this.normal.tabs.length) await this.createTab(this.normal);
    await this.learnClientHints(this.normal.tabs[0]);
    if (saved?.tabs?.length) {
      const first = this.normal.tabs[0];
      const restored = saved.tabs.filter(tab => tab.url === 'about:blank' || safeHostUrl(tab.url)).slice(0, 60);
      for (const [index, tab] of restored.entries()) {
        const target = index === 0 ? first : await this.createTab(this.normal, 'about:blank', { activate: false });
        target.pinned = !!tab.pinned;
        // Restoring a session must not fetch every old website before the worker
        // can accept a connection. Keep background tabs dormant until selected.
        if (tab.url !== 'about:blank') {
          target._pendingUrl = target.url = tab.url;
          target.title = this.normal.history.find(item => item.url === tab.url)?.title || new URL(tab.url).hostname;
        }
      }
      const active = this.normal.tabs[Math.max(0, Math.min(saved.activeIndex ?? 0, this.normal.tabs.length - 1))];
      await this.activate(this.normal, active);
    }
    this.normal.status = 'ready'; this.changed(this.normal);
    return this;
  }
  makeSession(mode, sessionId = id(), contextId) {
    const session = { revision: 0, id: sessionId, mode, contextId, status: 'connecting', tabs: [], activeTabId: null,
      history: [], bookmarks: [], downloads: [], uploads: [], permissions: [], searchProvider: 'duckduckgo' };
    this.sessions.set(sessionId, session); this.closedTabs.set(sessionId, []);
    return session;
  }
  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Browser session not found.');
    return session;
  }
  snapshot(sessionId) {
    const session = this.get(sessionId);
    const display = this.display, video = !!display?.video && session.mode !== 'private';
    return { ...session, generation: this.generation, contextId: undefined, viewport: undefined, client: undefined, tabs: session.tabs.map(publicTab), engineVersion: this.version,
      streamUrl: display ? `/api/browser/sessions/${encodeURIComponent(session.id)}/stream` : null,
      capabilities: { stream: !!display, audio: video && !!display.encoders.opus, display: video ? 'video' : 'jpeg',
        deviceForwarding: false, workspaceFiles: !!this.options.files, webgl: !!this.webglEnabled, opengl: this.gpuEnabled } };
  }
  changed(session) {
    session.revision++;
    if (session.mode === 'normal' && session.tabs.length) this.restoreTabs = restorable(session);
    // Coalesce bursts (a page load changes state many times) into one snapshot per session.
    this.dirty.add(session.id);
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null; const ids = [...this.dirty]; this.dirty.clear();
      for (const sessionId of ids) if (this.sessions.has(sessionId)) this.emit('state', this.snapshot(sessionId));
    }, 20);
    if (session.mode === 'normal' && !this.stopping) {
      clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.persist().catch(() => {}), 250);
    }
  }
  async persist() {
    // Serial writes prevent an older navigation snapshot replacing a newer one.
    this.saveTask = (this.saveTask ?? Promise.resolve()).catch(() => {}).then(async () => {
      const s = this.normal;
      // Browser shutdown can destroy every target before pipe disconnect. Preserve the
      // last nonempty list so a restart restores tabs instead of persisting teardown.
      const restored = s.tabs.length ? restorable(s) : this.restoreTabs ?? { tabs: [], activeIndex: 0 };
      const data = { version: 1, ...restored, history: s.history,
        bookmarks: s.bookmarks, searchProvider: s.searchProvider };
      const path = join(this.profileRoot, 'session.json');
      await writeFile(path + '.tmp', JSON.stringify(data), { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    await this.saveTask;
  }
  async configureContext(session) {
    const dir = join(this.transferRoot, session.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir,
      eventsEnabled: true, ...(session.contextId ? { browserContextId: session.contextId } : {}) });
    // Forwarding is not verified: never grant remote sites access to a local device.
    await Promise.all(['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'clipboard-write'].map(name =>
      this.cdp.send('Browser.setPermission', { permission: { name }, setting: 'denied',
        ...(session.contextId ? { browserContextId: session.contextId } : {}) })
    ));
  }
  async createPrivate() {
    if ([...this.sessions.values()].filter(s => s.mode === 'private').length >= 3) throw new Error('Close a private session before opening another.');
    const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const session = this.makeSession('private', id(), browserContextId);
    await this.configureContext(session);
    await this.createTab(session); session.status = 'ready'; this.changed(session);
    return this.snapshot(session.id);
  }
  async destroy(sessionId) {
    const session = this.get(sessionId);
    if (session.mode !== 'private') throw new Error('Use clear browsing data to erase the normal profile.');
    this.display?.sessionClosed(sessionId);
    for (const transfer of session.downloads) this.downloads.get(transfer.id)?.abort?.abort();
    // First close engine contexts; then remove all staging and in-memory private state.
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: session.contextId });
    for (const tab of session.tabs) this.targets.delete(tab.id);
    for (const [key, item] of this.uploadRequests) if (item.sessionId === sessionId) this.uploadRequests.delete(key);
    for (const [key, item] of this.downloads) if (item.sessionId === sessionId) this.downloads.delete(key);
    for (const [key, item] of this.openedFiles) if (item.sessionId === sessionId) this.openedFiles.delete(key);
    this.sessions.delete(sessionId); this.closedTabs.delete(sessionId);
    await rm(join(this.transferRoot, sessionId), { recursive: true, force: true });
    await this.activate(this.normal, this.normal.tabs[0]);
  }
  async attach(info) {
    if (this.attaching.has(info.targetId)) return this.attaching.get(info.targetId);
    if (this.targets.has(info.targetId)) return this.targets.get(info.targetId);
    const promise = this.attachTarget(info);
    this.attaching.set(info.targetId, promise);
    try { return await promise; } finally { this.attaching.delete(info.targetId); }
  }
  async attachTarget(info) {
    // Extension pages (the display helper) are never browser tabs.
    if (info.type !== 'page' || info.url.startsWith('devtools:') || info.url.startsWith('chrome-extension:')) return;
    const owner = [...this.sessions.values()].find(s => s.contextId && s.contextId === info.browserContextId);
    if (!owner && this.defaultContextId && info.browserContextId && this.defaultContextId !== info.browserContextId) return;
    const session = owner ?? this.normal;
    if (session === this.normal) this.defaultContextId ??= info.browserContextId;
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    const tab = { id: info.targetId, url: info.url, title: info.title || 'New Tab', pinned: false,
      loading: false, canGoBack: false, canGoForward: false, zoom: 1,
      ...(info.openerId ? { openerId: info.openerId } : {}), _cdp: sessionId, _session: session.id };
    this.targets.set(tab.id, tab); session.tabs.push(tab);
    if (!session.activeTabId) session.activeTabId = tab.id;
    await this.send(tab, 'Page.enable');
    await this.send(tab, 'Runtime.enable');
    await this.send(tab, 'Page.setInterceptFileChooserDialog', { enabled: true });
    await this.send(tab, 'Security.enable');
    const { frameTree } = await this.send(tab, 'Page.getFrameTree');
    const remember = tree => { this.frames.set(tree.frame.id, tab.id); for (const child of tree.childFrames ?? []) remember(child); };
    remember(frameTree); tab._frame = frameTree.frame.id;
    await this.send(tab, 'Runtime.addBinding', { name: PAGE_BINDING, executionContextName: PAGE_WORLD }).catch(() => {});
    await this.send(tab, 'Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SCRIPT, worldName: PAGE_WORLD }).catch(() => {});
    await this.inPage(tab, PAGE_SCRIPT).catch(() => {});
    await this.present(tab, session);
    if (info.openerId) { await this.activate(session, tab); }
    await this.refresh(tab); this.changed(session); return tab;
  }
  /** Reads the brand list Chromium itself reports, so client hints stay genuine. */
  async learnClientHints(tab) {
    if (!tab || !this.cdp.userAgent || this.clientHints) return;
    const { result } = await this.send(tab, 'Runtime.evaluate', { expression: 'JSON.stringify(navigator.userAgentData?.brands ?? [])', returnByValue: true }).catch(() => ({}));
    let brands = [];
    try { brands = JSON.parse(result?.value ?? '[]').filter(item => typeof item?.brand === 'string' && typeof item?.version === 'string'); } catch {}
    if (!brands.length) return;
    const full = this.cdp.fullVersion ?? '';
    const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
    this.clientHints = { brands, fullVersion: full, platform, platformVersion: /^\d+\.\d+\.\d+/.exec(release())?.[0] ?? '',
      fullVersionList: brands.map(item => ({ brand: item.brand, version: /Chrom/.test(item.brand) && full ? full : item.version + '.0.0.0' })),
      architecture: process.arch === 'arm64' ? 'arm' : 'x86', bitness: '64', model: '', mobile: false, wow64: false };
    for (const session of this.sessions.values()) for (const item of session.tabs) { item._identity = null; await this.present(item, session); }
  }
  /** Applies what the viewer's own browser would present: viewport, density, language, time zone and genuine client hints. */
  async present(tab, session = this.sessions.get(tab._session)) {
    if (!session || !this.targets.has(tab.id)) return;
    const viewport = session.viewport, client = session.client ?? {};
    const identity = JSON.stringify([this.clientHints ? 1 : 0, client.languages ?? null]);
    if (this.cdp.userAgent && tab._identity !== identity) {
      tab._identity = identity;
      await this.send(tab, 'Emulation.setUserAgentOverride', { userAgent: this.cdp.userAgent,
        platform: process.platform === 'darwin' ? 'MacIntel' : process.platform === 'win32' ? 'Win32' : 'Linux x86_64',
        ...(client.languages?.length ? { acceptLanguage: client.languages.join(',') } : {}), ...(this.clientHints ? { userAgentMetadata: this.clientHints } : {}) }).catch(() => { tab._identity = null; });
    }
    if (client.timeZone && tab._timeZone !== client.timeZone) {
      tab._timeZone = client.timeZone;
      await this.send(tab, 'Emulation.setTimezoneOverride', { timezoneId: client.timeZone }).catch(() => {});
    }
    if (client.languages?.[0] && tab._locale !== client.languages[0]) {
      tab._locale = client.languages[0];
      await this.send(tab, 'Emulation.setLocaleOverride', { locale: client.languages[0] }).catch(() => {});
    }
    if (!viewport) return;
    const key = `${viewport.width}x${viewport.height}@${viewport.dsf}`;
    if (tab._viewport !== key) {
      tab._viewport = key;
      await this.send(tab, 'Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dsf,
        mobile: false, screenWidth: viewport.width, screenHeight: viewport.height }).catch(() => { tab._viewport = null; });
      // Keep window.outer* consistent with the page, as a windowed browser's would be.
      const { windowId } = await this.cdp.send('Browser.getWindowForTarget', { targetId: tab.id }).catch(() => ({}));
      if (windowId && this.windowSizes.get(windowId) !== key) {
        this.windowSizes.set(windowId, key);
        await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: viewport.width, height: viewport.height + WINDOW_FRAME_HEIGHT } }).catch(() => {});
      }
    }
    if (tab._touch !== !!viewport.touch) {
      tab._touch = !!viewport.touch;
      await this.send(tab, 'Emulation.setTouchEmulationEnabled', { enabled: !!viewport.touch, ...(viewport.touch ? { maxTouchPoints: 5 } : {}) }).catch(() => {});
    }
  }
  /** Presents every tab of a session for its viewer. */
  async applyViewport(session) {
    await Promise.all(session.tabs.map(tab => this.present(tab, session)));
  }
  send(tab, method, params = {}) { return this.cdp.send(method, params, tab._cdp); }
  /** Evaluates LopeOS code in the page's isolated world, out of reach of page scripts. */
  async inPage(tab, expression) {
    const { executionContextId } = await this.send(tab, 'Page.createIsolatedWorld', { frameId: tab._frame, worldName: PAGE_WORLD });
    const { result, exceptionDetails } = await this.send(tab, 'Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true });
    if (exceptionDetails) throw new Error('The page could not run this action.');
    return result?.value;
  }
  async createTab(session, url = 'about:blank', { activate = true } = {}) {
    if (session.tabs.length >= 60) throw new Error('This session has reached its 60-tab limit.');
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank', background: !activate,
      ...(session.contextId ? { browserContextId: session.contextId } : {}) });
    const { targetInfo } = await this.cdp.send('Target.getTargetInfo', { targetId });
    const tab = await this.attach(targetInfo);
    if (activate) await this.activate(session, tab);
    if (url !== 'about:blank') await this.navigate(session, tab, url);
    return tab;
  }
  async activate(session, tab) {
    if (!tab) return;
    await this.cdp.send('Target.activateTarget', { targetId: tab.id });
    session.activeTabId = tab.id; session.contextMenu = null; session.selectMenu = null; this.foreground = session.id; this.changed(session);
    this.display?.activated(session);
    if (tab._pendingUrl) {
      const url = tab._pendingUrl;
      // Activation is immediate even if this site's first response takes seconds.
      // Loading/errors still arrive through the normal engine state events.
      void this.navigate(session, tab, url).catch(() => {});
    }
  }
  async closeTab(tab) {
    // Page.close respects beforeunload; retry while navigation replaces the active
    // renderer. Target.closeTarget can acknowledge success here but strand the tab.
    const until = Date.now() + 5000;
    while (this.targets.has(tab.id) && Date.now() < until) {
      try { await this.send(tab, 'Page.close'); }
      catch (error) {
        if (this.targets.has(tab.id) && !/Not attached to an active page/.test(error.message)) throw error;
      }
      if (!this.targets.has(tab.id)) return;
      await new Promise(resolve => {
        const done = event => { if (!event || event.targetId === tab.id) { clearTimeout(timer); this.cdp.off('Target.targetDestroyed', done); resolve(); } };
        const timer = setTimeout(done, 100); this.cdp.on('Target.targetDestroyed', done);
      });
    }
    if (this.targets.has(tab.id)) throw new Error('This tab could not close. Finish any page dialog and try again.');
  }
  async refresh(tab) {
    if (!this.targets.has(tab.id) || tab._pendingUrl || tab._navigationUrl) return;
    const session = this.sessions.get(tab._session); if (!session) return;
    const navigation = tab._navigation, document = tab._document;
    const current = () => this.targets.has(tab.id) && !tab._pendingUrl && !tab._navigationUrl &&
      tab._navigation === navigation && tab._document === document;
    const history = await this.send(tab, 'Page.getNavigationHistory').catch(() => null);
    if (!current()) return;
    if (history) {
      tab.canGoBack = history.currentIndex > 0;
      tab.canGoForward = history.currentIndex < history.entries.length - 1;
      const current = history.entries[history.currentIndex];
      if (current) { tab.url = current.url; tab.title = pageTitle(tab.url, current.title) || tab.title; }
    }
    const metrics = await this.send(tab, 'Page.getLayoutMetrics').catch(() => null);
    if (!current()) return;
    if (metrics?.visualViewport) tab.zoom = metrics.visualViewport.scale;
    const { result } = await this.send(tab, 'Runtime.evaluate', { expression:
      `({title:document.title,icon:document.querySelector('link[rel~="icon"]')?.href})`, returnByValue: true }).catch(() => ({}));
    if (!current()) return;
    if (result?.value) { tab.title = result.value.title || (internal(tab) ? 'New Tab' : pageTitle(tab.url, '') || tab.url);
      // Do not make the host browser fetch website favicons and leak its network identity.
      const icon = result.value.icon;
      if (icon && tab._frame) {
        const resource = await this.send(tab, 'Page.getResourceContent', { frameId: tab._frame, url: icon }).catch(() => null);
        if (!current()) return;
        if (resource?.base64Encoded && resource.content.length < 128000 && /\.(?:png|ico|jpe?g|webp)(?:[?#]|$)/i.test(icon)) {
          tab.favicon = `data:image/${/\.ico(?:[?#]|$)/i.test(icon) ? 'x-icon' : /\.png(?:[?#]|$)/i.test(icon) ? 'png' : /\.webp(?:[?#]|$)/i.test(icon) ? 'webp' : 'jpeg'};base64,${resource.content}`;
        }
      } }
    this.changed(session);
  }
  async navigate(session, tab, input) {
    const url = destination(input, session.searchProvider);
    delete tab._pendingUrl;
    // Only tabs that show an opened file pay for request interception.
    if (openedFile(url)) await this.interceptOpenedFiles(tab);
    const navigation = tab._navigation = id();
    tab._navigationUrl = tab.url = url;
    tab.error = undefined; tab.loading = true; this.changed(session);
    let result;
    try { result = await this.send(tab, 'Page.navigate', { url }); }
    catch (error) {
      if (tab._navigation === navigation && this.targets.has(tab.id) && !this.stopping) {
        delete tab._navigationUrl; tab.loading = false;
        tab.error = { kind: 'navigation', message: error.message }; this.changed(session);
      }
      throw error;
    }
    if (tab._navigation !== navigation || !this.targets.has(tab.id) || this.stopping) return;
    if (result.errorText === 'net::ERR_ABORTED') {
      delete tab._navigationUrl; tab.loading = false;
      // The address before this request may itself have been provisional.
      // Ask Chromium which page survived cancellation instead of restoring it.
      await this.refresh(tab);
    }
    if (result.errorText && result.errorText !== 'net::ERR_ABORTED') {
      delete tab._navigationUrl;
      tab.error = { kind: /CERT|SSL/.test(result.errorText) ? 'certificate' : 'navigation', message: result.errorText };
      tab.loading = false; this.changed(session);
    }
  }
  /** Shows an HTML file the user opened from LopeDrive. The client sends only that file's bytes. */
  async openFile(sessionId, { name, bytes }) {
    const session = this.get(sessionId);
    const clean = cleanName(name || '');
    const type = openableFileType(clean);
    if (!type) throw new Error('Lope Browser can open HTML files (.html, .htm or .xhtml).');
    if (bytes.length > MAX_OPENED_FILE_BYTES) throw new Error('Lope Browser can open HTML files up to 32 MB.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    // Opening an unchanged file again, including when LopeOS restores its windows, shows the tab that has it.
    const same = [...this.openedFiles.values()].find(file => file.sessionId === sessionId && file.name === clean && file.hash === hash);
    const shown = same && session.tabs.find(tab => tab.url === same.url);
    if (shown) { await this.activate(session, shown); return this.snapshot(sessionId); }
    let charset = '';
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); charset = '; charset=utf-8'; } catch { /* Let the page or Chromium choose. */ }
    const fileId = id(), directory = join(this.transferRoot, sessionId, 'opened');
    const file = { id: fileId, sessionId, name: clean, hash, size: bytes.length, type: type + charset,
      url: openedFileUrl(fileId, clean), path: join(directory, fileId) };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(file.path, bytes, { flag: 'wx', mode: 0o600 });
    this.openedFiles.set(fileId, file);
    const mine = [...this.openedFiles.values()].filter(item => item.sessionId === sessionId);
    let count = mine.length, total = mine.reduce((sum, item) => sum + item.size, 0);
    for (const item of mine) {
      if (item === file || (count <= OPENED_FILES_PER_SESSION && total <= OPENED_BYTES_PER_SESSION)) break;
      await this.forgetFile(item); count--; total -= item.size;
    }
    const active = session.tabs.find(tab => tab.id === session.activeTabId);
    if (active && internal(active) && !active.loading) await this.navigate(session, active, file.url);
    else await this.createTab(session, file.url);
    return this.snapshot(sessionId);
  }
  async forgetFile(file) {
    this.openedFiles.delete(file.id);
    await rm(file.path, { force: true }).catch(() => {});
    // The file's own origin may have kept site data in the persistent profile. Chromium
    // clears it only through a page session in that profile, not the browser target.
    const tab = this.sessions.get(file.sessionId)?.mode === 'normal' && this.normal.tabs.find(item => this.targets.has(item.id));
    if (tab) await this.send(tab, 'Storage.clearDataForOrigin', { origin: new URL(file.url).origin, storageTypes: 'all' }).catch(() => {});
  }
  async interceptOpenedFiles(tab) {
    tab._openedFiles ??= this.send(tab, 'Fetch.enable', { patterns: [{ urlPattern: `*://*.${OPENED_FILE_DOMAIN}/*`, requestStage: 'Request' }] })
      .catch(error => { tab._openedFiles = null; throw error; });
    await tab._openedFiles;
  }
  async serveOpenedFile(tab, { requestId, request, frameId, resourceType }) {
    const fulfill = (responseCode, type, body) => this.send(tab, 'Fetch.fulfillRequest', { requestId, responseCode, body: body.toString('base64'),
      responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' },
        { name: 'Referrer-Policy', value: 'no-referrer' }, { name: 'X-Content-Type-Options', value: 'nosniff' }] });
    try {
      const target = openedFile(request.url), file = target && this.openedFiles.get(target.id);
      const page = resourceType === 'Document' && (frameId === tab._frame || frameId === tab.id);
      // Serve only the opened file itself, as a top-level page of the session that opened it.
      if (page && file && file.sessionId === tab._session && request.method === 'GET' && new URL(request.url).pathname === new URL(file.url).pathname) {
        await fulfill(200, file.type, await readFile(file.path)); return;
      }
      await fulfill(404, page ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', page ? MISSING_FILE_PAGE : Buffer.alloc(0));
    } catch { await this.send(tab, 'Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {}); }
  }
  /** Reports from LopeOS's isolated page script: menus, list pickers, the pointer's cursor and text focus. */
  pageMessage(cdpSession, payload, contextId) {
    const tab = [...this.targets.values()].find(item => item._cdp === cdpSession); if (!tab) return;
    const session = this.sessions.get(tab._session); if (!session || session.activeTabId !== tab.id) return;
    let value; try { value = JSON.parse(payload); } catch { return; }
    if (value?.type === 'cursor') this.display?.cursor(tab, value.cursor);
    else if (value?.type === 'editable') this.display?.editable(tab, value.value === true);
    else if (value?.type === 'select') this.openSelect(tab, session, value, contextId);
    else this.openContextMenu(tab, session, value);
  }
  /** Chromium draws a list's popup outside the page, where tab capture cannot see it; LopeOS draws it instead. */
  openSelect(tab, session, value, contextId) {
    const position = n => Number.isFinite(n) ? Math.round(Math.max(-20000, Math.min(20000, n))) : 0;
    const options = (Array.isArray(value.options) ? value.options : []).slice(0, 1000).map((option, index) => ({ index,
      label: String(option?.label ?? '').replace(/\s+/g, ' ').slice(0, 300), disabled: option?.disabled === true,
      group: typeof option?.group === 'string' ? option.group.slice(0, 200) : '' }));
    if (!options.length || !Number.isInteger(contextId)) return;
    for (const [menuId, context] of this.selectContexts) if (context.sessionId === session.id) this.selectContexts.delete(menuId);
    session.selectMenu = { id: id(), tabId: tab.id, x: position(value.x), y: position(value.y), width: position(value.w), height: position(value.h),
      viewportWidth: position(value.width), viewportHeight: position(value.height), selectedIndex: Number.isInteger(value.selected) ? value.selected : -1, options };
    this.selectContexts.set(session.selectMenu.id, { sessionId: session.id, tabId: tab.id, contextId });
    this.changed(session);
  }
  openContextMenu(tab, session, value) {
    const number = n => Number.isFinite(n) && n >= 0 && n <= 20000 ? Math.round(n) : null;
    const [x, y, width, height] = [value.x, value.y, value.width, value.height].map(number);
    const link = typeof value.link === 'string' && value.link.length <= 8192 && /^https?:\/\//i.test(value.link) ? value.link : null;
    const image = typeof value.image === 'string' && value.image.length <= 8192 && /^(https?:\/\/|data:image\/)/i.test(value.image) ? value.image : null;
    const selection = typeof value.selection === 'string' && value.selection.trim() ? value.selection.slice(0, 20000) : null;
    if (x === null || y === null || !width || !height) return;
    session.contextMenu = { id: id(), tabId: tab.id, x, y, width, height, link, image, selection, editable: value.editable === true };
    this.changed(session);
  }
  takeContextMenu(session, menuId) {
    const menu = session.contextMenu; session.contextMenu = null;
    if (!menu || menu.id !== menuId) throw new Error('That menu is no longer available. Right-click again.');
    return menu;
  }
  async saveUrl(session, tabId, url) {
    const tab = this.targets.get(tabId);
    if (!tab || tab._session !== session.id) throw new Error('This tab is no longer available.');
    let bytes, type = '';
    if (url.startsWith('data:')) {
      const match = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(url);
      if (!match) throw new Error('This image cannot be saved.');
      type = match[1]; bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
    } else {
      // The page's own network stack fetches it: same cookies, cache and egress rules as the page.
      const { resource } = await this.send(tab, 'Network.loadNetworkResource', { frameId: tab._frame, url, options: { disableCache: false, includeCredentials: true } });
      if (!resource?.success || !resource.stream) throw new Error('This file could not be downloaded.');
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const part = await this.send(tab, 'IO.read', { handle: resource.stream, size: 1048576 });
          const chunk = Buffer.from(part.data ?? '', part.base64Encoded ? 'base64' : 'utf8');
          size += chunk.length;
          if (size > 256 * 1024 * 1024) throw new Error('Downloads are limited to 256 MiB.');
          chunks.push(chunk); if (part.eof) break;
        }
      } finally { await this.send(tab, 'IO.close', { handle: resource.stream }).catch(() => {}); }
      bytes = Buffer.concat(chunks);
      type = Object.entries(resource.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
    }
    const guid = id(); this.downloadStarted({ guid, frameId: tab._frame, suggestedFilename: savedFileName(url, type) });
    const item = this.downloads.get(guid); if (!item) throw new Error('This session has too many downloads.');
    await mkdir(join(this.transferRoot, session.id), { recursive: true, mode: 0o700 });
    await writeFile(item.path, bytes, { mode: 0o600 });
    item.transfer.receivedBytes = item.transfer.totalBytes = bytes.length;
    await this.completeDownload(item, session);
  }
  async onEvent({ method, params, sessionId }) {
    if (method === 'Runtime.bindingCalled') {
      if (this.display?.sessionFor(sessionId)) { if (params.name === 'lopeDisplayOutput') this.display.output(params.payload); }
      else if (params.name === PAGE_BINDING) this.pageMessage(sessionId, params.payload, params.executionContextId);
      return;
    }
    if (method === 'Page.screencastFrame') { this.display?.screencastFrame(sessionId, params); return; }
    if (method === 'Target.targetCreated') { await this.attach(params.targetInfo); return; }
    if (method === 'Target.targetInfoChanged') {
      const tab = this.targets.get(params.targetInfo.targetId);
      if (tab && !tab._pendingUrl && !tab._navigationUrl) { tab.url = params.targetInfo.url; tab.title = pageTitle(tab.url, params.targetInfo.title) || tab.title;
        this.changed(this.get(tab._session)); }
      return;
    }
    if (method === 'Target.targetDestroyed') {
      this.display?.targetDestroyed(params.targetId);
      const tab = this.targets.get(params.targetId); if (!tab) return;
      const session = this.sessions.get(tab._session); this.targets.delete(tab.id);
      if (session?.selectMenu?.tabId === tab.id) session.selectMenu = null;
      for (const [frame, tabId] of this.frames) if (tabId === tab.id) this.frames.delete(frame);
      if (session) { session.tabs = session.tabs.filter(t => t.id !== tab.id);
        session.uploads = session.uploads.filter(item => item.tabId !== tab.id);
        for (const [key, item] of this.uploadRequests) if (item.tabId === tab.id) this.uploadRequests.delete(key);
        if (session.activeTabId === tab.id) { session.activeTabId = session.tabs[0]?.id ?? null;
          if (session.tabs[0] && !this.stopping) await this.activate(session, session.tabs[0]); }
        this.changed(session); }
      return;
    }
    if (method === 'Target.targetCrashed') {
      const tab = this.targets.get(params.targetId);
      if (tab) { tab.error = { kind: 'crashed', message: 'This page stopped responding. Reload to try again.' };
        tab.loading = false; this.changed(this.get(tab._session)); } return;
    }
    if (method === 'Browser.downloadWillBegin') { this.downloadStarted(params); return; }
    if (method === 'Browser.downloadProgress') { await this.downloadProgress(params); return; }
    const tab = [...this.targets.values()].find(t => t._cdp === sessionId); if (!tab) return;
    if (method === 'Fetch.requestPaused') { await this.serveOpenedFile(tab, params); return; }
    const session = this.sessions.get(tab._session); if (!session) return;
    // Chromium's own dialog boxes are not part of the page; LopeOS shows them and answers for the person.
    if (method === 'Page.javascriptDialogOpening') {
      tab.dialog = { id: id(), type: DIALOG_TYPES.has(params.type) ? params.type : 'alert', message: String(params.message ?? '').slice(0, 5000),
        defaultPrompt: String(params.defaultPrompt ?? '').slice(0, 5000), origin: originOf(params.url) };
      this.changed(session); return;
    }
    if (method === 'Page.javascriptDialogClosed') { if (tab.dialog) { tab.dialog = undefined; this.changed(session); } return; }
    if (method === 'Page.frameNavigated') this.frames.set(params.frame.id, tab.id);
    if (method === 'Page.frameAttached') this.frames.set(params.frameId, tab.id);
    if (method === 'Page.frameDetached') this.frames.delete(params.frameId);
    // The actual target behind a dormant restored tab is still about:blank.
    // Its late lifecycle events must not replace the saved address/title.
    if (tab._pendingUrl) return;
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      tab._document = (tab._document ?? 0) + 1;
      delete tab._navigationUrl;
      tab._frame = params.frame.id; tab.url = params.frame.url; tab.find = undefined;
      if (session.contextMenu?.tabId === tab.id) session.contextMenu = null;
      if (session.selectMenu?.tabId === tab.id) session.selectMenu = null;
      if (!params.frame.unreachableUrl) tab.error = undefined;
      await this.refresh(tab);
    }
    if (method === 'Page.navigatedWithinDocument' && !tab._navigationUrl) { tab.url = params.url; await this.refresh(tab); this.visit(session, tab); }
    if (method === 'Page.frameStartedLoading' && (!tab._frame || params.frameId === tab._frame)) {
      tab.loading = true; this.changed(session);
    }
    if (method === 'Page.frameStoppedLoading' && !tab._navigationUrl && (!tab._frame || params.frameId === tab._frame)) {
      tab.loading = false; await this.refresh(tab); this.visit(session, tab);
    }
    if (method === 'Page.fileChooserOpened') {
      const request = { id: id(), tabId: tab.id, multiple: params.mode === 'selectMultiple' };
      this.uploadRequests.set(request.id, { ...request, nodeId: params.backendNodeId, sessionId: session.id });
      session.uploads.push(request); this.changed(session);
    }
    if (method === 'Security.visibleSecurityStateChanged' && params.visibleSecurityState.certificateSecurityState?.certificateNetworkError) {
      tab.error = { kind: 'certificate', message: 'Chromium could not verify this website’s certificate.' }; this.changed(session);
    }
  }
  visit(session, tab) {
    if (!safeHostUrl(tab.url) || session.history[0]?.url === tab.url) return;
    session.history.unshift({ id: id(), url: tab.url, title: tab.title, visitedAt: Date.now() });
    session.history = session.history.slice(0, 2000); this.changed(session);
  }
  downloadStarted(event) {
    const tab = this.targets.get(this.frames.get(event.frameId));
    if (!tab) { this.cdp.send('Browser.cancelDownload', { guid: event.guid }).catch(() => {}); return; }
    const session = this.get(tab._session);
    if (session.downloads.length >= 100) { this.cdp.send('Browser.cancelDownload', { guid: event.guid,
      ...(session.contextId ? { browserContextId: session.contextId } : {}) }).catch(() => {}); return; }
    const transfer = { id: event.guid, name: cleanName(event.suggestedFilename), receivedBytes: 0, totalBytes: 0, state: 'progress' };
    session.downloads.unshift(transfer);
    this.downloads.set(event.guid, { transfer, sessionId: session.id, path: join(this.transferRoot, session.id, event.guid) });
    this.changed(session);
  }
  async downloadProgress(event) {
    const item = this.downloads.get(event.guid); if (!item) return;
    const session = this.sessions.get(item.sessionId); if (!session) return;
    Object.assign(item.transfer, { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes });
    if (event.receivedBytes > 256 * 1024 * 1024 || event.totalBytes > 256 * 1024 * 1024) {
      await this.cdp.send('Browser.cancelDownload', { guid: event.guid, ...(session.contextId ? { browserContextId: session.contextId } : {}) }).catch(() => {});
      item.transfer.state = 'canceled'; item.transfer.error = 'Downloads are limited to 256 MiB.'; this.changed(session); return;
    }
    if (event.state === 'canceled') item.transfer.state = 'canceled';
    if (event.state === 'completed' && item.transfer.state === 'progress') await this.completeDownload(item, session);
    this.changed(session);
  }
  async completeDownload(item, session) {
    if (!this.options.files) { item.transfer.state = 'completed'; return; }
    item.transfer.state = 'importing'; item.abort = new AbortController(); this.changed(session);
    try {
      const { fileId } = await this.options.files.importDownload({ sessionId: session.id, transferId: item.transfer.id,
        name: item.transfer.name, path: item.path, signal: item.abort.signal });
      if (item.abort.signal.aborted) return;
      item.transfer.fileId = fileId; item.transfer.state = 'completed';
      await rm(item.path, { force: true });
    } catch (error) { if (!item.abort.signal.aborted) { item.transfer.state = 'failed'; item.transfer.error = error instanceof Error ? error.message : 'Could not save this file to Downloads.'; } }
  }
  async upload(sessionId, requestId, files) {
    const request = this.uploadRequests.get(requestId);
    if (!request || request.sessionId !== sessionId) throw new Error('This file chooser is no longer available.');
    if (!files.length || files.length > (request.multiple ? 20 : 1)) throw new Error('Select the allowed number of files.');
    const tab = this.targets.get(request.tabId); if (!tab) throw new Error('The upload tab was closed.');
    const directory = join(this.transferRoot, sessionId, 'uploads', requestId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const paths = [];
    for (const [index, file] of files.entries()) {
      const target = join(directory, `${index}-${cleanName(file.name || 'selected-file')}`);
      if (file.fileId) {
        if (!this.options.files) throw new Error('Workspace files are not connected.');
        const result = await this.options.files.materializeUpload({ sessionId, fileId: file.fileId, destination: directory });
        const actual = await realpath(result.path);
        if (!actual.startsWith((await realpath(directory)) + sep) || !(await stat(actual)).isFile()) throw new Error('File bridge returned an invalid path.');
        paths.push(actual);
      } else if (file.path) {
        // Staged by the server under this session's staging folder; move it, never copy it.
        const actual = await realpath(file.path);
        if (!actual.startsWith((await realpath(join(this.transferRoot, sessionId, 'staged'))) + sep)) throw new Error('Invalid staged upload.');
        await rename(actual, target); paths.push(target);
      } else { await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 }); paths.push(target); }
    }
    await this.send(tab, 'DOM.setFileInputFiles', { files: paths, backendNodeId: request.nodeId });
    this.uploadRequests.delete(requestId);
    const session = this.get(sessionId); session.uploads = session.uploads.filter(r => r.id !== requestId); this.changed(session);
  }
  async restart(erase = false) {
    const revision = this.normal.revision;
    await this.close();
    if (erase) { await rm(join(this.transferRoot, 'normal'), { recursive: true, force: true }); await rm(this.profileRoot, { recursive: true, force: true }); }
    this.sessions.clear(); this.targets.clear(); this.frames.clear(); this.attaching.clear();
    this.downloads.clear(); this.uploadRequests.clear(); this.closedTabs.clear(); this.openedFiles.clear(); this.defaultContextId = null;
    this.selectContexts.clear(); this.windowSizes.clear(); this.clientHints = null; this.display = null;
    this.stopping = false; this.normal = null;
    await this.start(); this.normal.revision = Math.max(this.normal.revision, revision + 1); this.changed(this.normal);
    return this.snapshot('normal');
  }
  async command(sessionId, command) {
    const session = this.get(sessionId);
    const tab = command.tabId ? session.tabs.find(t => t.id === command.tabId) : null;
    if (command.tabId && !tab) throw new Error('This tab is no longer available.');
    switch (command.type) {
      case 'engine.restart': return this.restart();
      case 'tab.create': await this.createTab(session, command.url ? destination(command.url, session.searchProvider) : 'about:blank'); break;
      case 'tab.activate': await this.activate(session, tab); break;
      case 'tab.close': {
        this.closedTabs.get(sessionId).unshift({ url: tab.url, pinned: tab.pinned });
        this.closedTabs.set(sessionId, this.closedTabs.get(sessionId).slice(0, 20));
        if (session.tabs.length === 1) await this.createTab(session);
        await this.closeTab(tab); break;
      }
      case 'tab.duplicate': await this.createTab(session, tab.url); break;
      case 'tab.closeOthers': case 'tab.closeRight': {
        // Pinned tabs stay open, as in other browsers.
        const index = session.tabs.indexOf(tab);
        const closing = session.tabs.filter((item, position) => item !== tab && !item.pinned && (command.type === 'tab.closeOthers' || position > index));
        await this.activate(session, tab);
        for (const item of closing) { this.closedTabs.get(sessionId).unshift({ url: item.url, pinned: false }); await this.closeTab(item); }
        this.closedTabs.set(sessionId, this.closedTabs.get(sessionId).slice(0, 20)); break;
      }
      case 'tab.pin': tab.pinned = !!command.pinned; session.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned)); break;
      case 'tab.reorder': {
        if (!Number.isInteger(command.index)) throw new Error('Invalid tab position.');
        session.tabs = session.tabs.filter(t => t.id !== tab.id);
        session.tabs.splice(Math.max(0, Math.min(session.tabs.length, command.index)), 0, tab);
        session.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned)); break;
      }
      case 'tab.reopen': { const previous = this.closedTabs.get(sessionId).shift(); if (previous) {
        const reopened = await this.createTab(session, previous.url); reopened.pinned = previous.pinned;
        session.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned)); } break; }
      case 'navigate': await this.navigate(session, tab, command.input); break;
      case 'home': await this.navigate(session, tab, 'about:blank'); break;
      case 'back': case 'forward': {
        const h = await this.send(tab, 'Page.getNavigationHistory');
        const entry = h.entries[h.currentIndex + (command.type === 'back' ? -1 : 1)];
        if (entry) await this.send(tab, 'Page.navigateToHistoryEntry', { entryId: entry.id }); break;
      }
      case 'reload': tab.error = undefined; await this.send(tab, 'Page.reload'); break;
      case 'stop': {
        // Invalidate the outstanding navigate reply before Chromium acknowledges
        // cancellation. A newer navigation may start while this command awaits.
        const navigation = tab._navigation = id();
        await this.send(tab, 'Page.stopLoading');
        if (tab._navigation === navigation) {
          delete tab._navigationUrl; tab.loading = false; await this.refresh(tab);
        }
        break;
      }
      case 'zoom': {
        if (!Number.isFinite(command.value) || command.value < 0.25 || command.value > 3) throw new Error('Zoom must be between 25% and 300%.');
        // CDP page scaling preserves the site's DOM and styles. This is viewport zoom.
        await this.send(tab, 'Emulation.setPageScaleFactor', { pageScaleFactor: command.value });
        const metrics = await this.send(tab, 'Page.getLayoutMetrics'); tab.zoom = metrics.visualViewport.scale; break;
      }
      case 'paste': {
        if (typeof command.text !== 'string' || command.text.length > 32000) throw new Error('Paste text must be less than 32,000 characters.');
        await this.send(tab, 'Input.insertText', { text: command.text }); break;
      }
      case 'find': {
        if (typeof command.text !== 'string' || command.text.length > 1000) throw new Error('Invalid find text.');
        // Runs in the isolated world: the page cannot read the search text by replacing window.find.
        const step = !command.text ? 'clear' : tab.find?.text === command.text ? (command.forward === false ? 'previous' : 'next') : 'start';
        const result = await this.inPage(tab, findExpression(command.text, step, tab.find?.active));
        tab.find = command.text ? { text: command.text, active: result?.active ?? 0, total: result?.total ?? 0 } : undefined; break;
      }
      case 'find.clear': await this.inPage(tab, findExpression('', 'clear')).catch(() => {}); tab.find = undefined; break;
      case 'select-all': {
        // An editing command, so it selects within a focused field or else the whole page.
        await this.send(tab, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
        await this.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }); break;
      }
      case 'print': {
        const { data } = await this.send(tab, 'Page.printToPDF', { printBackground: true });
        const guid = id(); this.downloadStarted({ guid, frameId: tab._frame, suggestedFilename: `${tab.title}.pdf` });
        const item = this.downloads.get(guid); await writeFile(item.path, Buffer.from(data, 'base64'), { mode: 0o600 });
        item.transfer.receivedBytes = item.transfer.totalBytes = Buffer.byteLength(data, 'base64');
        await this.completeDownload(item, session); break;
      }
      case 'dialog.respond': {
        if (!tab?.dialog || tab.dialog.id !== command.id) throw new Error('This dialog is no longer open.');
        const text = typeof command.text === 'string' ? command.text.slice(0, 5000) : undefined;
        await this.send(tab, 'Page.handleJavaScriptDialog', { accept: command.accept === true, ...(text !== undefined && command.accept ? { promptText: text } : {}) });
        tab.dialog = undefined; break;
      }
      case 'select.choose': case 'select.dismiss': {
        const menu = session.selectMenu; session.selectMenu = null;
        const context = menu && this.selectContexts.get(menu.id);
        if (menu) this.selectContexts.delete(menu.id);
        if (!menu || menu.id !== command.menuId) throw new Error('That list is no longer open.');
        const target = this.targets.get(menu.tabId);
        if (command.type === 'select.choose' && target && context) {
          if (!Number.isInteger(command.index) || !menu.options[command.index] || menu.options[command.index].disabled) throw new Error('Choose one of the available options.');
          // Runs in the isolated world that reported the list, where it kept the element.
          await this.send(target, 'Runtime.evaluate', { expression: `globalThis.__lopeChooseOption?.(${command.index})`, contextId: context.contextId, returnByValue: true })
            .catch(() => { throw new Error('That list is no longer available.'); });
        } else if (target && context) {
          await this.send(target, 'Runtime.evaluate', { expression: 'globalThis.__lopeChooseOption?.(-1)', contextId: context.contextId, returnByValue: true }).catch(() => {});
        }
        break;
      }
      case 'context.dismiss': session.contextMenu = null; break;
      case 'context.openLink': {
        const menu = this.takeContextMenu(session, command.menuId);
        if (!menu.link) throw new Error('This link is no longer available.');
        await this.createTab(session, destination(menu.link, session.searchProvider)); break;
      }
      case 'context.search': {
        const menu = this.takeContextMenu(session, command.menuId);
        if (!menu.selection) throw new Error('Select some text to search for.');
        // Always a search, even when the selection looks like an address.
        await this.createTab(session, SEARCH_PROVIDERS[session.searchProvider].url + encodeURIComponent(menu.selection.trim().replace(/\s+/g, ' ').slice(0, 1000))); break;
      }
      case 'context.saveLink': case 'context.saveImage': {
        const menu = this.takeContextMenu(session, command.menuId);
        const url = command.type === 'context.saveImage' ? menu.image : menu.link;
        if (!url) throw new Error('There is nothing to save here.');
        await this.saveUrl(session, menu.tabId, url); break;
      }
      case 'bookmark.add': {
        if (safeHostUrl(tab.url) && !session.bookmarks.some(b => b.url === tab.url)) session.bookmarks.push({ id: id(), url: tab.url, title: tab.title, createdAt: Date.now() }); break;
      }
      case 'bookmark.remove': session.bookmarks = session.bookmarks.filter(b => b.id !== command.id); break;
      case 'download.cancel': {
        const item = this.downloads.get(command.id);
        if (!item || item.sessionId !== sessionId) throw new Error('Download not found.');
        item.abort?.abort();
        if (item.transfer.state === 'progress') await this.cdp.send('Browser.cancelDownload', { guid: command.id,
          ...(session.contextId ? { browserContextId: session.contextId } : {}) });
        item.transfer.state = 'canceled'; break;
      }
      case 'upload.cancel': {
        const request = this.uploadRequests.get(command.id);
        if (request?.sessionId === sessionId) { const target = this.targets.get(request.tabId);
          if (target) await this.send(target, 'DOM.setFileInputFiles', { files: [], backendNodeId: request.nodeId });
          this.uploadRequests.delete(command.id); session.uploads = session.uploads.filter(u => u.id !== command.id); } break;
      }
      case 'permission.respond': throw new Error('Device forwarding is unavailable. Use Open in host browser for device access.');
      case 'settings': {
        if (!['duckduckgo', 'google', 'bing'].includes(command.searchProvider)) throw new Error('Unknown search provider.');
        session.searchProvider = command.searchProvider; break;
      }
      case 'data.clear': {
        if (session.mode === 'private') {
          for (const [key, item] of this.downloads) if (item.sessionId === sessionId) { item.abort?.abort(); this.downloads.delete(key); }
          for (const [key, item] of this.uploadRequests) if (item.sessionId === sessionId) this.uploadRequests.delete(key);
          for (const [key, item] of this.openedFiles) if (item.sessionId === sessionId) this.openedFiles.delete(key);
          for (const target of [...session.tabs]) this.targets.delete(target.id);
          await this.cdp.send('Target.disposeBrowserContext', { browserContextId: session.contextId });
          const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
          Object.assign(session, { contextId: browserContextId, tabs: [], activeTabId: null, history: [], bookmarks: [], downloads: [], uploads: [] });
          await rm(join(this.transferRoot, sessionId), { recursive: true, force: true });
          await this.configureContext(session); await this.createTab(session);
        } else {
          return this.restart(true);
        }
        break;
      }
      default: throw new Error('Unknown browser command.');
    }
    this.changed(session); return this.snapshot(sessionId);
  }
  async syncActiveTitles() {
    if (this.stopping || this.titleSyncing || !this.cdp) return;
    this.titleSyncing = true;
    try {
      for (const session of [...this.sessions.values()]) {
        const tab = session.activeTabId ? this.targets.get(session.activeTabId) : null;
        if (!tab || tab.loading || tab._pendingUrl || tab._navigationUrl) continue;
        const navigation = tab._navigation;
        const { result } = await this.send(tab, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true }).catch(() => ({}));
        const title = typeof result?.value === 'string' ? result.value.slice(0, 500) : '';
        if (title && title !== tab.title && this.targets.has(tab.id) && tab._navigation === navigation && !tab._pendingUrl && !tab._navigationUrl) { tab.title = title; this.changed(session); }
      }
    } finally { this.titleSyncing = false; }
  }
  async close() {
    this.stopping = true; clearTimeout(this.saveTimer); clearInterval(this.titleTimer); clearTimeout(this.emitTimer); this.emitTimer = null; this.dirty.clear();
    if (this.normal) await this.persist();
    for (const session of [...this.sessions.values()]) if (session.mode === 'private') await this.destroy(session.id).catch(() => {});
    // Opened files are gone after a restart; drop any site data their origins kept.
    if (!this.cdp?.closed) for (const file of [...this.openedFiles.values()]) await this.forgetFile(file);
    await this.display?.close();
    await this.cdp?.close();
    await this.egress?.close();
  }
}
