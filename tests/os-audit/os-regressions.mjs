/**
 * OS AUDIT regression suite. Every check asserts the secure/reliable behaviour, so
 * it fails on a build with the defect and passes once the OS fix is present.
 *
 *   LOPE_AUDIT_URL=http://127.0.0.1:4190 LOPE_AUDIT_BROWSER=chromium node tests/os-audit/os-regressions.mjs [filter]
 *
 * Uses isolated browser contexts, synthetic data, and the disposable audit.hostile
 * fixture (tests/os-audit/HostileFixture.tsx). Nothing touches real profiles.
 */
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.LOPE_AUDIT_URL || 'http://127.0.0.1:4190';
const engineName = process.env.LOPE_AUDIT_BROWSER || 'chromium';
const engine = { chromium, firefox, webkit }[engineName];
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const out = process.env.LOPE_AUDIT_OUT || 'docs/audits/lopeos-general-os/evidence';
await mkdir(`${out}/screenshots`, { recursive: true });

/** Synthetic signed-in local profile; mirrors tests/setup/seed-session.mjs. */
function seed({ extra = {} } = {}) {
  {
    if (sessionStorage.getItem('audit.seeded')) return;
    sessionStorage.setItem('audit.seeded', '1');
    localStorage.clear();
    localStorage.setItem('lope.accounts.v1', JSON.stringify({ version: 1, accounts: [{ id: 'audit-user', accountName: 'audituser', displayName: 'Audit User', role: 'admin', avatarDataUrl: null, passwordHint: '', password: null, createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: '2026-11-13T00:00:00.000Z' }] }));
    sessionStorage.setItem('lope.account.session.v1', 'audit-user');
    localStorage.setItem('lope.setup.complete.v1', '1');
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}
const win = (overrides = {}) => ({ id: 'w-' + Math.random().toString(16).slice(2), appId: 'lope.calculator', title: 'Calculator', bounds: { x: 200, y: 120, width: 420, height: 520 }, state: 'normal', focused: true, zIndex: 1, launchArgs: {}, ...overrides });

const results = [];
const browser = await engine.launch({ headless: true, ...(process.env.LOPE_AUDIT_EXECUTABLE ? { executablePath: process.env.LOPE_AUDIT_EXECUTABLE } : {}) });
async function check(id, title, body, options = {}) {
  if (filter && !filter.test(id)) return;
  // Fault-injection checks block the release service worker: Playwright routes cannot see its fetches.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...(options.blockServiceWorker ? { serviceWorkers: 'block' } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now();
  try {
    await body(page, context, errors);
    results.push({ id, title, result: 'PASS', ms: Date.now() - started, pageErrors: errors.slice(0, 5) });
    console.log(`PASS ${id} ${title}`);
  } catch (error) {
    await page.screenshot({ path: `${out}/screenshots/${engineName}-${id}-failure.png` }).catch(() => {});
    results.push({ id, title, result: 'FAIL', ms: Date.now() - started, error: String(error.message).split('\n').slice(0, 6).join(' | '), pageErrors: errors.slice(0, 5) });
    console.log(`FAIL ${id} ${title}\n   ${String(error.message).split('\n').slice(0, 3).join('\n   ')}\n   pageErrors: ${errors.slice(0, 3).join(' || ')}`);
  } finally { await context.close(); }
}
const desktopReady = async page => { await expect(page.locator('.desktop')).toBeVisible({ timeout: 15000 }); await expect(page.locator('.dock-item').first()).toBeVisible(); };
const fixture = page => page.evaluate(() => Object.keys(window.__auditFixture ?? {}));

// ---------- Persisted-state robustness ----------
await check('state-01', 'Malformed restored window record does not blank the desktop', async page => {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [win({ id: 'bad"]id', title: { injected: true }, zIndex: null, state: 'bogus', launchArgs: 'not-an-object', focused: 'yes' }), win({ id: 'dup', appId: 'lope.weather', title: 'Weather', bounds: { x: 760, y: 120, width: 400, height: 300 } }), win({ id: 'dup', appId: 'lope.settings', title: 'Settings', bounds: { x: 760, y: 460, width: 400, height: 300 } })] } });
  await page.goto(base); await desktopReady(page);
  await expect(page.locator('[data-app-id="lope.calculator"]')).toBeVisible();
  await expect(page.locator('[data-app-id="lope.calculator"] .window-title')).toHaveText('Calculator');
  expect(await page.locator('[data-window-id="dup"]').count(), 'window ids must be unique after restore').toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Minimize Calculator', exact: true }).click();
  await expect(page.locator('[data-app-id="lope.calculator"]')).toBeHidden();
});
await check('state-02', 'Non-array recent-apps history does not crash the Dock or block launches', async page => {
  await page.addInitScript(seed, { extra: { 'lope.history.recentApps.v1': { corrupted: true }, 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  await page.getByRole('button', { name: 'Open Weather', exact: true }).click();
  await expect(page.locator('[data-app-id="lope.weather"]')).toBeVisible();
});
await check('state-03', 'Malformed notification history entries do not crash the notification centre', async page => {
  await page.addInitScript(seed, { extra: { 'lope.history.notifications.v1': [{ id: 'n1', time: Date.now(), title: { object: 1 }, message: ['x'] }, { id: 'n2', time: Date.now(), title: 'Fine', message: 'Synthetic' }], 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  await page.getByRole('button', { name: /notification/i }).first().click();
  await expect(page.getByRole('region', { name: 'Notification history' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notification history' })).toContainText('Synthetic');
  await expect(page.locator('.dock-item').first()).toBeVisible();
});
await check('state-04', 'Personal wallpaper data URL cannot inject extra CSS image layers', async page => {
  const hostile = 'data:image/png;base64,AAAA"), url("http://127.0.0.1:9/beacon.png';
  const requests = [];
  page.on('request', request => { if (request.url().includes('beacon')) requests.push(request.url()); });
  await page.addInitScript(seed, { extra: { 'lope.assets.wallpapers.v1': { personalWallpaper: { id: 'personal', name: 'x', originalName: 'x', asset: hostile, creator: 'Personal image', sourceURL: null, creditURL: null, permission: 'original', kind: 'light', importedAt: '2026-11-13T00:00:00.000Z' } }, 'lope.preferences.v2': { version: 2, preferences: { wallpaper: 'personal' } }, 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  await page.waitForTimeout(500);
  const image = await page.locator('.wallpaper').evaluate(element => getComputedStyle(element).backgroundImage);
  expect(image.includes('beacon'), 'background must not contain an injected url() layer').toBe(false);
  expect(requests).toEqual([]);
});

// ---------- Lifecycle / failed module loads ----------
const fault = (match) => fetch(`${base}/__audit/fault?match=${encodeURIComponent(match)}`, { method: 'POST' });
const clearFault = () => fetch(`${base}/__audit/fault`, { method: 'DELETE' });
await check('life-01', 'Retrying an app whose code chunk failed to load actually reloads it', async page => {
  // The audit server returns a real 503 (as a host mid-deployment would); no browser-side interception.
  await fault('^/assets/calculator-[^/]+\\.js$');
  try {
    await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [win()] } });
    await page.goto(base); await desktopReady(page);
    await expect(page.getByText('This app couldn’t open.')).toBeVisible();
    await clearFault();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    // Chromium re-imports in place. WebKit keeps a failed module for the document's
    // lifetime, so the OS must offer a guarded reload that restores the same window.
    const app = page.getByTestId('calculator-app'), reload = page.getByRole('button', { name: 'Reload LopeOS', exact: true });
    await expect(app.or(reload)).toBeVisible({ timeout: 8000 });
    if (!await app.isVisible()) { await reload.click(); await expect(app).toBeVisible({ timeout: 15000 }); }
  } finally { await clearFault(); }
}, { blockServiceWorker: true });
await check('life-02', 'A failed desktop (Shell) chunk shows a recovery path instead of a blank page', async page => {
  await fault('^/assets/Shell-[^/]+\\.js$');
  try {
    await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [] } });
    await page.goto(base);
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Reload LopeOS', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset window layout and reload', exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/screenshots/${engineName}-boot-recovery.png` });
    await clearFault();
    await page.getByRole('button', { name: 'Reload LopeOS', exact: true }).click();
    await desktopReady(page);
  } finally { await clearFault(); }
}, { blockServiceWorker: true });

// ---------- App boundary (disposable hostile fixture) ----------
async function launchFixture(page) {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [win({ appId: 'audit.hostile', title: 'Audit Fixture' })] } });
  await page.goto(base); await desktopReady(page);
  await expect.poll(() => fixture(page)).toHaveLength(1);
}
await check('app-01', 'App cannot execute another window’s scoped commands or privileged shell commands', async page => {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [win({ id: 'victim', appId: 'audit.hostile', title: 'Victim' }), win({ id: 'attacker', appId: 'audit.hostile', title: 'Attacker', zIndex: 2 })] } });
  await page.goto(base); await desktopReady(page);
  await expect.poll(() => fixture(page)).toHaveLength(2);
  const outcome = await page.evaluate(async () => {
    const ids = Object.keys(window.__auditFixture); const attacker = window.__auditFixture[ids.find(id => window.__auditFixture[id].windowId !== ids[0]) ?? ids[1]];
    const victimId = ids.find(id => id !== attacker.windowId);
    const crossWindow = attacker.services.commands.get(`${victimId}.fixture.ping`);
    let executedCross = false; try { await attacker.services.commands.execute(`${victimId}.fixture.ping`); executedCross = true; } catch {}
    const signOut = attacker.services.commands.get('shell.signOut');
    const close = attacker.services.commands.get('shell.close');
    return { crossWindow: !!crossWindow, signOut: !!signOut, close: !!close, executedCross };
  });
  await expect(page.locator('[data-window-id] [data-testid="fixture-log"]').filter({ hasText: 'ping' })).toHaveCount(0);
  expect(outcome.crossWindow, 'get() must not return another window’s command').toBe(false);
  expect(outcome.close || outcome.signOut, 'apps must not reach shell lifecycle/session commands').toBe(false);
});
await check('app-02', 'File access revoked in Settings is denied at operation time via the API', async page => {
  await launchFixture(page);
  const outcome = await page.evaluate(async () => {
    const context = Object.values(window.__auditFixture)[0];
    const prefs = JSON.parse(localStorage.getItem('lope.preferences.user.audit-user.v2') || localStorage.getItem('lope.preferences.v2') || '{"version":2,"preferences":{}}');
    window.dispatchEvent(new Event('audit:noop'));
    const settings = context.services.settings; const fileAccess = { ...(settings.get('fileAccess', {})), 'audit.hostile': false };
    settings.set('fileAccess', fileAccess);
    const attempt = async fn => { try { await fn(); return 'allowed'; } catch (error) { return 'denied:' + error.message; } };
    return { read: await attempt(() => context.services.files.read('/Documents/x.txt')), list: await attempt(() => context.services.files.list('/')), dialog: await attempt(() => context.services.dialogs.openFile()), open: await attempt(() => context.services.openFile('/Documents/x.txt')), prefs: !!prefs };
  });
  for (const value of [outcome.read, outcome.list, outcome.dialog, outcome.open]) expect(value).toMatch(/^denied:.*disabled/);
});
await check('app-03', 'Notification storm from one app stays bounded and does not freeze the shell', async page => {
  await launchFixture(page);
  const elapsed = await page.evaluate(() => { const context = Object.values(window.__auditFixture)[0]; const t = performance.now(); for (let i = 0; i < 2000; i++) context.services.notify({ title: 'Storm ' + i, message: 'Synthetic flood' }); return performance.now() - t; });
  await page.waitForTimeout(300);
  const started = Date.now(); await page.getByRole('button', { name: 'Open Weather', exact: true }).click(); await expect(page.locator('[data-app-id="lope.weather"]')).toBeVisible();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('lope.history.notifications.v1') || '[]').length);
  expect(await page.locator('.toast').count()).toBeLessThanOrEqual(2);
  expect(history).toBeLessThanOrEqual(100);
  expect(elapsed, 'synchronous cost of 2000 notify() calls (ms)').toBeLessThan(1500);
  expect(Date.now() - started).toBeLessThan(3000);
});
await check('app-04', 'Window-launch storm from one app is capped', async page => {
  await launchFixture(page);
  await page.evaluate(() => { const context = Object.values(window.__auditFixture)[0]; for (let i = 0; i < 200; i++) context.services.launch('lope.editor', { path: `/Documents/storm-${i}.txt` }); });
  await page.waitForTimeout(1500);
  const count = await page.locator('[data-window-id]').count();
  expect(count, 'open windows after a 200-launch storm').toBeLessThanOrEqual(40);
});
await check('app-05', 'App notifications are attributed so an app cannot impersonate the OS', async page => {
  await launchFixture(page);
  await page.evaluate(() => Object.values(window.__auditFixture)[0].services.notify({ title: 'LopeOS Security', message: 'Your session expired. Re-enter your password.' }));
  const toast = page.locator('.toast').last();
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Audit Fixture');
  await page.screenshot({ path: `${out}/screenshots/${engineName}-notification-attribution.png`, clip: { x: 900, y: 0, width: 540, height: 260 } });
});
await check('app-06', 'Closed window context cannot open OS file dialogs or register commands', async page => {
  await launchFixture(page);
  const outcome = await page.evaluate(async () => {
    const [id, context] = Object.entries(window.__auditFixture)[0];
    window.__stale = context; context.lifecycle.close();
    await new Promise(resolve => setTimeout(resolve, 400));
    const stale = window.__stale; let dialog;
    const pending = stale.services.dialogs.openFile().then(value => (dialog = 'resolved:' + value), error => (dialog = 'denied:' + error.message));
    await Promise.race([pending, new Promise(resolve => setTimeout(resolve, 600))]);
    stale.services.commands.register({ id: 'fixture.zombie', label: 'Zombie', execute() {} });
    return { dialog, open: !!document.querySelector('.file-dialog'), zombie: !!stale.services.commands.get('fixture.zombie'), id };
  });
  expect(outcome.open, 'no file dialog for a closed window').toBe(false);
  expect(outcome.dialog ?? 'pending').toMatch(/^denied:/);
  expect(outcome.zombie, 'closed window cannot register commands').toBe(false);
});

// ---------- Accessibility ----------
await check('a11y-01', 'Spotlight keeps Tab focus inside the dialog for 25 presses', async page => {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('.spotlight')).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.spotlight')), `focus left Spotlight after ${i + 1} Tab presses`).toBe(true);
  }
});
await check('a11y-02', 'OS file dialog keeps Tab focus inside and Escape cancels it', async page => {
  await launchFixture(page);
  await page.evaluate(() => { window.__dialogResult = 'pending'; Object.values(window.__auditFixture)[0].services.dialogs.saveFile({ defaultName: 'audit.txt' }).then(value => { window.__dialogResult = value; }, error => { window.__dialogResult = 'error:' + error.message; }); });
  await expect(page.locator('.file-dialog')).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.file-dialog')), `focus left the file dialog after ${i + 1} presses`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.file-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__dialogResult)).toBeNull();
});
await check('kbd-01', 'Global shortcuts still work after launching an app from the Dock', async page => {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  await page.getByRole('button', { name: 'Open Weather', exact: true }).click();
  await expect(page.locator('[data-app-id="lope.weather"]')).toBeVisible();
  // Chromium focuses a clicked button; WebKit does not, so place focus on the Dock explicitly.
  await page.getByRole('button', { name: 'Open Weather', exact: true }).focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.spotlight')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.spotlight')).toBeHidden();
});
await check('ui-01', 'PerfectHue credit is visible, unobstructed, and uses the manifest credit URL', async page => {
  await page.addInitScript(seed, { extra: { 'lope.session.layout.v1': [] } });
  await page.goto(base); await desktopReady(page);
  const credit = page.getByRole('link', { name: 'perfecthue', exact: true });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute('href', 'https://perfecthue.com/wallpapers/');
  const box = await credit.boundingBox(); const viewport = page.viewportSize();
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 200); expect(box.y + box.height).toBeGreaterThan(viewport.height - 120);
  const topmost = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.textContent, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(topmost, 'credit link must be the topmost element at its centre').toBe('perfecthue');
  await page.screenshot({ path: `${out}/screenshots/${engineName}-credit.png`, clip: { x: viewport.width - 360, y: viewport.height - 160, width: 360, height: 160 } });
});

await browser.close();
const summary = { engine: engineName, base, ranAt: new Date().toISOString(), pass: results.filter(r => r.result === 'PASS').length, fail: results.filter(r => r.result === 'FAIL').length, results };
await writeFile(`${out}/os-regressions-${engineName}${process.env.LOPE_AUDIT_TAG ? '-' + process.env.LOPE_AUDIT_TAG : ''}.json`, JSON.stringify(summary, null, 2));
console.log(`\n${engineName}: ${summary.pass} pass, ${summary.fail} fail`);
