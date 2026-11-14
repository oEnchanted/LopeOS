/** Window geometry regressions against an isolated, in-memory runtime fixture. */
import { chromium, expect } from '@playwright/test';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
const initialBounds = { x: 300, y: 140, width: 700, height: 500 };

async function desktop(preferences = {}, bounds = initialBounds) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await installContractRuntime(page);
  await page.addInitScript(({ preferences, bounds }) => {
    const key = 'lope.preferences.user.desktop-test-user.v2';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 2, preferences }));
    if (!localStorage.getItem('lope.session.layout.v1')) localStorage.setItem('lope.session.layout.v1', JSON.stringify([{
      id: 'window-management-test', appId: 'lope.welcome', title: 'Welcome', state: 'normal', focused: true, zIndex: 50000, bounds,
    }]));
  }, {
    preferences: { pinned: ['lope.welcome'], showRecentApps: false, reduceMotion: true, windowAnimation: 'none', statusItems: [], restoreLayout: true, ...preferences },
    bounds,
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible();
  return {
    page,
    win: page.locator('[data-window-id="window-management-test"]'),
    dock: page.getByRole('navigation', { name: 'Application Dock', exact: true }),
  };
}

async function rendered(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function expectBounds(actual, expected) {
  expect(actual).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height']) expect(actual[key], key).toBeCloseTo(expected[key], 0);
}

async function expectGeometry(win, expected) {
  await expect.poll(async () => {
    const actual = await win.boundingBox();
    return actual && Object.keys(expected).every(key => Math.abs(actual[key] - expected[key]) < 0.5);
  }).toBe(true);
}

async function gesture(page, win, dx, dy, edge = '') {
  const target = await win.locator(edge ? `.resize-${edge}` : '.window-titlebar').boundingBox();
  const x = target.x + target.width / 2, y = target.y + target.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await rendered(page);
  const preview = await win.boundingBox();
  await page.mouse.up();
  await rendered(page);
  expectBounds(await win.boundingBox(), preview);
  return preview;
}

async function changePreferences(page, values) {
  await page.evaluate(async values => {
    const { preferences } = await import('/packages/sdk/src/preferences.ts');
    preferences.apply(values);
  }, values);
  await rendered(page);
}

async function windowCommand(page, name) {
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function enterFullscreen(page, win) {
  await win.getByRole('button', { name: 'Enter full screen Welcome', exact: true }).click();
  await expect(win).toHaveClass(/is-fullscreen/);
  const viewport = await page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
  await expectGeometry(win, viewport);
  await expect(page.locator('.menubar')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Application Dock', exact: true })).toBeHidden();
}

async function browserFullscreen(page, enter) {
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width / 2, 1);
  await page.getByRole('button', { name: `${enter ? 'Enter' : 'Exit'} browser full screen`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(enter);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  if (await page.locator('.os-window.is-fullscreen').count()) await expect(page.locator('.menubar')).toBeHidden();
}

async function expectDockAboveWindow(page) {
  expect(await page.evaluate(() => {
    const dock = document.querySelector('.dock'), win = document.querySelector('.os-window');
    const d = dock.getBoundingClientRect(), w = win.getBoundingClientRect();
    const left = Math.max(d.left, w.left), right = Math.min(d.right, w.right);
    const top = Math.max(d.top, w.top), bottom = Math.min(d.bottom, w.bottom);
    return right > left && bottom > top && dock.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
  })).toBe(true);
}

try {
  {
    const { page, win, dock } = await desktop({ reduceMotion: false, windowAnimation: 'gentle' });
    const material = () => win.evaluate(el => {
      const style = getComputedStyle(el);
      return { background: style.background, filter: style.backdropFilter };
    });
    const before = await material();
    expect(before.filter).not.toBe('none');
    const titlebar = await win.locator('.window-titlebar').boundingBox();
    await page.mouse.move(titlebar.x + titlebar.width / 2, titlebar.y + titlebar.height / 2);
    await page.mouse.down();
    await page.mouse.move(titlebar.x + titlebar.width / 2 + 60, titlebar.y + titlebar.height / 2 + 60);
    await expect(win).toHaveClass(/is-moving/);
    expect(await material()).toEqual(before);
    await page.mouse.up();
    expect(await material()).toEqual(before);

    // Inspect the finish boundary itself: polling after hiding misses a one-frame flash.
    await win.evaluate(el => {
      const animate = el.animate.bind(el);
      el.animate = (...args) => {
        const animation = animate(...args);
        animation.addEventListener('finish', () => {
          window.minimizeFinishOpacity = getComputedStyle(el).opacity;
        });
        const cancel = animation.cancel.bind(animation);
        animation.cancel = () => {
          window.minimizeHiddenBeforeCancel = el.getClientRects().length === 0;
          cancel();
        };
        return animation;
      };
    });
    await win.getByRole('button', { name: 'Minimize Welcome', exact: true }).click();
    await expect(win).toBeHidden();
    expect(await page.evaluate(() => window.minimizeFinishOpacity)).toBe('0');
    expect(await page.evaluate(() => window.minimizeHiddenBeforeCancel)).toBe(true);
    await dock.getByRole('button', { name: 'Open Welcome', exact: true }).click();
    await expect(win).toBeVisible();
    await expect(win).toHaveCSS('opacity', '1');
    expect(await material()).toEqual(before);
    checks.push('Dragging preserves glass; minimize holds its transparent frame until hidden and restores at full opacity');
    await page.close();
  }

  {
    const { page, win, dock } = await desktop();
    const behindDock = await gesture(page, win, 0, 220);
    expectBounds(behindDock, { ...initialBounds, y: 360 });
    await expectDockAboveWindow(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lope.session.layout.v1'))[0].bounds)).toEqual(behindDock);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(win).toBeVisible();
    await expectGeometry(win, behindDock);
    await win.getByRole('button', { name: 'Minimize Welcome', exact: true }).click();
    await expect(win).toBeHidden();
    await dock.getByRole('button', { name: 'Open Welcome', exact: true }).click();
    await expectGeometry(win, behindDock);
    await windowCommand(page, 'Maximize');
    await expect(win).toHaveClass(/is-maximized/);
    const maximized = await win.boundingBox(), dockBounds = await dock.boundingBox();
    expect(maximized.y + maximized.height).toBeLessThanOrEqual(dockBounds.y);
    expect(maximized.width).toBeGreaterThan(1400);
    await windowCommand(page, 'Restore window');
    await expectGeometry(win, behindDock);
    checks.push('Drag release, persistence, reload, minimize and maximize restore retain floating bounds behind the bottom Dock; Dock remains on top');

    for (const values of [{ dockSize: 68 }, { dockAutoHide: true }, { dockPosition: 'right', dockAutoHide: false }, { dockPosition: 'bottom', dockSize: 52 }]) {
      await changePreferences(page, values);
      await expectGeometry(win, behindDock);
    }
    await page.keyboard.press('Alt+ArrowDown');
    const moved = await win.boundingBox();
    expect(moved.y).toBeGreaterThan(behindDock.y);
    expect(moved.y + moved.height).toBeGreaterThan((await dock.boundingBox()).y);
    await page.keyboard.press('Alt+ArrowUp');
    await expectGeometry(win, behindDock);
    checks.push('Dock size, visibility and position changes preserve floating bounds; keyboard movement also permits Dock overlap');
    await page.close();
  }

  {
    const { page, win, dock } = await desktop();
    await enterFullscreen(page, win);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(win.locator('.resize-handle').first()).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lope.session.layout.v1'))[0])).toMatchObject({ state: 'normal', bounds: initialBounds });
    await win.getByRole('button', { name: 'Exit full screen Welcome', exact: true }).click();
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expectGeometry(win, initialBounds);
    await expect(dock).toBeVisible();
    await expect(page.locator('.menubar')).toBeVisible();

    await enterFullscreen(page, win);
    await page.keyboard.press('Escape');
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, initialBounds);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();

    checks.push('Green control fills only the LopeOS desktop; green and Escape restore original bounds and shell chrome without browser fullscreen');

    await windowCommand(page, 'Maximize');
    const maximized = await win.boundingBox();
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Exit full screen Welcome', exact: true }).click();
    await expect(win).toHaveClass(/is-maximized/);
    await expectGeometry(win, maximized);
    await windowCommand(page, 'Restore window');
    await expectGeometry(win, initialBounds);
    checks.push('Leaving fullscreen preserves a previously maximized window and its original floating restore bounds');

    await browserFullscreen(page, true);
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Exit full screen Welcome', exact: true }).click();
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, initialBounds);
    await expect(dock).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await browserFullscreen(page, false);
    checks.push('The separate menu-bar button toggles browser fullscreen; green window controls leave an existing browser fullscreen session unchanged');

    await enterFullscreen(page, win);
    await browserFullscreen(page, true);
    await expect(win).toHaveClass(/is-fullscreen/);
    await browserFullscreen(page, false);
    await expect(win).toHaveClass(/is-fullscreen/);
    await browserFullscreen(page, true);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(win).toHaveClass(/is-fullscreen/);
    await expectGeometry(win, { x: 0, y: 0, width: 1440, height: 900 });
    await win.getByRole('button', { name: 'Exit full screen Welcome', exact: true }).click();
    await expectGeometry(win, initialBounds);
    checks.push('The menu-bar browser fullscreen control stays reachable in window fullscreen; button and native browser exit preserve window fullscreen');
    await page.close();
  }

  {
    const { page, win, dock } = await desktop();
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await expect(page.locator('.os-window[data-app-id="lope.files"]')).toHaveClass(/is-focused/);
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, initialBounds);
    await expect(dock).toBeVisible();
    await expect(page.locator('.menubar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    checks.push('Opening another application from a fullscreen window restores the desktop and focuses the new application');
    await page.close();
  }

  {
    const { page, win, dock } = await desktop();
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Minimize Welcome', exact: true }).click();
    await expect(win).toBeHidden();
    await expect(dock).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await dock.getByRole('button', { name: 'Open Welcome', exact: true }).click();
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, initialBounds);
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Close Welcome', exact: true }).click();
    await expect(win).toHaveCount(0);
    await expect(dock).toBeVisible();
    await expect(page.locator('.menubar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    checks.push('Minimizing or closing a fullscreen window restores access to the desktop');
    await page.close();
  }

  for (const { scale, dockPosition } of [
    { scale: 100, dockPosition: 'bottom' },
    { scale: 100, dockPosition: 'left' },
    { scale: 100, dockPosition: 'right' },
    { scale: 125, dockPosition: 'bottom' },
  ]) {
    const { page, win } = await desktop({ interfaceScale: scale, dockPosition });
    if (scale === 100) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.desktop')).toHaveAttribute('data-compact', 'true');
      await rendered(page);
    }
    const before = await win.boundingBox();
    await enterFullscreen(page, win);
    await win.getByRole('button', { name: 'Exit full screen Welcome', exact: true }).click();
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, before);
    checks.push(`${scale === 100 ? 'Compact viewport' : '125% interface scaling'} with ${dockPosition} Dock fills the viewport in fullscreen and restores prior geometry`);
    await page.close();
  }

  {
    const { page, win } = await desktop();
    await enterFullscreen(page, win);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await page.keyboard.press('Control+k');
    const search = page.getByRole('textbox', { name: 'Search LopeOS', exact: true });
    await expect(search).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();
    await expect(win).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(win).not.toHaveClass(/is-fullscreen/);
    await expectGeometry(win, initialBounds);
    checks.push('Escape dismisses Search before leaving window fullscreen');
    await page.close();
  }

  {
    const { page, win } = await desktop();
    const titlebar = await win.locator('.window-titlebar').boundingBox();
    const start = { x: titlebar.x + titlebar.width / 2, y: titlebar.y + titlebar.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 180, { steps: 5 });
    await rendered(page);
    expect((await win.boundingBox()).y).toBeGreaterThan(initialBounds.y);
    await win.locator('.window-titlebar').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
    await page.mouse.up();
    await expectGeometry(win, initialBounds);
    await expect(win).not.toHaveClass(/is-moving/);
    checks.push('Interrupted pointer gestures return to their original geometry and release moving state');
    const taller = await gesture(page, win, 0, 240, 's');
    expectBounds(taller, { ...initialBounds, height: 740 });
    await expectDockAboveWindow(page);
    const north = await gesture(page, win, 0, -80, 'n');
    expectBounds(north, { ...taller, y: 60, height: 820 });
    const west = await gesture(page, win, -180, 0, 'w');
    expectBounds(west, { ...north, x: 120, width: 880 });
    const narrow = await gesture(page, win, 1000, 0, 'w');
    expect(narrow.width).toBe(360);
    expect(narrow.x + narrow.width).toBe(west.x + west.width);
    const short = await gesture(page, win, 0, 650, 'n');
    expect(short.height).toBe(300);
    expect(short.y + short.height).toBe(narrow.y + narrow.height);
    checks.push('Bottom resize extends beneath the Dock; north and west resizing preserve opposite edges and application minimum sizes');
    await page.close();
  }

  for (const position of ['left', 'right']) {
    const { page, win, dock } = await desktop({ dockPosition: position });
    const x = position === 'left' ? 8 : 732;
    const overlap = await gesture(page, win, x - initialBounds.x, 0);
    expectBounds(overlap, { ...initialBounds, x });
    await expectDockAboveWindow(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectGeometry(win, overlap);
    await windowCommand(page, 'Maximize');
    const maximized = await win.boundingBox(), dockBounds = await dock.boundingBox();
    if (position === 'left') expect(maximized.x).toBeGreaterThanOrEqual(dockBounds.x + dockBounds.width);
    else expect(maximized.x + maximized.width).toBeLessThanOrEqual(dockBounds.x);
    await windowCommand(page, 'Restore window');
    await expectGeometry(win, overlap);
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    await page.getByRole('menuitem', { name: `Tile window to ${position}`, exact: true }).click();
    const tiled = await win.boundingBox();
    if (position === 'left') expect(tiled.x).toBeGreaterThanOrEqual(dockBounds.x + dockBounds.width);
    else expect(tiled.x + tiled.width).toBeLessThanOrEqual(dockBounds.x);
    expect(tiled.width).toBeLessThan(720);
    checks.push(`Floating windows overlap the ${position} Dock and survive reload; maximized and tiled windows reserve Dock space`);
    await page.close();
  }

  for (const scenario of [
    { bounds: { x: -500, y: 100, width: 700, height: 500 }, edge: 'e', dx: -300, dy: 0 },
    { bounds: { x: 1200, y: 100, width: 700, height: 500 }, edge: 'w', dx: 300, dy: 0 },
    { bounds: { x: 300, y: 700, width: 700, height: 500 }, edge: 'n', dx: 0, dy: 300 },
  ]) {
    const { page, win } = await desktop({}, scenario.bounds);
    const resized = await gesture(page, win, scenario.dx, scenario.dy, scenario.edge);
    if (scenario.edge === 'e') {
      expect(resized.x).toBe(scenario.bounds.x);
      expect(resized.x + resized.width).toBeGreaterThanOrEqual(128);
      expect(resized.width).toBeLessThan(scenario.bounds.width);
    } else if (scenario.edge === 'w') {
      expect(resized.x + resized.width).toBe(scenario.bounds.x + scenario.bounds.width);
      expect(resized.x).toBeLessThanOrEqual(1312);
      expect(resized.width).toBeLessThan(scenario.bounds.width);
    } else {
      expect(resized.y + resized.height).toBe(scenario.bounds.y + scenario.bounds.height);
      expect(resized.y).toBeLessThanOrEqual(760);
      expect(resized.height).toBeLessThan(scenario.bounds.height);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectGeometry(win, resized);
    await page.close();
  }
  checks.push('Shrinking partially offscreen windows keeps the title bar reachable without moving the opposite edge, including after reload');

  {
    const bounds = { x: 8, y: 100, width: 700, height: 500 };
    const { page, win, dock } = await desktop({}, bounds);
    await page.mouse.click(20, 120);
    await rendered(page);
    await expectGeometry(win, bounds);
    await expect(win).not.toHaveClass(/is-maximized/);
    const titlebar = await win.locator('.window-titlebar').boundingBox();
    await page.mouse.move(titlebar.x + titlebar.width / 2, titlebar.y + titlebar.height / 2);
    await page.mouse.down();
    await page.mouse.move(12, 200, { steps: 8 });
    await page.mouse.up();
    await rendered(page);
    const tiled = await win.boundingBox();
    expect(tiled.x).toBeGreaterThanOrEqual(0);
    expect(tiled.y).toBeGreaterThanOrEqual(40);
    expect(tiled.width).toBeLessThan(720);
    expect(tiled.height).toBeGreaterThan(700);
    expect(tiled.y + tiled.height).toBeLessThanOrEqual((await dock.boundingBox()).y);
    checks.push('Clicking a title bar near an edge preserves placement; deliberately dragging to that edge still tiles above the Dock');
    await page.close();
  }

  {
    const { page, win } = await desktop({ interfaceScale: 125 }, { x: 200, y: 100, width: 600, height: 400 });
    const moved = await gesture(page, win, 50, 250);
    expectBounds(moved, { x: 300, y: 375, width: 750, height: 500 });
    await expectDockAboveWindow(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectGeometry(win, moved);
    await gesture(page, win, -550, 0);
    await page.setViewportSize({ width: 1000, height: 700 });
    await rendered(page);
    const titlebar = await win.locator('.window-titlebar').boundingBox();
    expect(titlebar.x + titlebar.width).toBeGreaterThanOrEqual(120);
    expect(titlebar.y).toBeGreaterThanOrEqual(30);
    expect(titlebar.y + titlebar.height).toBeLessThanOrEqual(700);
    checks.push('Scaled pointer coordinates retain Dock overlap and saved placement; viewport changes leave the title bar reachable');
    await page.close();
  }

  expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
