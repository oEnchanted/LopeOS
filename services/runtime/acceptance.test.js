import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRuntime } from './server.js';
import { authenticate, loadConfig } from './config.js';

const enabled = process.env.LOPE_ACCEPTANCE === '1';
async function fixture(t) {
  const config = loadConfig(), token = process.env.LOPE_TEST_TOKEN_A || (await readFile(new URL('../../.runtime/token', import.meta.url), 'utf8')).trim();
  const owner = authenticate(token, config), runtime = createRuntime(config);
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(0, '127.0.0.1', resolve); });
  const cleanups = [];
  t.after(async () => {
    await runtime.sessions.shutdown();
    try { for (const cleanup of cleanups.reverse()) await cleanup(); }
    finally { await runtime.close(); }
  });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const request = async (route, options = {}, bearer = token) => {
    const response = await fetch(base + '/api' + route, { ...options, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' } });
    return { response, value: await response.json() };
  };
  const health = await request('/health'); assert.equal(health.response.status, 200, JSON.stringify(health.value));
  return { config, token, owner, runtime, base, request, cleanup(fn) { cleanups.push(fn); } };
}
async function attach(f, id, cursor = 0, bearer = f.token) {
  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/api/ws', { origin: f.config.origins[0] });
  let text = '', last = cursor, frames = [], subscribers = [];
  ws.on('error', () => {});
  ws.on('message', raw => {
    const m = JSON.parse(raw); frames.push(m); if (frames.length > 100) frames.shift();
    if (m.type === 'output') { text = (text + m.data).slice(-262144); last = m.end; ws.send(JSON.stringify({ type: 'ack', cursor: last })); }
    for (const resolve of subscribers.splice(0)) resolve();
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', channel: 'terminal', token: bearer, sessionId: id, cursor }));
  const wait = async (predicate, description) => {
    const deadline = Date.now() + 10000;
    while (!predicate(text, frames)) {
      if (Date.now() > deadline) assert.fail(`Linux runtime did not produce ${description}. Tail: ${text.slice(-1200)}`);
      await Promise.race([new Promise(resolve => subscribers.push(resolve)), new Promise(resolve => setTimeout(resolve, 30))]);
    }
  };
  return { ws, wait, get text() { return text; }, get cursor() { return last; }, clear() { text = ''; frames = []; }, input(data) { ws.send(JSON.stringify({ type: 'input', data })); }, resize(cols, rows) { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } };
}
const post = value => ({ method: 'POST', body: JSON.stringify(value) });

test('Linux/Docker: real shell, scripts, completion/history, signals, job control, less, vim, resize, load, reattach and editor sharing', { skip: !enabled, timeout: 120000 }, async t => {
  const f = await fixture(t), directory = '/.lope-accept-' + randomBytes(6).toString('hex');
  assert.equal((await f.request('/fs/mkdir', post({ path: directory }))).response.status, 201);
  f.cleanup(async () => { const result = await f.request('/fs/delete', { method: 'DELETE', body: JSON.stringify({ path: directory, recursive: true }) }); assert.equal(result.response.status, 200, 'Temporary acceptance directory cleanup'); });
  const { value: session, response } = await f.request('/terminal/sessions', post({ cwd: directory, cols: 80, rows: 24 })); assert.equal(response.status, 201);
  let terminal = await attach(f, session.id); t.after(() => terminal.ws.terminate());
  await terminal.wait((_, frames) => frames.some(m => m.type === 'ready'), 'PTY attachment');
  terminal.input("mkdir 'two words'; printf '%s\\n' red blue green | grep blue > 'two words/result'; pipeline_status=$?; mv 'two words/result' 'two words/renamed'; cat 'two words/renamed'; printf 'PIPE_STATUS=%s\\n' \"$pipeline_status\"\r");
  await terminal.wait(text => /\r\nblue\r\nPIPE_STATUS=0/.test(text), 'a real pipeline and its exit status');
  terminal.clear(); terminal.input("printf 'print(6*7)\\n' > script.py; python3 script.py; printf 'console.log(7*7)\\n' > script.js; NO_COLOR=1 node script.js\r");
  await terminal.wait(text => /\r\n42\r\n49\r\n/.test(text), 'Python and Node script results');
  terminal.clear(); terminal.input("printf 'HISTORY_FROM_SHELL\\n'\r"); await terminal.wait(text => /\r\nHISTORY_FROM_SHELL\r\n/.test(text), 'history command execution');
  terminal.clear(); terminal.input('\x1b[A\r'); await terminal.wait(text => /\r\nHISTORY_FROM_SHELL\r\n/.test(text), 'Up-arrow shell history');
  terminal.clear(); terminal.input('cat scri\t'); await new Promise(resolve => setTimeout(resolve, 200)); terminal.input('\x03');
  terminal.input("printf 'completion-data\\n' > completion-unique.txt; cat completion-u\t\r"); await terminal.wait(text => /\r\ncompletion-data\r\n/.test(text), 'real filename completion');
  terminal.clear(); terminal.input('sleep 60\r'); await new Promise(resolve => setTimeout(resolve, 100)); terminal.input('\x1a'); await terminal.wait(text => /Stopped/.test(text), 'Ctrl+Z suspension');
  terminal.clear(); terminal.input('bg\rjobs\r'); await terminal.wait(text => /Running/.test(text), 'background job control');
  terminal.clear(); terminal.input('fg\r'); await new Promise(resolve => setTimeout(resolve, 100)); terminal.input('\x03'); terminal.input("printf 'INTERRUPTED_OK\\n'\r"); await terminal.wait(text => /\r\nINTERRUPTED_OK\r\n/.test(text), 'foreground interrupt');
  terminal.clear(); terminal.input('seq 1 400 > pages.txt; less pages.txt\r'); await terminal.wait(text => /\x1b\[\?1049h/.test(text), 'less alternate screen');
  terminal.resize(101, 37); await new Promise(resolve => setTimeout(resolve, 150)); terminal.input('q'); terminal.input('stty size\r'); await terminal.wait(text => /37 101/.test(text), 'interactive PTY resize');
  terminal.clear(); terminal.input('vim -Nu NONE -n interactive.txt\r'); await terminal.wait(text => /\x1b\[\?1049h/.test(text), 'vim alternate screen'); terminal.resize(90, 30); terminal.input(':q!\r');
  terminal.clear(); terminal.input('yes LOPE_LOAD\r'); await terminal.wait(text => /LOPE_LOAD[\s\S]*LOPE_LOAD[\s\S]*LOPE_LOAD/.test(text), 'high-volume output');
  const start = Date.now(); assert.equal((await f.request('/health')).response.status, 200); assert.ok(Date.now() - start < 3000);
  terminal.input('\x03'); terminal.input("printf 'LOAD_STOPPED\\n'\r"); await terminal.wait(text => /\r\nLOAD_STOPPED\r\n/.test(text), 'interrupt during output load');
  terminal.input("printf 'terminal content' > shared.txt\r");
  let read;
  for (let i = 0; i < 50; i++) { read = await f.request('/fs/read?path=' + encodeURIComponent(directory + '/shared.txt')); if (read.response.ok) break; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.equal(read.value.content, 'terminal content');
  const edited = await f.request('/fs/write', { method: 'PUT', body: JSON.stringify({ path: directory + '/shared.txt', content: 'editor content', version: read.value.version }) }); assert.equal(edited.response.status, 200);
  terminal.clear(); terminal.input("cat shared.txt; printf '\\nSHARED_OK\\n'\r"); await terminal.wait(text => /\r\neditor content\r\nSHARED_OK/.test(text), 'editor saves visible in the shell');
  // A fresh authenticated client sees the same persisted file (page refresh path).
  assert.equal((await f.request('/fs/read?path=' + encodeURIComponent(directory + '/shared.txt'))).value.content, 'editor content');
  const cursor = terminal.cursor; terminal.ws.close(); await new Promise(resolve => setTimeout(resolve, 100));
  terminal = await attach(f, session.id, cursor); await terminal.wait((_, frames) => frames.some(m => m.type === 'ready'), 'session reattachment');
  terminal.input("printf 'REATTACHED_OK\\n'\r"); await terminal.wait(text => /\r\nREATTACHED_OK/.test(text), 'execution after reattachment');
  terminal.input('\x04'); await terminal.wait((_, frames) => frames.some(m => m.type === 'exit' && m.exitCode === 0), 'Ctrl+D shell exit');
  assert.equal((await f.request(`/terminal/${session.id}`, { method: 'DELETE' })).response.status, 200);
});

test('Linux/Docker: a second user cannot attach to sessions or read another workspace', { skip: !enabled || !process.env.LOPE_TEST_TOKEN_B, timeout: 30000 }, async t => {
  const f = await fixture(t), tokenB = process.env.LOPE_TEST_TOKEN_B, ownerB = authenticate(tokenB, f.config);
  assert.notEqual(ownerB.workspaceId, f.owner.workspaceId);
  const path = '/.lope-owner-test-' + randomBytes(6).toString('hex');
  await f.request('/fs/write', { method: 'PUT', body: JSON.stringify({ path, content: 'owner-only', createOnly: true }) });
  f.cleanup(async () => { const result = await f.request('/fs/delete', { method: 'DELETE', body: JSON.stringify({ path }) }); assert.equal(result.response.status, 200, 'Temporary ownership file cleanup'); });
  assert.equal((await f.request('/fs/read?path=' + encodeURIComponent(path), {}, tokenB)).response.status, 404);
  const session = (await f.request('/terminal/sessions', post({}))).value;
  const foreign = await attach(f, session.id, 0, tokenB); t.after(() => foreign.ws.terminate());
  await foreign.wait((_, frames) => frames.some(m => m.type === 'error' && m.error.code === 'NOT_FOUND'), 'foreign-owner denial');
  assert.equal((await f.request(`/terminal/${session.id}`, { method: 'DELETE' }, tokenB)).response.status, 404);
  assert.equal((await f.request('/fs/read?path=%2F..%2Fother-home', {}, tokenB)).response.status, 403);
});
