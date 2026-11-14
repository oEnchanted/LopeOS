import { expect, test } from '@playwright/test';
import { open } from 'node:fs/promises';
import { installContractRuntime } from '../integration/contract-runtime-fixture';
import { expectFooterInViewport, freshSetup, next, panel } from './helpers';
import { wallpapers } from '../../apps/web/src/shell/wallpapers';

test.use({ serviceWorkers: 'block' });

const pageSize = 6;
const pageStatus = (count: number, page = 0) => `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} of ${count} wallpapers`;

test('all bundled Perfect Hue originals and previews are available', async ({ page }) => {
  const approved = wallpapers.filter(w => w.creator === 'Perfect Hue');
  test.setTimeout(Math.max(35000, approved.length * 300));
  await installContractRuntime(page);
  await page.goto('/');
  expect(approved.length).toBeGreaterThan(0);
  const pairs = new Map<string, string[]>();
  for (const wallpaper of approved) {
    expect(['light', 'dark']).toContain(wallpaper.kind);
    if (/ · (Light|Dark)$/.test(wallpaper.name)) {
      const name = wallpaper.name.replace(/ · (Light|Dark)$/, '');
      pairs.set(name, [...(pairs.get(name) || []), wallpaper.kind]);
      expect(wallpaper.name.endsWith(wallpaper.kind === 'light' ? ' · Light' : ' · Dark')).toBe(true);
    }
    expect(wallpaper.permission).toBe('authorized');
    expect(wallpaper.sourceURL).toMatch(/^https:\/\/perfecthue\.com\/wallpapers\/.+/);
    expect(wallpaper.creditURL).toBe('https://perfecthue.com/wallpapers/');
  }
  // Preserve the established paired collections; standalone artwork may have only one tone.
  for (const name of ['Aurora Glass', 'Orange Wave', 'Sky Orbs', 'Purple Aqua Waves', 'Tropical Aqua Office', 'Purple Staircase Atrium', 'Tropical Waterfalls', 'Waterfall Wave Walk', 'Open Air Office', 'Eco Overpass', 'Cobalt Tech Waves', 'Amber Tech Waves', 'Tropical Office', 'Circular Office Park']) {
    expect(pairs.get(name)?.sort(), `${name} has one light and one dark variant`).toEqual(['dark', 'light']);
  }
  expect(new Set(wallpapers.map(w => w.id)).size).toBe(wallpapers.length);
  expect(new Set(approved.map(w => w.asset)).size).toBe(approved.length);
  expect(new Set(approved.map(w => w.sourceURL)).size).toBe(approved.length);
  for (const wallpaper of approved) {
    const file = await open(new URL('../../public' + wallpaper.asset, import.meta.url), 'r');
    try {
      const header = Buffer.alloc(32);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      expect(bytesRead, wallpaper.asset).toBe(header.length);
      expect(header.subarray(0, 8).toString('hex'), wallpaper.asset).toBe('89504e470d0a1a0a');
      expect([header.readUInt32BE(16), header.readUInt32BE(20)], wallpaper.asset).toEqual([3840, 2160]);
    } finally { await file.close(); }
    expect(wallpaper.thumbnail).toBeTruthy();
  }
  const previews = await page.evaluate(async items => {
    const dimensions: number[][] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < items.length) {
        const index = next++;
        const image = new Image(); image.src = items[index].thumbnail!; await image.decode();
        dimensions[index] = [image.naturalWidth, image.naturalHeight];
      }
    }));
    return dimensions;
  }, approved);
  expect(previews).toEqual(approved.map(() => [640, 360]));
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 600 }]) {
  for (const surface of ['setup', 'settings'] as const) {
    test(`${surface} browses the full wallpaper collection at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
      const total = wallpapers.length;
      const pageCount = Math.ceil(total / pageSize);
      test.setTimeout(Math.max(35000, 15000 + pageCount * 1500));
      await page.setViewportSize(viewport);
      if (viewport.width < 700) await page.addInitScript(() => {
        localStorage.setItem('lope.preferences.v2', JSON.stringify({ version: 2, preferences: { theme: 'dark', textSize: 150, reduceTransparency: true, increaseContrast: true, reduceMotion: true, effectsQuality: 'low' } }));
      });
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const originals = new Set<string>();
      page.on('request', request => { if (/\/wallpapers\/.*\.png$/.test(request.url())) originals.add(new URL(request.url()).pathname); });
      if (surface === 'setup') {
        await freshSetup(page);
        await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
      } else {
        await installContractRuntime(page); await page.goto('/');
        await page.getByRole('menuitem', { name: 'LopeOS system menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'System Settings…', exact: true }).click();
        const settings = page.getByTestId('settings-app');
        if (viewport.width < 700) await settings.getByRole('combobox', { name: 'Settings category' }).selectOption('wallpaper');
        else await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Wallpaper', exact: true }).click();
      }
      const picker = page.getByRole('group', { name: 'Wallpaper collection', exact: true });
      const choices = picker.getByRole('group', { name: 'Wallpaper choices', exact: true });
      await expect(choices.getByRole('button')).toHaveCount(Math.min(pageSize, total));
      await expect(picker.getByRole('status')).toHaveText(pageStatus(total));
      const names: string[] = [];
      for (let index = 0; index < pageCount; index++) {
        await expect(picker.getByRole('status')).toHaveText(pageStatus(total, index));
        await expect(choices.getByRole('button')).toHaveCount(Math.min(pageSize, total - index * pageSize));
        names.push(...await choices.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!)));
        if (index < pageCount - 1) {
          const nextPage = picker.getByRole('button', { name: 'Next wallpapers', exact: true });
          await nextPage.scrollIntoViewIfNeeded();
          const before = await nextPage.boundingBox();
          await nextPage.click();
          await expect(nextPage).toBeFocused();
          const after = await nextPage.boundingBox();
          expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
        }
      }
      expect(new Set(names).size).toBe(total);
      expect(names).toEqual(wallpapers.map(w => w.name));
      await expect(picker.getByRole('button', { name: 'Next wallpapers', exact: true })).toBeDisabled();
      await page.keyboard.press('Enter');
      await expect(picker.getByRole('status')).toHaveText(pageStatus(total, pageCount - 1));
      const previousPage = picker.getByRole('button', { name: 'Previous wallpapers', exact: true });
      await previousPage.focus(); await page.keyboard.press('Space');
      await expect(picker.getByRole('status')).toHaveText(pageStatus(total, Math.max(0, pageCount - 2)));
      await expect(previousPage).toBeFocused();
      // Browsing every page must never download each full-size desktop image.
      expect(originals.size).toBeLessThanOrEqual(2);
      await picker.getByRole('button', { name: 'Light wallpapers', exact: true }).click();
      await expect(picker.getByRole('status')).toHaveText(pageStatus(wallpapers.filter(w => w.kind === 'light').length));
      await picker.getByRole('button', { name: 'Dark wallpapers', exact: true }).click();
      await expect(picker.getByRole('status')).toHaveText(pageStatus(wallpapers.filter(w => w.kind === 'dark').length));
      for (const label of await choices.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))) expect(label).toContain('Dark');
      const search = picker.getByRole('searchbox', { name: 'Search wallpapers', exact: true });
      await search.fill('Cobalt Tech Waves');
      await expect(choices.getByRole('button')).toHaveCount(1);
      await search.press('Enter');
      await expect(picker).toBeVisible();
      await choices.getByRole('button', { name: 'Cobalt Tech Waves · Dark', exact: true }).click();
      await expect(choices.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
      const background = surface === 'setup' ? page.locator('.setup-background').first() : page.locator('.wallpaper');
      await expect(background).toHaveCSS('background-image', /perfecthue-cobalt-tech-waves-dark\.png/);
      await search.fill('no wallpaper matches this');
      await expect(choices.getByRole('button')).toHaveCount(0);
      await expect(picker).toContainText('No wallpapers match your search.');
      await picker.getByRole('button', { name: 'Show selected wallpaper', exact: true }).click();
      await expect(choices.getByRole('button', { name: 'Cobalt Tech Waves · Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(choices.getByRole('button', { name: 'Cobalt Tech Waves · Dark', exact: true })).toBeFocused();
      expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (surface === 'setup') {
        await expectFooterInViewport(page);
        await next(page);
        await page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button', { name: 'Appearance', exact: true }).click();
      } else {
        await page.reload();
        const settings = page.getByTestId('settings-app');
        if (viewport.width < 700) await settings.getByRole('combobox', { name: 'Settings category' }).selectOption('wallpaper');
        else await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Wallpaper', exact: true }).click();
      }
      await expect(choices.getByRole('button', { name: 'Cobalt Tech Waves · Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await picker.locator('.wallpaper-picker-search').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${surface}-${viewport.width}-wallpapers.png`) });
      expect(errors).toEqual([]);
    });
  }
}

test('setup keeps a loaded backdrop while new images load and rapid choices settle on the latest wallpaper', async ({ page }) => {
  await freshSetup(page);
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
  const choices = page.getByRole('group', { name: 'Wallpaper choices', exact: true });
  const backdrop = page.locator('.setup-background').first();
  const original = await backdrop.evaluate(element => getComputedStyle(element).backgroundImage);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/wallpapers/perfecthue-orange-wave-light.png', async route => { await pending; await route.continue(); });
  const delayed = page.waitForRequest('**/wallpapers/perfecthue-orange-wave-light.png');
  try {
    await choices.getByRole('button', { name: 'Orange Wave · Light', exact: true }).click();
    await delayed;
    await expect(backdrop).toHaveCSS('background-image', original);
    await expect(page.locator('.setup-background--incoming')).toHaveCount(0);

    const fade = page.evaluate(() => new Promise<{ animation: string; duration: number; baseOpacity: string; image: string }>(resolve => {
      const observer = new MutationObserver(() => {
        const incoming = document.querySelector('.setup-background--incoming');
        const base = document.querySelector('.setup-background');
        if (!incoming || !base) return;
        const style = getComputedStyle(incoming);
        observer.disconnect();
        resolve({ animation: style.animationName, duration: parseFloat(style.animationDuration), baseOpacity: getComputedStyle(base).opacity, image: style.backgroundImage });
      });
      observer.observe(document.querySelector('.setup-screen')!, { childList: true, subtree: true });
    }));
    await choices.getByRole('button', { name: 'Sky Orbs · Light', exact: true }).click();
    const transition = await fade;
    expect(transition.animation).not.toBe('none');
    expect(transition.duration).toBeGreaterThanOrEqual(.35);
    expect(transition.baseOpacity).toBe('1');
    expect(transition.image).toContain('perfecthue-sky-orbs-light.png');
    // Choose again while the first fade is active, without a scrolling delay.
    await choices.getByRole('button', { name: 'Sky Orbs · Dark', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(backdrop).toHaveCSS('background-image', /perfecthue-sky-orbs-dark\.png/);
    await expect(page.locator('.setup-background')).toHaveCount(1);

    release();
    await page.evaluate(async () => {
      const image = new Image(); image.src = '/wallpapers/perfecthue-orange-wave-light.png'; await image.decode();
      await new Promise(requestAnimationFrame);
    });
    await expect(backdrop).toHaveCSS('background-image', /perfecthue-sky-orbs-dark\.png/);
    await expect(page.locator('.setup-background')).toHaveCount(1);

    await page.route('**/wallpapers/perfecthue-orange-wave-dark.png', route => route.abort());
    const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/wallpapers/perfecthue-orange-wave-dark.png'));
    await choices.getByRole('button', { name: 'Orange Wave · Dark', exact: true }).click();
    await failed;
    await expect(backdrop).toHaveCSS('background-image', /perfecthue-sky-orbs-dark\.png/);
    await expect(page.locator('.setup-background')).toHaveCount(1);
  } finally { release(); }
});

test('setup backdrop changes honor both system and app reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshSetup(page);
  await panel(page).getByRole('button', { name: 'Get started', exact: true }).click();
  const backdrop = page.locator('.setup-background').first();
  await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.setup-screen')!;
    screen.dataset.wallpaperTransitions = '0';
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && node.matches('.setup-background--incoming')) screen.dataset.wallpaperTransitions = String(Number(screen.dataset.wallpaperTransitions) + 1);
      }
    }).observe(screen, { childList: true });
  });
  await page.getByRole('button', { name: 'Orange Wave · Light', exact: true }).click();
  await expect(backdrop).toHaveCSS('background-image', /perfecthue-orange-wave-light\.png/);
  await expect(page.locator('.setup-screen')).toHaveAttribute('data-wallpaper-transitions', '0');

  await next(page); await next(page);
  await panel(page).getByRole('switch', { name: 'Reduce motion', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Sky Orbs · Dark', exact: true }).click();
  await expect(backdrop).toHaveCSS('background-image', /perfecthue-sky-orbs-dark\.png/);
  await page.getByRole('button', { name: 'Morning sky', exact: true }).click();
  await expect(backdrop).toHaveClass(/wallpaper--sky-morning/);
  await expect(page.locator('.setup-screen')).toHaveAttribute('data-wallpaper-transitions', '0');
});
