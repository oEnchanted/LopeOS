import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, realpath, stat } from 'node:fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import { ChromiumPipe } from './cdp.mjs';
import { createEgressProxy } from './network.mjs';
import { destination, safeHostUrl } from '../../../packages/browser-client/src/navigation.ts';

const id = () => randomUUID();
const internal = tab => tab.url === 'about:blank';
const cleanName = name => basename(name).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160) || 'download';
const publicTab = tab => Object.fromEntries(Object.entries(tab).filter(([key]) => !key.startsWith('_')));

export class BrowserEngine extends EventEmitter {
  sessions = new Map();
  targets = new Map();
  frames = new Map();
  attaching = new Map();
  downloads = new Map();
  uploadRequests = new Map();
  closedTabs = new Map();
  constructor(options) {
    super(); this.options = options;
    this.profileRoot = resolve(options.dataRoot);
    this.streamUrl = options.streamUrl ?? null;
  }
  async start() {
    this.generation = id();
    await mkdir(this.profileRoot, { recursive: true, mode: 0o700 });
    this.normal = this.makeSession('normal', 'normal');
    let saved;
    try { saved = JSON.parse(await readFile(join(this.profileRoot, 'session.json'), 'utf8')); } catch {}
    if (saved?.version === 1) {
      this.normal.history = saved.history ?? []; this.normal.bookmarks = saved.bookmarks ?? [];
      this.normal.searchProvider = ['google', 'bing'].includes(saved.searchProvider) ? saved.searchProvider : 'duckduckgo';
    }
    this.egress = await createEgressProxy({ testOrigins: this.options.testOrigins ?? [] });
    this.cdp = new ChromiumPipe(this.options.executable, {
      profile: join(this.profileRoot, 'chromium'), headless: this.options.headless,
      proxyPort: this.egress.port,
    });
    this.cdp.on('event', packet => { this.onEvent(packet).catch(() => {}); });
    this.cdp.on('disconnected', () => {
      for (const session of this.sessions.values()) { session.status = 'crashed'; this.changed(session); }
    });
    this.version = (await this.cdp.send('Browser.getVersion')).product;
    await this.configureContext(this.normal);
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    for (const info of targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('devtools:'))) await this.attach(info);
    if (!this.normal.tabs.length) await this.createTab(this.normal);
    if (saved?.tabs?.length) {
      const first = this.normal.tabs[0];
      const restored = saved.tabs.filter(tab => tab.url === 'about:blank' || safeHostUrl(tab.url)).slice(0, 60);
      for (const [index, tab] of restored.entries()) {
        const target = index === 0 ? first : await this.createTab(this.normal);
        target.pinned = !!tab.pinned;
        if (tab.url !== 'about:blank') await this.navigate(this.normal, target, tab.url);
      }
      const active = this.normal.tabs[Math.min(saved.activeIndex ?? 0, this.normal.tabs.length - 1)];
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
    return { ...session, generation: this.generation, contextId: undefined, tabs: session.tabs.map(publicTab), engineVersion: this.version,
      streamUrl: this.streamUrl, capabilities: { stream: !!this.streamUrl, audio: !!this.streamUrl,
        deviceForwarding: false, workspaceFiles: !!this.options.files } };
  }
  changed(session) {
    session.revision++;
    if (session.mode === 'normal' && session.tabs.length) this.restoreTabs = {
      tabs: session.tabs.map(t => ({ url: t.url, pinned: t.pinned })),
      activeIndex: session.tabs.findIndex(t => t.id === session.activeTabId),
    };
    this.emit('state', this.snapshot(session.id));
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
      const restored = s.tabs.length ? { tabs: s.tabs.map(t => ({ url: t.url, pinned: t.pinned })),
        activeIndex: s.tabs.findIndex(t => t.id === s.activeTabId) } : this.restoreTabs ?? { tabs: [], activeIndex: 0 };
      const data = { version: 1, ...restored, history: s.history,
        bookmarks: s.bookmarks, searchProvider: s.searchProvider };
      const path = join(this.profileRoot, 'session.json');
      await writeFile(path + '.tmp', JSON.stringify(data), { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    await this.saveTask;
  }
  async configureContext(session) {
    const dir = join(this.profileRoot, 'transfers', session.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir,
      eventsEnabled: true, ...(session.contextId ? { browserContextId: session.contextId } : {}) });
    // Forwarding is not verified: never grant remote sites access to a local device.
    for (const name of ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'clipboard-write']) {
      await this.cdp.send('Browser.setPermission', { permission: { name }, setting: 'denied',
        ...(session.contextId ? { browserContextId: session.contextId } : {}) });
    }
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
    for (const transfer of session.downloads) this.downloads.get(transfer.id)?.abort?.abort();
    // First close engine contexts; then remove all staging and in-memory private state.
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: session.contextId });
    for (const tab of session.tabs) this.targets.delete(tab.id);
    for (const [key, item] of this.uploadRequests) if (item.sessionId === sessionId) this.uploadRequests.delete(key);
    for (const [key, item] of this.downloads) if (item.sessionId === sessionId) this.downloads.delete(key);
    this.sessions.delete(sessionId); this.closedTabs.delete(sessionId);
    await rm(join(this.profileRoot, 'transfers', sessionId), { recursive: true, force: true });
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
    if (info.type !== 'page' || info.url.startsWith('devtools:')) return;
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
    if (info.openerId) { await this.activate(session, tab); }
    await this.refresh(tab); this.changed(session); return tab;
  }
  send(tab, method, params = {}) { return this.cdp.send(method, params, tab._cdp); }
  async createTab(session, url = 'about:blank') {
    if (session.tabs.length >= 60) throw new Error('This session has reached its 60-tab limit.');
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank',
      ...(session.contextId ? { browserContextId: session.contextId } : {}) });
    const { targetInfo } = await this.cdp.send('Target.getTargetInfo', { targetId });
    const tab = await this.attach(targetInfo);
    await this.activate(session, tab);
    if (url !== 'about:blank') await this.navigate(session, tab, url);
    return tab;
  }
  async activate(session, tab) {
    if (!tab) return;
    await this.cdp.send('Target.activateTarget', { targetId: tab.id });
    session.activeTabId = tab.id; this.foreground = session.id; this.changed(session);
  }
  async closeTab(tab) {
    // Chromium can acknowledge close during a cross-document swap before closing the
    // replacement page. Wait for the actual target lifecycle and retry while it exists.
    const until = Date.now() + 5000;
    while (this.targets.has(tab.id) && Date.now() < until) {
      await this.cdp.send('Target.closeTarget', { targetId: tab.id });
      if (!this.targets.has(tab.id)) return;
      await new Promise(resolve => {
        const done = event => { if (!event || event.targetId === tab.id) { clearTimeout(timer); this.cdp.off('Target.targetDestroyed', done); resolve(); } };
        const timer = setTimeout(done, 100); this.cdp.on('Target.targetDestroyed', done);
      });
    }
    if (this.targets.has(tab.id)) throw new Error('This tab could not close. Finish any page dialog and try again.');
  }
  async refresh(tab) {
    if (!this.targets.has(tab.id)) return;
    const session = this.sessions.get(tab._session); if (!session) return;
    const history = await this.send(tab, 'Page.getNavigationHistory').catch(() => null);
    if (history) {
      tab.canGoBack = history.currentIndex > 0;
      tab.canGoForward = history.currentIndex < history.entries.length - 1;
      const current = history.entries[history.currentIndex];
      if (current) { tab.url = current.url; tab.title = current.title || tab.title; }
    }
    const metrics = await this.send(tab, 'Page.getLayoutMetrics').catch(() => null);
    if (metrics?.visualViewport) tab.zoom = metrics.visualViewport.scale;
    const { result } = await this.send(tab, 'Runtime.evaluate', { expression:
      `({title:document.title,icon:document.querySelector('link[rel~="icon"]')?.href})`, returnByValue: true }).catch(() => ({}));
    if (result?.value) { tab.title = result.value.title || (internal(tab) ? 'New Tab' : tab.url);
      // Do not make the host browser fetch website favicons and leak its network identity.
      const icon = result.value.icon;
      if (icon && tab._frame) {
        const resource = await this.send(tab, 'Page.getResourceContent', { frameId: tab._frame, url: icon }).catch(() => null);
        if (resource?.base64Encoded && resource.content.length < 128000 && /\.(?:png|ico|jpe?g|webp)(?:[?#]|$)/i.test(icon)) {
          tab.favicon = `data:image/${/\.ico(?:[?#]|$)/i.test(icon) ? 'x-icon' : /\.png(?:[?#]|$)/i.test(icon) ? 'png' : /\.webp(?:[?#]|$)/i.test(icon) ? 'webp' : 'jpeg'};base64,${resource.content}`;
        }
      } }
    this.changed(session);
  }
  async navigate(session, tab, input) {
    const url = destination(input, session.searchProvider);
    tab.error = undefined; tab.loading = true; this.changed(session);
    const result = await this.send(tab, 'Page.navigate', { url });
    if (result.errorText && result.errorText !== 'net::ERR_ABORTED') {
      tab.error = { kind: /CERT|SSL/.test(result.errorText) ? 'certificate' : 'navigation', message: result.errorText };
      tab.loading = false; this.changed(session);
    }
  }
  async onEvent({ method, params, sessionId }) {
    if (method === 'Target.targetCreated') { await this.attach(params.targetInfo); return; }
    if (method === 'Target.targetInfoChanged') {
      const tab = this.targets.get(params.targetInfo.targetId);
      if (tab) { tab.url = params.targetInfo.url; tab.title = params.targetInfo.title || tab.title;
        this.changed(this.get(tab._session)); }
      return;
    }
    if (method === 'Target.targetDestroyed') {
      const tab = this.targets.get(params.targetId); if (!tab) return;
      const session = this.sessions.get(tab._session); this.targets.delete(tab.id);
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
    const session = this.sessions.get(tab._session); if (!session) return;
    if (method === 'Page.frameNavigated') this.frames.set(params.frame.id, tab.id);
    if (method === 'Page.frameAttached') this.frames.set(params.frameId, tab.id);
    if (method === 'Page.frameDetached') this.frames.delete(params.frameId);
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      tab._frame = params.frame.id; tab.url = params.frame.url;
      if (!params.frame.unreachableUrl) tab.error = undefined;
      await this.refresh(tab);
    }
    if (method === 'Page.navigatedWithinDocument') { tab.url = params.url; await this.refresh(tab); this.visit(session, tab); }
    if (method === 'Page.frameStartedLoading' && (!tab._frame || params.frameId === tab._frame)) {
      tab.loading = true; this.changed(session);
    }
    if (method === 'Page.frameStoppedLoading' && (!tab._frame || params.frameId === tab._frame)) {
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
    this.downloads.set(event.guid, { transfer, sessionId: session.id, path: join(this.profileRoot, 'transfers', session.id, event.guid) });
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
    const directory = join(this.profileRoot, 'transfers', sessionId, 'uploads', requestId);
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
      } else { await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 }); paths.push(target); }
    }
    await this.send(tab, 'DOM.setFileInputFiles', { files: paths, backendNodeId: request.nodeId });
    this.uploadRequests.delete(requestId);
    const session = this.get(sessionId); session.uploads = session.uploads.filter(r => r.id !== requestId); this.changed(session);
  }
  async restart(erase = false) {
    const revision = this.normal.revision;
    await this.close();
    if (erase) await rm(this.profileRoot, { recursive: true, force: true });
    this.sessions.clear(); this.targets.clear(); this.frames.clear(); this.attaching.clear();
    this.downloads.clear(); this.uploadRequests.clear(); this.closedTabs.clear(); this.defaultContextId = null;
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
      case 'stop': await this.send(tab, 'Page.stopLoading'); tab.loading = false; break;
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
        await this.send(tab, 'Runtime.evaluate', { expression: `window.find(${JSON.stringify(command.text)},false,${command.forward === false},true,false,false,false)` }); break;
      }
      case 'print': {
        const { data } = await this.send(tab, 'Page.printToPDF', { printBackground: true });
        const guid = id(); this.downloadStarted({ guid, frameId: tab._frame, suggestedFilename: `${tab.title}.pdf` });
        const item = this.downloads.get(guid); await writeFile(item.path, Buffer.from(data, 'base64'), { mode: 0o600 });
        item.transfer.receivedBytes = item.transfer.totalBytes = Buffer.byteLength(data, 'base64');
        await this.completeDownload(item, session); break;
      }
      case 'devtools': await this.cdp.send('Target.openDevTools', { targetId: tab.id }); break;
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
          for (const target of [...session.tabs]) this.targets.delete(target.id);
          await this.cdp.send('Target.disposeBrowserContext', { browserContextId: session.contextId });
          const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
          Object.assign(session, { contextId: browserContextId, tabs: [], activeTabId: null, history: [], bookmarks: [], downloads: [], uploads: [] });
          await rm(join(this.profileRoot, 'transfers', sessionId), { recursive: true, force: true });
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
  async close() {
    this.stopping = true; clearTimeout(this.saveTimer);
    if (this.normal) await this.persist();
    for (const session of [...this.sessions.values()]) if (session.mode === 'private') await this.destroy(session.id).catch(() => {});
    await this.cdp?.close();
    await this.egress?.close();
  }
}
