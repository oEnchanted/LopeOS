import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture';

type Manifest = { build: string; version: string; totalBytes: number; assets: { url: string; size: number; sha256: string }[] };
type WorkerReply = { type: string; release?: Manifest; message?: string; currentCached?: boolean };
async function configure(request: APIRequestContext, settings: Record<string, unknown>) {
  const response = await request.post('/__test__/configure', { data: settings });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<{ build: string }>;
}
async function manifest(page: Page): Promise<Manifest> {
  return page.evaluate(async () => (await fetch('/__lope/version.json', { cache: 'no-store' })).json());
}
async function command(page: Page, message: Record<string, unknown>): Promise<WorkerReply> {
  return page.evaluate(async message => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<any>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Worker command timed out')); }, 45000);
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'PROGRESS') return;
        clearTimeout(timeout); channel.port1.close(); resolve(data);
      };
      registration.active!.postMessage(message, [channel.port2]);
    });
  }, message);
}
async function installFixture(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/lope-sw.js', { scope: '/', updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
  const release = await manifest(page);
  expect((await command(page, { type: 'LOPE_CACHE_RELEASE', release, activate: true })).type).toBe('COMPLETE');
  expect((await command(page, { type: 'LOPE_PIN', build: release.build })).type).toBe('COMPLETE');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Release A');
  return release;
}
async function readLazy(page: Page) { return page.evaluate(async () => (await fetch('/assets/lazy.txt')).text()); }

// A real service worker and two separate releases exercise deployment/cache semantics.
test.beforeEach(async ({ request }) => { await configure(request, { mode: 'fixture', release: 'a', corrupt: false, delay: 0, modelUpdates: false }); });

test('a deployment keeps the installed release across reloads and offline startup', async ({ page, context, request }) => {
  const a = await installFixture(page);
  await configure(request, { release: 'b' });
  const b = await manifest(page); expect(b.build).not.toBe(a.build);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Release A');
  expect(await readLazy(page)).toBe('Lazy asset from A');
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(a.build);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Release A');
  expect(await readLazy(page)).toBe('Lazy asset from A');
});

test('staged downloads do not switch releases; explicit activation does and preserves old tabs', async ({ page, context, request }) => {
  const a = await installFixture(page);
  const oldTab = await context.newPage(); await oldTab.goto('/');
  expect((await command(oldTab, { type: 'LOPE_PIN', build: a.build })).type).toBe('COMPLETE');
  await configure(request, { release: 'b' });
  const b = await manifest(page);
  expect((await command(page, { type: 'LOPE_CACHE_RELEASE', release: b, activate: false })).type).toBe('COMPLETE');
  await page.reload(); await expect(page.locator('h1')).toHaveText('Release A');
  expect((await command(page, { type: 'LOPE_ACTIVATE', build: b.build })).type).toBe('COMPLETE');
  await page.reload(); await expect(page.locator('h1')).toHaveText('Release B');
  expect(await readLazy(page)).toBe('Lazy asset from B');
  expect(await readLazy(oldTab)).toBe('Lazy asset from A');
  await oldTab.reload(); await expect(oldTab.locator('h1')).toHaveText('Release B');
});

test('corrupt or incomplete release never replaces the working cache', async ({ page, context, request }) => {
  const a = await installFixture(page);
  await configure(request, { release: 'b', corrupt: true });
  const b = await manifest(page);
  const result = await command(page, { type: 'LOPE_CACHE_RELEASE', release: b, activate: false });
  expect(result.type).toBe('ERROR');
  expect((await command(page, { type: 'LOPE_ACTIVATE', build: b.build })).type).toBe('ERROR');
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(a.build);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('h1')).toHaveText('Release A');
  expect(await readLazy(page)).toBe('Lazy asset from A');
  await context.setOffline(false); await configure(request, { corrupt: false });
  expect((await command(page, { type: 'LOPE_CACHE_RELEASE', release: b, activate: false })).type).toBe('COMPLETE');
  expect((await command(page, { type: 'LOPE_ACTIVATE', build: b.build })).type).toBe('COMPLETE');
  await page.reload(); await expect(page.locator('h1')).toHaveText('Release B');
});

async function openUpdates(page: Page) {
  const settings = page.getByTestId('settings-app');
  if (!await settings.count()) await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Software Update', exact: true }).click();
  return page.getByTestId('software-update-settings');
}
async function productionWorkspace(page: Page, request: APIRequestContext) {
  const { build } = await configure(request, { mode: 'production', release: 'a' });
  await installContractRuntime(page);
  await page.goto('/'); await expect(page.locator('.desktop')).toBeVisible();
  const updates = await openUpdates(page);
  await expect(updates.getByText('This release is saved in your browser', { exact: true })).toBeVisible({ timeout: 60000 });
  return { updates, build };
}

test('production UI offers a release with size, Later persists, and cached desktop starts offline', async ({ page, request, context }, testInfo) => {
  const { updates, build } = await productionWorkspace(page, request);
  await configure(request, { release: 'b' });
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true });
  await expect(prompt).toBeVisible(); await expect(prompt).toContainText('Release size'); await expect(prompt).toContainText('MB');
  await page.screenshot({ path: testInfo.outputPath('software-update-prompt.png') });
  await prompt.getByRole('button', { name: 'Later', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('software-update-settings.png') });
  await page.reload(); await expect(page.locator('.desktop')).toBeVisible();
  await expect(prompt).toHaveCount(0);
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.desktop')).toBeVisible();
  const offlineSettings = await openUpdates(page);
  await expect(offlineSettings.getByText('Offline', { exact: true })).toBeVisible();
  await expect(prompt).toHaveCount(0);
});

test('production update shows the black progress screen and restarts into the verified release without erasing data', async ({ page, request }, testInfo) => {
  const { updates, build } = await productionWorkspace(page, request);
  const before = await page.evaluate(() => {
    localStorage.setItem('lope.update-test.draft', 'My unsaved recovery draft');
    return { accounts: localStorage.getItem('lope.accounts.v1'), session: sessionStorage.getItem('lope.account.session.v1') };
  });
  const { build: nextBuild } = await configure(request, { release: 'b', delay: 2000 }); expect(nextBuild).not.toBe(build);
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  // Record the visible phases across the reload, including very fast cached downloads.
  await page.evaluate(() => {
    const phases: { name: string; time: number; progress: number }[] = [];
    new MutationObserver(() => {
      const boot = document.querySelector('.software-update-boot');
      const name = boot?.querySelector('h1')?.textContent;
      if (!name || phases.at(-1)?.name === name) return;
      phases.push({ name, time: performance.now(), progress: Number(boot?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) });
      sessionStorage.setItem('lope.update-test.phases', JSON.stringify(phases));
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const boot = page.getByRole('dialog', { name: 'Updating LopeOS', exact: true });
  await expect(boot).toBeVisible();
  await expect(boot).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(boot.getByRole('progressbar')).toBeVisible();
  await expect(boot.getByRole('status')).toHaveText('Downloading update…');
  await expect(boot).toContainText('downloaded'); await expect(boot).toContainText('files');
  await page.screenshot({ path: testInfo.outputPath('software-update-progress.png') });
  await expect(boot).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('.desktop')).toBeVisible();
  const phases = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lope.update-test.phases') || '[]') as { name: string; time: number; progress: number }[]);
  expect(phases.map(phase => phase.name)).toEqual([
    'Checking update availability…', 'Checking browser storage…', 'Checking for model updates…',
    'Downloading update…', 'Verifying update…', 'Installing update…', 'Restarting LopeOS…',
  ]);
  expect(phases.slice(0, -1).every(phase => phase.progress < 100)).toBe(true);
  expect(phases.at(-1)?.progress).toBe(100);
  for (const index of [0, 1, 2, 4, 5]) expect(phases[index + 1].time - phases[index].time).toBeGreaterThanOrEqual(900);
  const after = await openUpdates(page);
  await expect(after.getByText('This release is saved in your browser', { exact: true })).toBeVisible();
  await after.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(after.getByText('You’re using the latest published release.', { exact: true })).toBeVisible();
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(nextBuild);
  expect(await page.evaluate(() => ({ accounts: localStorage.getItem('lope.accounts.v1'), session: sessionStorage.getItem('lope.account.session.v1'), draft: localStorage.getItem('lope.update-test.draft') }))).toEqual({ ...before, draft: 'My unsaved recovery draft' });
});

test('storage preflight stops before downloading and preserves the installed release', async ({ page, request }) => {
  const { updates, build } = await productionWorkspace(page, request);
  await configure(request, { release: 'b' });
  await page.evaluate(() => { navigator.storage.estimate = async () => ({ quota: 1024, usage: 1024 }); });
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const boot = page.getByRole('dialog', { name: 'Updating LopeOS', exact: true });
  await expect(boot.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(boot.getByRole('alert')).toContainText(/storage/i);
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
  expect(await page.evaluate(async () => {
    const metadata = await caches.open('lope.os.metadata.v1');
    const installed = await (await metadata.match('/__lope/cache/installed'))!.json();
    return (await caches.keys()).filter(name => name.startsWith('lope.os.release.v1:') && name !== 'lope.os.release.v1:' + encodeURIComponent(installed.build));
  })).toEqual([]);
  await boot.getByRole('button', { name: 'Back to desktop', exact: true }).click();
  await expect(page.locator('.desktop')).toBeVisible();
});

test('storage preflight allows reclaiming obsolete release caches before installing', async ({ page, request }) => {
  const { updates } = await productionWorkspace(page, request);
  const { build: nextBuild } = await configure(request, { release: 'b' });
  await page.evaluate(async () => {
    await caches.open('lope.os.release.v1:obsolete-test-release');
    navigator.storage.estimate = async () => ({ quota: 1024, usage: 1024 });
  });
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const boot = page.getByRole('dialog', { name: 'Updating LopeOS', exact: true });
  await expect(boot).toBeVisible();
  await expect(boot).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('.desktop')).toBeVisible();
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(nextBuild);
  expect(await page.evaluate(() => caches.has('lope.os.release.v1:obsolete-test-release'))).toBe(false);
});

test('model preflight reports changed model packages before downloading the OS', async ({ page, request }) => {
  const { updates } = await productionWorkspace(page, request);
  await configure(request, { release: 'b', modelUpdates: true, delay: 2000 });
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const boot = page.getByRole('dialog', { name: 'Updating LopeOS', exact: true });
  await expect(boot.getByRole('status')).toHaveText('Checking for model updates…');
  await expect(boot).toContainText('Model updates found');
  await expect(boot.getByRole('status')).toHaveText('Downloading update…');
  await expect(boot).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('.desktop')).toBeVisible();
});

test('production failed update offers recovery and keeps the installed release', async ({ page, request }) => {
  const { updates, build } = await productionWorkspace(page, request);
  await configure(request, { release: 'b', corrupt: true });
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const boot = page.getByRole('dialog', { name: 'Updating LopeOS', exact: true });
  await expect(boot.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(boot).toContainText('Your installed release and saved data are still available.');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  // Background reconnect checks must leave the foreground error actionable.
  await page.waitForTimeout(500);
  await expect(boot).toHaveAttribute('data-phase', 'error');
  await expect(boot.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
  await boot.getByRole('button', { name: 'Back to desktop', exact: true }).click();
  await expect(boot).toHaveCount(0); await expect(page.locator('.desktop')).toBeVisible();
  await page.reload(); await expect(page.locator('.desktop')).toBeVisible();
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
});

test('canceling an unsaved-document prompt prevents download and keeps the draft open', async ({ page, request }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  const { updates, build } = await productionWorkspace(page, request);
  await page.getByRole('button', { name: 'Open Text Editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document content', exact: true }).fill('Keep this unsaved work');
  const { build: nextBuild } = await configure(request, { release: 'b' });
  // Keep the editor covered so preparation must reveal its save/discard prompt.
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('dialog', { name: 'A LopeOS update is available', exact: true }).getByRole('button', { name: 'Download & install', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Save your changes?', exact: true });
  await expect(guard).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Updating LopeOS', exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Document content', exact: true })).toHaveValue('Keep this unsaved work');
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
  await expect(page.getByRole('dialog', { name: 'Updating LopeOS', exact: true })).toHaveCount(0);
  // A subsequent explicit discard must retire the editor's native unload guard
  // before restarting; otherwise the browser can cancel a committed update.
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await updates.getByRole('button', { name: 'Download & install', exact: true }).click();
  await expect(guard).toBeVisible();
  const reload = page.waitForEvent('load');
  await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await reload;
  await expect(page.locator('.desktop')).toBeVisible();
  expect(nativeDialogs).toEqual([]);
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(nextBuild);
});

test('production factory reset erases local data and safely rebuilds the installed release cache', async ({ page, request }) => {
  const { build } = await productionWorkspace(page, request);
  await page.evaluate(() => {
    localStorage.setItem('lope.update-reset.draft', 'Erase this local recovery data');
    localStorage.setItem('lope.setup.complete.v1', '1');
    localStorage.setItem('unrelated-app.setting', 'Keep unrelated site data');
  });
  const settings = page.getByTestId('settings-app');
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'General', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset LopeOS…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Reset LopeOS?', exact: true }).getByRole('button', { name: 'Erase and restart', exact: true }).click();
  await expect(page.locator('.reset-boot')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to LopeOS', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.reset-boot')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    accounts: localStorage.getItem('lope.accounts.v1'),
    draft: localStorage.getItem('lope.update-reset.draft'),
    setup: localStorage.getItem('lope.setup.complete.v1'),
    pending: localStorage.getItem('lope.reset.pending.v1'),
    unrelated: localStorage.getItem('unrelated-app.setting'),
  }))).toEqual({ accounts: null, draft: null, setup: null, pending: null, unrelated: 'Keep unrelated site data' });
  await expect.poll(async () => (await command(page, { type: 'LOPE_STATUS', build })).currentCached, { timeout: 30000 }).toBe(true);
  expect((await command(page, { type: 'LOPE_STATUS' })).release?.build).toBe(build);
});
