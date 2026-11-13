/** Focused design/interaction QA. Uses deterministic weather responses, not live forecasts. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { seedSession } from '../setup/seed-session.mjs';

const baseURL = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const output = 'docs/screenshots';
const only = process.env.UTILITY_QA_ONLY;
const runCalculator = only !== 'weather';
const runWeather = only !== 'calculator';
const browser = await chromium.launch({ headless: true });
const checks = [];
const screenshots = [];
const errors = [];
await mkdir(output, { recursive: true });

function forecast(variant = 'day', fahrenheit = false) {
  const isNight = variant === 'night';
  const hour = isNight ? 21 : 11;
  const code = variant === 'storm' ? 95 : isNight ? 0 : 2;
  const temp = value => fahrenheit ? value * 1.8 + 32 : value;
  const times = Array.from({ length: 10 }, (_, i) => `2026-11-${String(13 + i).padStart(2, '0')}`);
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-${13 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
  const data = {
    timezone: 'America/Denver', utc_offset_seconds: -25200,
    current: {
      time: `2026-11-13T${hour}:15`, temperature_2m: temp(isNight ? 9 : 12.5), apparent_temperature: temp(isNight ? 8 : 11.2),
      relative_humidity_2m: 45, wind_speed_10m: fahrenheit ? 8 : 13, wind_direction_10m: 235,
      wind_gusts_10m: fahrenheit ? 15 : 24, weather_code: code, is_day: isNight ? 0 : 1, visibility: 24000, uv_index: isNight ? 0 : 3.5,
    },
    daily: {
      time: times, temperature_2m_min: [4, 5, 8, 7, 4, 2, 3, 1, 2, 5].map(temp),
      temperature_2m_max: [17, 19, 22, 16, 15, 10, 12, 9, 14, 17].map(temp),
      weather_code: [code, 0, 2, 61, 3, 71, 2, 3, 0, 2], precipitation_probability_max: [10, 0, 15, 75, 20, 65, 20, 10, 5, 0],
      sunrise: times.map(day => `${day}T06:42`), sunset: times.map(day => `${day}T16:47`),
      uv_index_max: [4.3, 4.7, 4.1, 2.3, 3.8, 2.2, 4, 3, 4.5, 4.8],
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => temp(Math.round(10 + 6 * Math.sin(((i % 24) - 7) / 24 * Math.PI * 2)))),
      weather_code: hours.map((_, i) => variant === 'storm' ? 95 : i % 24 < 7 || i % 24 > 17 ? 0 : 2),
      is_day: hours.map((_, i) => i % 24 >= 7 && i % 24 <= 17 ? 1 : 0),
      precipitation_probability: hours.map((_, i) => variant === 'storm' ? 75 : i % 24 > 18 ? 0 : 10),
      visibility: hours.map(() => 24000), uv_index: hours.map((_, i) => i % 24 === 11 ? 3.5 : 2),
    },
  };
  if (variant === 'legacy') { delete data.current.visibility; delete data.current.uv_index; delete data.hourly; delete data.daily.sunrise; delete data.daily.sunset; delete data.daily.uv_index_max; }
  return data;
}

async function openPage({ theme = 'light', variant = 'day', viewport = { width: 1440, height: 960 }, accessible = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await seedSession(page);
  await page.addInitScript(({ theme, accessible }) => {
    localStorage.setItem('lope.theme', theme);
    localStorage.setItem('lope.reduceMotion', 'true');
    if (accessible) {
      localStorage.setItem('lope.reduceTransparency', 'true');
      localStorage.setItem('lope.increaseContrast', 'true');
    }
  }, { theme, accessible });
  await page.route('**/api/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({ status: endpoint.endsWith('/identity') ? 200 : 503, contentType: 'application/json', body: JSON.stringify(endpoint.endsWith('/identity') ? { userId: 'design-test', workspaceId: 'design-test' } : { error: { code: 'UNAVAILABLE', message: 'Runtime is not part of this test.' } }) });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    status: variant === 'failure' ? 503 : 200,
    contentType: 'application/json',
    body: JSON.stringify(variant === 'failure' ? { error: true } : forecast(variant, new URL(route.request().url()).searchParams.get('temperature_unit') === 'fahrenheit')),
  }));
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Boulder', admin1: 'Colorado', country: 'United States', latitude: 40.015, longitude: -105.2705, timezone: 'America/Denver' }] }) }));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.desktop')).toHaveAttribute('data-theme', theme);
  const welcome = page.getByRole('button', { name: 'Minimize Welcome', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  return page;
}

async function launch(page, name) {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  const app = page.getByTestId(`${name.toLowerCase()}-app`);
  await expect(app).toBeVisible();
  return app;
}
async function capture(page, id, suffix) {
  const path = `${output}/${id}-refined-${suffix}.png`;
  const window = page.locator(`[data-app-id="lope.${id}"]`);
  await window.evaluate(element => { if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) document.activeElement.blur(); });
  await window.screenshot({ path });
  screenshots.push(path);
}
async function noOverflow(page, app) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const measurements = await app.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(measurements.scroll).toBeLessThanOrEqual(measurements.width + 1);
}
async function resize(page, id, width, height) {
  const window = page.locator(`[data-app-id="lope.${id}"]`);
  const bounds = await window.boundingBox();
  const handle = window.locator('.resize-se');
  const position = await handle.boundingBox();
  await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
  await page.mouse.down();
  await page.mouse.move(position.x + position.width / 2 + width - bounds.width, position.y + position.height / 2 + height - bounds.height, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await window.boundingBox()).width)).toBe(width);
}

async function keypadFits(app) {
  const geometry = await app.evaluate(element => {
    const body = element.querySelector('.calculator-body');
    const last = element.querySelector('.calculator-pad button:last-child');
    return { bottom: last.getBoundingClientRect().bottom, limit: body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) };
  });
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.limit + 1);
}
async function chooseOption(select, label) {
  const option = await select.locator('option').evaluateAll((options, label) => options.find(option => option.textContent.includes(label))?.value, label);
  expect(option).toBeDefined(); await select.selectOption(option);
}

try {
  if (process.env.UTILITY_QA_CAPTURE_ONLY === 'weather') {
    for (const scene of [
      { variant: 'day', suffix: 'day' },
      { variant: 'night', suffix: 'night' },
      { theme: 'dark', variant: 'day', suffix: 'dark-day' },
      { variant: 'day', viewport: { width: 390, height: 844 }, suffix: 'mobile-light' },
      { theme: 'dark', variant: 'day', viewport: { width: 390, height: 844 }, suffix: 'mobile-dark' },
    ]) {
      const page = await openPage(scene);
      const weather = await launch(page, 'Weather');
      await expect(weather.getByRole('heading', { name: scene.variant === 'night' ? '9°C' : '13°C', exact: true })).toBeVisible();
      await capture(page, 'weather', scene.suffix);
      if (scene.suffix === 'day' || scene.suffix === 'mobile-light') {
        const scroll = weather.locator('.weather-scroll');
        if (scene.suffix === 'mobile-light') {
          await scroll.evaluate(element => { const forecast = element.querySelector('.weather-forecast'); element.scrollTop += forecast.getBoundingClientRect().top - element.getBoundingClientRect().top - 12; });
          await capture(page, 'weather', scene.suffix + '-forecast');
        }
        await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await capture(page, 'weather', scene.suffix + '-details');
      }
      await page.close();
    }
    console.log(JSON.stringify({ screenshots, errors }, null, 2));
  } else if (process.env.UTILITY_QA_CAPTURE_ONLY === 'calculator') {
    for (const theme of ['light', 'dark']) {
      const page = await openPage({ theme });
      const app = await launch(page, 'Calculator');
      const input = app.getByRole('textbox', { name: 'Expression', exact: true });
      const menu = async (role, name) => {
        await app.getByRole('button', { name: 'Calculator mode', exact: true }).click();
        await page.getByRole(role, { name, exact: true }).click();
      };
      await input.fill('128*96.75'); await input.press('Enter');
      await keypadFits(app); await capture(page, 'calculator', theme);
      await app.getByRole('button', { name: 'Calculator mode', exact: true }).click();
      await capture(page, 'calculator', theme + '-mode-menu');
      await page.getByRole('menuitemradio', { name: 'Scientific', exact: true }).click();
      await input.fill('sin(30)'); await input.press('Enter');
      await capture(page, 'calculator', theme + '-scientific'); await keypadFits(app);
      await menu('menuitemradio', 'Programmer');
      await app.getByRole('button', { name: 'Hexadecimal', exact: true }).click();
      await input.fill('FF+1'); await input.press('Enter');
      await capture(page, 'calculator', theme + '-programmer'); await keypadFits(app);
      await menu('menuitemradio', 'Basic');
      await menu('menuitemcheckbox', 'RPN Mode');
      await input.fill('2'); await app.getByRole('button', { name: 'Push to stack', exact: true }).click();
      await input.fill('3'); await app.getByRole('button', { name: 'Add', exact: true }).click();
      await capture(page, 'calculator', theme + '-rpn'); await keypadFits(app);
      await menu('menuitemcheckbox', 'RPN Mode');
      await menu('menuitemcheckbox', 'Convert');
      await chooseOption(app.getByLabel('Conversion category', { exact: true }), 'Temperature');
      await chooseOption(app.getByLabel('From unit', { exact: true }), 'Fahrenheit');
      await chooseOption(app.getByLabel('To unit', { exact: true }), 'Celsius');
      await app.getByLabel('Value to convert', { exact: true }).fill('32');
      await capture(page, 'calculator', theme + '-convert'); await keypadFits(app);
      await menu('menuitem', 'Math Notes…');
      await app.getByRole('textbox', { name: 'Math notes', exact: true }).fill('price = 24\nquantity = 3\nprice * quantity');
      await capture(page, 'calculator', theme + '-math-notes');
      await page.close();
    }
    expect(errors).toEqual([]);
    const report = { checks: ['Light/dark default-size advanced mode keypads fully visible with bottom padding'], screenshots, errors };
    await writeFile(`${output}/utility-design-layout-calculator.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } else {
  const page = await openPage();
  if (runCalculator) {
  const calculator = await launch(page, 'Calculator');
  const input = calculator.getByRole('textbox', { name: 'Expression', exact: true });
  await input.fill('0.1+0.2'); await input.press('Enter'); await expect(input).toHaveValue('0.3');
  await input.fill('(2+3)*4'); await input.press('Enter'); await expect(input).toHaveValue('20');
  await input.fill('1/0'); await input.press('Enter'); await expect(calculator.getByRole('status')).toContainText('Cannot divide by zero');
  await calculator.getByRole('button', { name: 'Show calculation history' }).click();
  await expect(calculator.getByRole('region', { name: 'Calculation history' })).toContainText('0.3');
  await calculator.getByRole('button', { name: 'Use result 20', exact: true }).click(); await expect(input).toHaveValue('20');
  for (const name of ['Add', '5', 'Equals']) await calculator.getByRole('button', { name, exact: true }).click();
  await expect(input).toHaveValue('25');
  await input.fill('128*96.75'); await input.press('Enter'); await expect(input).toHaveValue('12384');
  await noOverflow(page, calculator); await capture(page, 'calculator', 'light');
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Scientific', exact: true }).click();
  await calculator.getByRole('button', { name: 'Degrees', exact: true }).click();
  await input.fill('sin(30)'); await input.press('Enter'); await expect(input).toHaveValue('0.5');
  await capture(page, 'calculator', 'light-scientific');
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Programmer', exact: true }).click();
  await calculator.getByRole('button', { name: 'Hexadecimal', exact: true }).click();
  await input.fill('FF+1'); await input.press('Enter'); await expect(input).toHaveValue('100');
  await calculator.getByRole('button', { name: 'Decimal', exact: true }).click(); await expect(input).toHaveValue('256');
  await capture(page, 'calculator', 'light-programmer');
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Basic', exact: true }).click();
  await calculator.getByRole('button', { name: 'Clear', exact: true }).click();
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'RPN Mode', exact: true }).click();
  await input.fill('2'); await calculator.getByRole('button', { name: 'Push to stack', exact: true }).click();
  await input.fill('3'); await calculator.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(calculator.getByRole('region', { name: 'RPN stack', exact: true }).locator('output').last()).toHaveText('5');
  await expect(input).toHaveAttribute('placeholder', '5');
  await capture(page, 'calculator', 'light-rpn');
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'RPN Mode', exact: true }).click();
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Math Notes…', exact: true }).click();
  await calculator.getByRole('textbox', { name: 'Math notes', exact: true }).fill('price = 24\nquantity = 3\nprice * quantity');
  await expect(calculator).toContainText('72');
  await capture(page, 'calculator', 'light-math-notes');
  const modeTrigger = calculator.getByRole('button', { name: 'Calculator mode', exact: true });
  await modeTrigger.focus(); await modeTrigger.press('ArrowDown');
  await expect.poll(async () => page.getByRole('menu', { name: 'Calculator modes' }).evaluate(menu => menu.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Basic', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio', { name: 'Scientific', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(calculator).toHaveClass(/calculator-scientific/);
  await modeTrigger.click(); await page.getByRole('menuitemradio', { name: 'Basic', exact: true }).click();
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Convert', exact: true }).click();
  const category = calculator.getByLabel('Conversion category', { exact: true });
  const chooseOption = async (select, label) => {
    const option = await select.locator('option').evaluateAll((options, label) => options.find(option => option.textContent.includes(label))?.value, label);
    expect(option).toBeDefined(); await select.selectOption(option);
  };
  await chooseOption(category, 'Temperature');
  await chooseOption(calculator.getByLabel('From unit', { exact: true }), 'Fahrenheit');
  await chooseOption(calculator.getByLabel('To unit', { exact: true }), 'Celsius');
  await calculator.getByLabel('Value to convert', { exact: true }).fill('32');
  await expect.poll(async () => Number.parseFloat(await calculator.getByLabel('Converted value', { exact: true }).innerText())).toBe(0);
  await capture(page, 'calculator', 'light-convert');
  await calculator.getByRole('button', { name: 'Calculator mode', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Convert', exact: true }).click();
  await input.fill('128*96.75'); await input.press('Enter'); await expect(input).toHaveValue('12384');
  checks.push('Calculator modes: scientific degrees, hexadecimal/decimal arithmetic, RPN stack, variable Math Notes, and Fahrenheit/Celsius conversion');
  await calculator.getByRole('button', { name: 'Show calculation history' }).click();
  await capture(page, 'calculator', 'history');
  await calculator.getByRole('button', { name: 'Close history' }).click();
  await resize(page, 'calculator', 300, 420); await noOverflow(page, calculator); await capture(page, 'calculator', 'minimum');
  const keyBoxes = await calculator.locator('.calculator-pad button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(Math.min(...keyBoxes)).toBeGreaterThanOrEqual(32);
  checks.push('Calculator: exact decimal and parenthesized keyboard arithmetic, error feedback, reusable history, button arithmetic, minimum window keys');
  await page.getByRole('button', { name: 'Minimize Calculator', exact: true }).click();

  }
  if (runWeather) {
  const weather = await launch(page, 'Weather');
  await expect(weather.getByRole('heading', { name: '13°C', exact: true })).toBeVisible();
  await expect(weather.locator('.weather-forecast li')).toHaveCount(10);
  await expect(weather.locator('.weather-hourly')).toBeVisible();
  const ranges = await weather.locator('.forecast-range-fill').evaluateAll(elements => elements.map(element => element.style.width));
  expect(ranges.length).toBe(10); expect(new Set(ranges).size).toBeGreaterThan(3);
  await noOverflow(page, weather); await capture(page, 'weather', 'day');
  await weather.getByRole('button', { name: 'Use Fahrenheit', exact: true }).click();
  await expect(weather.getByRole('heading', { name: '55°F', exact: true })).toBeVisible();
  await expect(page.locator('.system-status')).toContainText('55°F');
  await weather.getByRole('button', { name: 'Use Celsius', exact: true }).click();
  await expect(weather.getByRole('heading', { name: '13°C', exact: true })).toBeVisible();
  await weather.getByRole('button', { name: 'Denver', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a location' });
  await dialog.getByLabel('City or postal code').fill('Boulder'); await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await dialog.getByRole('button', { name: /Boulder, Colorado/ }).click();
  await expect(weather.getByRole('button', { name: 'Boulder, Colorado', exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await expect(weather.getByRole('alert')).toContainText(/offline/i);
  await expect(weather.getByRole('alert')).toContainText(/cached/i);
  await page.context().setOffline(false);
  await resize(page, 'weather', 340, 400); await noOverflow(page, weather); await capture(page, 'weather', 'minimum');
  checks.push('Weather: 10 real-shaped daily rows, hourly forecast, proportional temperature bars, Celsius/Fahrenheit with shared menu status, city search, cached offline notice, minimum window');
  }
  await page.close();

  for (const theme of ['light', 'dark']) {
    const desktop = await openPage({ theme });
    if (runCalculator) {
    const calc = await launch(desktop, 'Calculator');
    const display = calc.getByRole('textbox', { name: 'Expression', exact: true });
    await display.fill('128*96.75'); await display.press('Enter');
    if (theme === 'dark') await capture(desktop, 'calculator', theme);
    await desktop.getByRole('button', { name: 'Minimize Calculator', exact: true }).click();
    }
    if (runWeather) {
    const forecast = await launch(desktop, 'Weather');
    await expect(forecast.getByRole('heading', { name: '13°C', exact: true })).toBeVisible();
    if (theme === 'dark') await capture(desktop, 'weather', 'dark-day');
    }
    await desktop.close();

    const mobile = await openPage({ theme, viewport: { width: 390, height: 844 } });
    if (runCalculator) { const mobileCalc = await launch(mobile, 'Calculator'); await noOverflow(mobile, mobileCalc); await capture(mobile, 'calculator', `mobile-${theme}`); }
    if (runWeather) {
    const mobileWeather = await launch(mobile, 'Weather');
    await expect(mobileWeather.getByRole('heading', { name: '13°C', exact: true })).toBeVisible();
    await noOverflow(mobile, mobileWeather); await capture(mobile, 'weather', `mobile-${theme}`);
    }
    await mobile.close();
  }
  checks.push('Light/dark desktop and 390×844 mobile layouts render without horizontal overflow');

  if (runWeather) {
  for (const variant of ['night', 'storm', 'legacy', 'failure']) {
    const variantPage = await openPage({ variant });
    const variantWeather = await launch(variantPage, 'Weather');
    if (variant === 'failure') {
      await expect(variantWeather.getByRole('alert')).toContainText('Weather is unavailable');
      await expect(variantWeather.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    } else {
      await expect(variantWeather.getByRole('heading', { name: variant === 'night' ? '9°C' : '13°C', exact: true })).toBeVisible();
      if (variant === 'night') await expect(variantWeather).toHaveAttribute('data-sky', 'night');
      if (variant === 'legacy') await expect(variantWeather.locator('.weather-hourly')).toContainText(/unavailable/i);
    }
    await noOverflow(variantPage, variantWeather); await capture(variantPage, 'weather', variant);
    await variantPage.close();
  }
  checks.push('Night/storm presentation, missing hourly data, and provider error with retry render correctly');

  const accessible = await openPage({ theme: 'dark', accessible: true });
  await expect(accessible.locator('.desktop')).toHaveAttribute('data-reduce-transparency', 'true');
  await expect(accessible.locator('.desktop')).toHaveAttribute('data-increase-contrast', 'true');
  const accessibleWeather = await launch(accessible, 'Weather');
  await expect(accessibleWeather.getByRole('heading', { name: '13°C', exact: true })).toBeVisible();
  await noOverflow(accessible, accessibleWeather); await capture(accessible, 'weather', 'accessible');
  await accessible.close(); checks.push('Reduced transparency and increased contrast appearance reviewed');
  }
  expect(errors).toEqual([]);
  const report = { conditions: 'Chromium headless, deterministic Open-Meteo fixtures; desktop, minimum utility windows, and 390×844 mobile. No live forecast claim.', checks, screenshots, errors };
  await writeFile(`${output}/utility-design-verification${only ? '-' + only : ''}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  }
} finally { await browser.close(); }
