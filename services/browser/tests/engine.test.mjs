import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserEngine } from '../src/engine.mjs';
import { createBrowserServer } from '../src/server.mjs';
import { once } from 'node:events';
import { createFixture } from './fixture.mjs';
import { openedFile } from '../../../packages/browser-client/src/navigation.ts';

const enabled = process.env.LOPE_TEST_CHROMIUM === '1';
const executable = process.env.CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
const eventually = async (check, description) => {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (await check()) return; await new Promise(ok => setTimeout(ok, 50)); }
  throw new Error(`Timed out: ${description}`);
};
const evaluate = async (engine, tab, expression) => {
  const result = await engine.send(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Page evaluation failed');
  return result.result.value;
};

test('real Chromium navigation, storage, files, popups, media, private isolation and restore', { skip: !enabled, timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-engine-'));
  const fixture = await createFixture();
  const options = { executable, dataRoot: join(root,'profile'), transferRoot:join(root,'transfers'), headless: true, testOrigins: [fixture.origin.replace('http://', '')] };
  let engine = new BrowserEngine(options);
  t.after(async () => { await engine.close().catch(() => {}); await fixture.close(); await rm(root, { recursive: true, force: true }); });
  await engine.start(); const tab = engine.normal.tabs[0];
  const token='t'.repeat(64);const control=createBrowserServer(engine,{token,origins:[fixture.origin]});control.listen(0,'127.0.0.1');await once(control,'listening');
  t.after(()=>{control.closeAllConnections();control.close();});
  await engine.command('normal', { type: 'navigate', tabId: tab.id, input: fixture.origin });
  await eventually(() => tab.title === 'Lope Browser test application' && !tab.loading, 'fixture loads');
  assert.deepEqual(await evaluate(engine, tab, "Promise.all(['geolocation','notifications','camera','microphone','clipboard-read','clipboard-write'].map(async name=>[name,(await navigator.permissions.query({name})).state]))"),
    ['geolocation','notifications','camera','microphone','clipboard-read','clipboard-write'].map(name => [name, 'denied']));
  await evaluate(engine, tab, "document.querySelector('#name').focus()");
  await engine.command('normal', { type: 'paste', tabId: tab.id, text: 'Lope 世界 👋' });
  assert.equal(await evaluate(engine, tab, "document.querySelector('#name').value"), 'Lope 世界 👋');
  await evaluate(engine, tab, "document.querySelector('#form').requestSubmit()");
  await eventually(() => tab.url.includes('/hello#form') && tab.title === 'Hello from JavaScript', 'same-document metadata');
  assert.equal(await evaluate(engine, tab, "document.querySelector('#greeting').textContent"), 'Hello, Lope 世界 👋');
  await eventually(() => tab.canGoBack === true, 'engine history availability');
  const storage = await evaluate(engine, tab, 'storageTest()');
  assert.equal(storage.local, 'persistent'); assert.match(storage.cookie, /lope-test=cookie/); assert.equal(storage.worker, true);
  assert.equal(await evaluate(engine, tab, `new Promise((ok,no)=>{const socket=new WebSocket(${JSON.stringify(fixture.origin.replace('http:', 'ws:') + '/echo')});socket.onmessage=e=>{ok(e.data);socket.close()};socket.onerror=no;setTimeout(()=>no(new Error('socket timeout')),3000)})`), 'A real WebSocket message.');
  assert.equal(await evaluate(engine, tab, "new Promise((ok,no)=>{const r=indexedDB.open('lope-test');r.onsuccess=()=>{const db=r.result,q=db.transaction('values').objectStore('values').get('key');q.onsuccess=()=>{ok(q.result);db.close()};q.onerror=no};r.onerror=no})"), 'indexed-value');
  await evaluate(engine, tab, "document.querySelector('#next').click()");
  await eventually(() => tab.title === 'Next page', 'navigation');
  await engine.command('normal', { type: 'back', tabId: tab.id });
  await eventually(() => tab.url.includes('/hello#form'), 'back');
  await eventually(() => tab.canGoForward === true, 'engine forward availability');
  await engine.command('normal', { type: 'navigate', tabId: tab.id, input: fixture.origin + '/redirect' });
  await eventually(() => tab.url.endsWith('/next'), 'redirect URL');
  await engine.command('normal', { type: 'navigate', tabId: tab.id, input: fixture.origin });
  await eventually(() => tab.title === 'Lope Browser test application', 'reload fixture');
  await evaluate(engine, tab, "document.querySelector('#popup').click()");
  await eventually(() => engine.normal.tabs.length === 2, 'popup attached');
  const popup = engine.normal.tabs.find(item => item.id !== tab.id);
  await eventually(() => popup.title === 'Popup', 'popup title');
  assert.equal(popup.openerId, tab.id); assert.equal(await evaluate(engine, popup, '!!window.opener'), true);
  await engine.command('normal', { type: 'tab.close', tabId: popup.id });
  await eventually(() => engine.normal.tabs.length === 1, 'popup closed');
  await engine.command('normal', { type: 'tab.activate', tabId: tab.id });
  await evaluate(engine, tab, "document.querySelector('#upload').click()");
  await eventually(() => engine.normal.uploads.length === 1, 'upload chooser');
  const selected=new FormData();selected.append('files',new File(['only selected content'],'chosen.txt'));
  const sent=await fetch(`http://127.0.0.1:${control.address().port}/api/browser/sessions/normal/uploads/${engine.normal.uploads[0].id}`,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:fixture.origin},body:selected});
  assert.equal(sent.status,200);await sent.json();
  await eventually(async () => (await evaluate(engine, tab, "document.querySelector('#uploaded').textContent")) === 'only selected content', 'file upload');
  await evaluate(engine, tab, "document.querySelector('#download').click()");
  await eventually(() => engine.normal.downloads[0]?.state === 'completed', 'download completes');
  assert.equal(await readFile(engine.downloads.get(engine.normal.downloads[0].id).path, 'utf8'), 'A real download from Chromium.');
  const audio = await evaluate(engine, tab, "(async()=>{const a=document.querySelector('#audio');await a.play();await new Promise(ok=>setTimeout(ok,150));return{paused:a.paused,time:a.currentTime,ready:a.readyState}})()");
  assert.equal(audio.paused, false); assert.ok(audio.time > 0); assert.ok(audio.ready >= 2);
  const video = await evaluate(engine, tab, 'recordVideo()'); assert.equal(video.width, 200); assert.ok(video.time > 0);
  await engine.command('normal', { type: 'bookmark.add', tabId: tab.id }); assert.equal(engine.normal.bookmarks.length, 1);
  await engine.command('normal', { type: 'tab.duplicate', tabId: tab.id });
  const duplicate = engine.normal.tabs.find(item => item.id !== tab.id);
  await eventually(() => duplicate.url === fixture.origin + '/' && !duplicate.loading, 'duplicate loads');
  await engine.command('normal', { type: 'tab.pin', tabId: tab.id, pinned: true });
  await engine.command('normal', { type: 'tab.reorder', tabId: tab.id, index: 1 });
  assert.equal(engine.normal.tabs[0].id,tab.id); // Pinned tabs stay before ordinary tabs.
  await engine.command('normal', { type: 'tab.close', tabId: duplicate.id });
  await eventually(()=>engine.normal.tabs.length===1,'close duplicate');
  await engine.command('normal', { type: 'tab.reopen' });
  await eventually(()=>engine.normal.tabs.length===2,'reopen duplicate');
  assert.notEqual(engine.normal.activeTabId, duplicate.id);
  const reopened=engine.normal.tabs.find(item=>item.id!==tab.id);
  // Close immediately, including while the restored navigation swaps renderers.
  await engine.command('normal', { type: 'tab.close', tabId: reopened.id });
  await eventually(()=>engine.normal.tabs.length===1,'close reopened tab');
  await engine.command('normal', { type: 'zoom', tabId: tab.id, value: 1.5 }); assert.equal(tab.zoom, 1.5);
  assert.equal((await engine.send(tab,'Page.getLayoutMetrics')).visualViewport.scale,tab.zoom);
  // Find runs in the isolated world: counts and highlights matches without touching the selection.
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'real   BROWSER' });
  assert.deepEqual(tab.find, { text: 'real   BROWSER', active: 1, total: 1 });
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'o' });
  const total = tab.find.total; assert.ok(total > 3); assert.equal(tab.find.active, 1);
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'o' }); assert.equal(tab.find.active, 2);
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'o', forward: false });
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'o', forward: false }); assert.equal(tab.find.active, total);
  assert.equal(await evaluate(engine, tab, "CSS.highlights.get('lope-find').size"), total);
  assert.equal(await evaluate(engine, tab, 'getSelection().toString()'), '');
  await engine.command('normal', { type: 'find', tabId: tab.id, text: 'no such words' }); assert.deepEqual(tab.find, { text: 'no such words', active: 0, total: 0 });
  await engine.command('normal', { type: 'find.clear', tabId: tab.id }); assert.equal(tab.find, undefined);
  assert.equal(await evaluate(engine, tab, "CSS.highlights.has('lope-find') || document.adoptedStyleSheets.length"), 0);
  // A real right-click reports the selection; synthetic page events and page-handled menus do not.
  await evaluate(engine, tab, "getSelection().selectAllChildren(document.querySelector('h1'))");
  const click = async (type, x, y) => engine.send(tab, 'Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 });
  const heading = await evaluate(engine, tab, "(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; })()");
  await click('mousePressed', heading.x, heading.y); await click('mouseReleased', heading.x, heading.y);
  await eventually(() => engine.normal.contextMenu?.selection === 'Real browser fixture', 'page context menu');
  assert.equal(engine.normal.contextMenu.editable, false); assert.equal(engine.normal.contextMenu.link, null);
  const navigated = [], navigate = engine.navigate.bind(engine);
  engine.navigate = (session, target, input) => { navigated.push(input); return navigate(session, target, input); };
  await engine.command('normal', { type: 'context.search', menuId: engine.normal.contextMenu.id });
  engine.navigate = navigate;
  const searchTab = engine.normal.tabs.find(item => item.id === engine.normal.activeTabId);
  assert.notEqual(searchTab.id, tab.id);
  assert.deepEqual(navigated, ['https://duckduckgo.com/?q=Real%20browser%20fixture']); // Egress blocks the real request in tests.
  await engine.command('normal', { type: 'tab.close', tabId: searchTab.id });
  await eventually(() => engine.normal.tabs.length === 1, 'search tab closed');
  await engine.command('normal', { type: 'tab.activate', tabId: tab.id });
  await evaluate(engine, tab, "document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
  await evaluate(engine, tab, "document.addEventListener('contextmenu', event => event.preventDefault(), { once: true })");
  await click('mousePressed', heading.x, heading.y); await click('mouseReleased', heading.x, heading.y);
  await new Promise(ok => setTimeout(ok, 300)); assert.equal(engine.normal.contextMenu, null);
  await evaluate(engine, tab, "document.querySelector('#name').value = 'select me'; document.querySelector('#name').focus()");
  await engine.command('normal', { type: 'select-all', tabId: tab.id });
  assert.deepEqual(await evaluate(engine, tab, "[document.querySelector('#name').selectionStart, document.querySelector('#name').selectionEnd]"), [0, 9]);
  // Close other tabs keeps pinned tabs and the chosen tab, and remembers the rest for reopening.
  for (let index = 0; index < 3; index++) await engine.command('normal', { type: 'tab.create' });
  const kept = engine.normal.tabs[2];
  await engine.command('normal', { type: 'tab.closeRight', tabId: kept.id }); assert.equal(engine.normal.tabs.length, 3);
  await engine.command('normal', { type: 'tab.closeOthers', tabId: kept.id });
  assert.deepEqual(engine.normal.tabs.map(item => item.id), [tab.id, kept.id]); assert.equal(engine.normal.activeTabId, kept.id);
  await engine.command('normal', { type: 'tab.close', tabId: kept.id }); await engine.command('normal', { type: 'tab.activate', tabId: tab.id });
  await engine.command('normal', { type: 'print', tabId: tab.id });
  assert.equal((await readFile(engine.downloads.get(engine.normal.downloads[0].id).path)).subarray(0, 4).toString(), '%PDF');
  const staged=engine.downloads.get(engine.normal.downloads[0].id).path;
  const privateSession = await engine.createPrivate(); const privateTab = engine.get(privateSession.id).tabs[0];
  await engine.navigate(engine.get(privateSession.id), privateTab, fixture.origin);
  await eventually(() => privateTab.title === 'Lope Browser test application', 'private load');
  assert.equal(await evaluate(engine, privateTab, "localStorage.getItem('lope-test')"), null);
  assert.equal(await evaluate(engine, privateTab, 'document.cookie'), '');
  await engine.destroy(privateSession.id); assert.equal(engine.sessions.has(privateSession.id), false);
  await assert.rejects(access(join(root, 'transfers', privateSession.id)));
  const oldGeneration=engine.snapshot('normal').generation;
  await engine.close(); engine = new BrowserEngine(options); await engine.start();
  assert.notEqual(engine.snapshot('normal').generation,oldGeneration);
  assert.equal(engine.normal.tabs[0].pinned,true);
  assert.equal(engine.normal.bookmarks.length, 1);
  await eventually(() => engine.normal.tabs[0]?.url === fixture.origin + '/', 'restored tab');
  assert.equal(await evaluate(engine, engine.normal.tabs[0], "localStorage.getItem('lope-test')"), 'persistent');
  await engine.command('normal', { type: 'data.clear' });
  await assert.rejects(access(staged));
  assert.equal(engine.normal.bookmarks.length, 0); assert.equal(engine.normal.history.length, 0);
  await engine.navigate(engine.normal, engine.normal.tabs[0], fixture.origin);
  await eventually(() => engine.normal.tabs[0].title === 'Lope Browser test application', 'post-clear load');
  assert.equal(await evaluate(engine, engine.normal.tabs[0], "localStorage.getItem('lope-test')"), null);
  assert.equal(await evaluate(engine, engine.normal.tabs[0], 'document.cookie'), '');
  await evaluate(engine, engine.normal.tabs[0], "localStorage.setItem('after-crash','kept')");
  await engine.cdp.close(); assert.equal(engine.normal.status,'crashed');
  const stoppedGeneration=engine.snapshot('normal').generation;
  await engine.command('normal',{type:'engine.restart'});
  assert.notEqual(engine.snapshot('normal').generation,stoppedGeneration);
  await eventually(()=>engine.normal.tabs[0].title==='Lope Browser test application','engine recovery');
  assert.equal(await evaluate(engine,engine.normal.tabs[0],"localStorage.getItem('after-crash')"),'kept');
});

test('real Chromium shows opened HTML files on their own origins, with nothing else served', { skip: !enabled, timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lope-opened-'));
  const options = { executable, dataRoot: join(root, 'profile'), transferRoot: join(root, 'transfers'), headless: true };
  let engine = new BrowserEngine(options);
  t.after(async () => { await engine.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  await engine.start();
  const token = 'f'.repeat(64);
  const control = createBrowserServer(engine, { token, origins: ['http://lope.test'] }); control.listen(0, '127.0.0.1'); await once(control, 'listening');
  t.after(() => { control.closeAllConnections(); control.close(); });
  const open = (name, html) => fetch(`http://127.0.0.1:${control.address().port}/api/browser/sessions/normal/opened-files`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-File-Name': encodeURIComponent(name) }, body: html });
  // No charset declaration: valid UTF-8 must still render correctly.
  const report = `<!doctype html><title>Quarterly report</title><link rel="stylesheet" href="style.css"><p id="text">Grüße 👋</p>
<script>localStorage.setItem('opened', 'kept');</script>`;
  const response = await open('Report.html', report);
  assert.equal(response.status, 200);
  assert.equal(engine.normal.tabs.length, 1); // The blank start tab shows the file.
  const tab = engine.normal.tabs[0];
  assert.equal((await response.json()).activeTabId, tab.id);
  await eventually(() => tab.title === 'Quarterly report' && !tab.loading, 'opened file loads');
  const file = openedFile(tab.url);
  assert.equal(file?.name, 'Report.html');
  assert.equal(tab.error, undefined);
  assert.equal(await evaluate(engine, tab, "document.querySelector('#text').textContent"), 'Grüße 👋');
  assert.equal(await evaluate(engine, tab, 'location.origin'), `https://${file.id}.file.lope.invalid`);
  assert.equal(await evaluate(engine, tab, "localStorage.getItem('opened')"), 'kept');
  // Nothing else exists on the file's origin, and the file is not served into frames.
  assert.equal(await evaluate(engine, tab, "fetch('style.css').then(r => r.status)"), 404);
  assert.equal(await evaluate(engine, tab, "new Promise(ok => { const f = document.createElement('iframe'); f.onload = () => ok(!!f.contentDocument.querySelector('#text')); f.src = location.href; document.body.append(f); })"), false);
  await engine.command('normal', { type: 'reload', tabId: tab.id });
  await eventually(async () => !tab.loading && await evaluate(engine, tab, "performance.getEntriesByType('navigation')[0]?.type").catch(() => null) === 'reload', 'reload');
  assert.equal(await evaluate(engine, tab, "document.querySelector('#text').textContent"), 'Grüße 👋');
  await (await open('Report.html', report)).json();
  assert.equal(engine.normal.tabs.length, 1); // Reopening an unchanged file shows its tab.
  await (await open('untitled.htm', '<p>No title</p>')).json();
  const second = engine.normal.tabs.find(item => item.id !== tab.id);
  assert.equal(engine.normal.activeTabId, second.id);
  await eventually(() => !second.loading && second.title === 'untitled.htm', 'untitled file is named');
  assert.equal(await evaluate(engine, second, "localStorage.getItem('opened')"), null); // Each file has its own origin.
  await engine.command('normal', { type: 'bookmark.add', tabId: tab.id });
  assert.equal(engine.normal.bookmarks.length, 0);
  assert.equal(engine.normal.history.some(item => openedFile(item.url)), false);
  assert.equal((await open('notes.txt', 'not html')).status, 400);
  await assert.rejects(engine.openFile('normal', { name: 'huge.html', bytes: Buffer.alloc(32 * 1024 * 1024 + 1) }), /32 MB/);
  const privateSession = engine.get((await engine.createPrivate()).id), privateTab = privateSession.tabs[0];
  await engine.navigate(privateSession, privateTab, tab.url);
  await eventually(() => privateTab.title === 'File not available' && !privateTab.loading, 'another session cannot load the file');
  await engine.destroy(privateSession.id);
  await access(join(root, 'transfers', 'normal', 'opened', file.id));
  await engine.close(); engine = new BrowserEngine(options); await engine.start();
  // Opened files close with the browser: no restored tabs, staged copies, saved names or site data.
  assert.deepEqual(engine.normal.tabs.map(item => item.url), ['about:blank']);
  await assert.rejects(access(join(root, 'transfers', 'normal', 'opened', file.id)));
  assert.doesNotMatch(await readFile(join(root, 'profile', 'session.json'), 'utf8'), /file\.lope\.invalid|Report/);
  const restarted = engine.normal.tabs[0];
  await engine.navigate(engine.normal, restarted, tab.url);
  await eventually(() => restarted.title === 'File not available' && !restarted.loading, 'closed file is unavailable');
  assert.equal(await evaluate(engine, restarted, "localStorage.getItem('opened')"), null);
});
