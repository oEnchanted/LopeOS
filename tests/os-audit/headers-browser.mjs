/**
 * OS AUDIT: measure the proposed production headers in a real browser before they
 * reach Caddy. Serve the build with LOPE_AUDIT_HEADERS=1 (tests/os-audit/serve.mjs).
 *
 *   LOPE_AUDIT_URL=http://127.0.0.1:4192 LOPE_AUDIT_BROWSER=chromium node tests/os-audit/headers-browser.mjs
 *
 * Third-party hosts are answered with synthetic responses (CSP is evaluated before
 * the request reaches the route), so no external service is contacted.
 */
import { chromium, webkit, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const base = process.env.LOPE_AUDIT_URL || 'http://127.0.0.1:4192';
const engineName = process.env.LOPE_AUDIT_BROWSER || 'chromium';
const browser = await { chromium, webkit }[engineName].launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleIssues = [], pageErrors = [], external = [];
page.on('console', message => { const text = message.text(); if (/Content Security Policy|Content-Security-Policy|Permissions-Policy|Unrecognized feature|Refused to/i.test(text)) consoleIssues.push(`${message.type()}: ${text.slice(0, 300)}`); });
page.on('pageerror', error => pageErrors.push(error.message));
await context.route(url => !url.href.startsWith(base), route => {
  external.push(new URL(route.request().url()).host);
  const url = route.request().url();
  if (url.includes('open-meteo.com')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ latitude: 39.7, longitude: -105, timezone: 'America/Denver', current: { time: '2026-11-13T16:00', temperature_2m: 12, apparent_temperature: 11, relative_humidity_2m: 40, weather_code: 1, wind_speed_10m: 5, is_day: 1 }, hourly: { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [] }, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], sunrise: [], sunset: [] }, results: [] }) });
  return route.fulfill({ status: 404, body: '' });
});
await page.addInitScript(() => {
  if (sessionStorage.getItem('audit.seeded')) return; sessionStorage.setItem('audit.seeded', '1'); localStorage.clear();
  localStorage.setItem('lope.accounts.v1', JSON.stringify({ version: 1, accounts: [{ id: 'audit-user', accountName: 'audituser', displayName: 'Audit User', role: 'admin', avatarDataUrl: null, passwordHint: '', password: null, createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: '2026-11-13T00:00:00.000Z' }] }));
  sessionStorage.setItem('lope.account.session.v1', 'audit-user'); localStorage.setItem('lope.setup.complete.v1', '1'); localStorage.setItem('lope.session.layout.v1', '[]');
});
const steps = [];
const step = async (name, fn) => { try { await fn(); steps.push({ name, result: 'PASS' }); } catch (error) { steps.push({ name, result: 'FAIL', error: String(error.message).split('\n')[0] }); } };
await step('Desktop boots under enforced + report-only policy', async () => { await page.goto(base); await expect(page.locator('.dock-item').first()).toBeVisible({ timeout: 15000 }); });
for (const app of ['Weather', 'Files', 'Lope Browser']) await step(`Launch ${app}`, async () => { const button = page.getByRole('button', { name: `Open ${app}`, exact: true }); if (await button.count()) { await button.click(); await page.waitForTimeout(800); } });
await step('Spotlight opens and searches', async () => { await page.keyboard.press('Control+k'); await expect(page.locator('.spotlight')).toBeVisible(); await page.keyboard.type('settings'); await page.keyboard.press('Enter'); await expect(page.locator('[data-app-id="lope.settings"]')).toBeVisible(); });
await step('Settings wallpaper + appearance panes render', async () => { const settings = page.getByTestId('settings-app'); for (const pane of ['Wallpaper', 'Appearance', 'Privacy & Security']) { const button = settings.getByRole('button', { name: pane, exact: true }); if (await button.count()) { await button.first().click(); await page.waitForTimeout(400); } } });
await step('Control Center and notifications open', async () => { await page.keyboard.press('Escape'); for (const name of [/control center|quick settings/i, /notification/i]) { const button = page.getByRole('button', { name }).first(); if (await button.count()) { await button.click(); await page.waitForTimeout(300); await page.keyboard.press('Escape'); } } });
await page.waitForTimeout(1500);
const framing = await browser.newPage();
const framingIssues = [];
framing.on('console', message => framingIssues.push(message.text().slice(0, 200)));
await framing.setContent(`<iframe id="probe" src="${base}/" width="400" height="300"></iframe>`);
await framing.waitForTimeout(3000);
const framed = await framing.evaluate(() => { try { return document.getElementById('probe').contentWindow.document.body?.innerHTML.length ?? 0; } catch { return 'cross-origin (inaccessible)'; } });
const framedRendered = await framing.frames().find(frame => frame !== framing.mainFrame())?.locator('.desktop, .setup-screen').count().catch(() => 0);
const reports = await (await fetch(`${base}/__audit/csp-reports`)).json();
const summary = { engine: engineName, base, ranAt: new Date().toISOString(), steps, enforced: { pageErrors, framedByForeignOrigin: { rendered: framedRendered > 0, accessibleBody: framed, console: framingIssues.filter(text => /frame|ancestor|X-Frame/i.test(text)) } }, reportOnly: { reportCount: reports.length, reports: reports.map(text => { try { const value = JSON.parse(text)['csp-report']; return { directive: value['violated-directive'], blocked: value['blocked-uri'], source: value['source-file'] }; } catch { return text.slice(0, 200); } }) }, consoleIssues: [...new Set(consoleIssues)], externalHostsRequested: [...new Set(external)] };
await writeFile(`docs/audits/lopeos-general-os/evidence/headers-${engineName}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
if (steps.some(s => s.result === 'FAIL') || pageErrors.length || framedRendered > 0) process.exitCode = 1;
