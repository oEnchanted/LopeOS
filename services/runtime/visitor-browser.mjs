// Browser integration fixture only. Product workspaces always use Linux containers.
// Execute from the repository root after building: node services/runtime/visitor-browser.mjs
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Visitors } from './visitors.js';
import { createRuntime } from './server.js';
import { PtyTransport } from './pty-transport.js';
import { RuntimeError } from './config.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lope-visitor-browser-'));
const worker = fileURLToPath(new URL('./fs.py', import.meta.url));
class FixtureWorkspace {
  jobs = new Map(); transports = new Map();
  root(owner) { return path.join(temporary, owner.workspaceId); }
  begin(owner) {
    if (!this.jobs.has(owner.workspaceId)) {
      const job = { state: 'starting' }; this.jobs.set(owner.workspaceId, job);
      job.promise = fs.mkdir(this.root(owner), { recursive: true }).then(() => { job.state = 'ready'; });
    }
    return { state: this.jobs.get(owner.workspaceId).state };
  }
  async ready(owner) { this.begin(owner); await this.jobs.get(owner.workspaceId).promise; }
  async file(owner, q) {
    await this.ready(owner);
    const code = 'import sys,importlib.util,json; s=importlib.util.spec_from_file_location("f",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.respond(m.FileSystem(sys.argv[2]),json.load(sys.stdin))))';
    const raw = await new Promise((resolve, reject) => {
      const child = spawn('python3', ['-B', '-c', code, worker, this.root(owner)], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output += value; }); child.stderr.on('data', () => {});
      child.on('error', reject); child.on('close', code => code ? reject(new Error('Fixture worker failed')) : resolve(output)); child.stdin.end(JSON.stringify(q));
    });
    const result = JSON.parse(raw);
    if (!result.ok) throw new RuntimeError(result.error.code, result.error.message, { NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403 }[result.error.code] || 400);
    return result.result;
  }
  async terminal(owner, id, options) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./agent-fixture.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LOPE_TEST_WORKDIR: path.join(this.root(owner), options.cwd) } });
    const transport = await new PtyTransport(child).ready; this.transports.set(id, transport); return transport;
  }
  async closeTerminal(owner, id) { const p = this.transports.get(id); this.transports.delete(id); p?.kill(); }
}
let runtime, web, browser;
try {
  const visitors = await Visitors.open({ directory: path.join(temporary, 'control'), secure: false });
  const config = { principals: [], origins: [], shell: 'bash', maxSessions: 8, detachedMs: 900000 };
  runtime = createRuntime(config, new FixtureWorkspace(), visitors);
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  web = await preview({ configFile: false, root: process.cwd(), preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${runtime.server.address().port}`, ws: true } } } });
  const base = `http://127.0.0.1:${web.httpServer.address().port}`; config.origins.push(base);
  browser = await chromium.launch({ headless: true });
  const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await a.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.getByRole('button', { name: 'Open Terminal', exact: true }).click();
  await expect(page.locator('.terminal-state-dot.connected')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Use a runtime credential')).toHaveCount(0);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("printf '%s\\n' red blue green | grep blue > shared.txt", { delay: 1 }); await page.keyboard.press('Enter');
  await expect.poll(async () => { const r = await a.request.get(base + '/api/fs/read?path=/shared.txt'); return r.ok() ? (await r.json()).content : ''; }).toBe('blue\n');
  const firstSessions = (await (await a.request.get(base + '/api/terminal/sessions')).json()).sessions;
  await page.getByRole('button', { name: 'Open Files', exact: true }).click();
  await page.getByRole('button', { name: 'shared.txt, file', exact: true }).dblclick();
  const editor = page.getByTestId('editor-app'); await expect(editor.getByLabel('Document content', { exact: true })).toHaveValue('blue\n');
  await editor.getByLabel('Document content', { exact: true }).fill('EDITED_IN_TEXT_EDITOR\n'); await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await (await a.request.get(base + '/api/fs/read?path=/shared.txt')).json()).content).toBe('EDITED_IN_TEXT_EDITOR\n');
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click(); await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('cat shared.txt', { delay: 1 }); await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('EDITED_IN_TEXT_EDITOR');
  await fs.mkdir('docs/screenshots', { recursive: true }); await page.screenshot({ path: 'docs/screenshots/terminal-visitor.png' });
  const identityA = await (await a.request.get(base + '/api/identity')).json();
  await page.reload(); await expect(page.locator('.terminal-state-dot.connected')).toBeVisible({ timeout: 15000 });
  assert((await (await a.request.get(base + '/api/terminal/sessions')).json()).sessions.some(s => s.id === firstSessions[0].id), 'Refresh must reattach the existing shell.');
  expect((await (await a.request.get(base + '/api/fs/read?path=/shared.txt')).json()).content).toBe('EDITED_IN_TEXT_EDITOR\n');
  const b = await browser.newContext(); const other = await b.newPage(); await other.goto(base); await other.getByRole('button', { name: 'Open Terminal', exact: true }).click();
  await expect(other.locator('.terminal-state-dot.connected')).toBeVisible({ timeout: 15000 });
  const identityB = await (await b.request.get(base + '/api/identity')).json(); expect(identityB.workspaceId).not.toBe(identityA.workspaceId);
  expect((await b.request.get(base + '/api/fs/read?path=/shared.txt')).status()).toBe(404); expect(errors).toEqual([]);
  console.log('Passed: automatic first visit, real PTY pipeline, shared Files/Editor save, terminal readback, refresh reattachment, and two-browser isolation.');
  console.log('This fixture validates the browser/agent flow, not Windows/WSL2 or Docker provisioning.');
} finally {
  await browser?.close(); await runtime?.close();
  if (web) await new Promise(resolve => { web.httpServer.close(resolve); web.httpServer.closeAllConnections(); });
  await fs.rm(temporary, { recursive: true, force: true });
}
function assert(value, message) { if (!value) throw new Error(message); }
