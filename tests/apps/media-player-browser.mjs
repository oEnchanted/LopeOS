/**
 * Media Player browser regression. Generates media the browser cannot play
 * (MPEG-4 Part 2 AVI, FLV1, WMA, H.264 + AC-3 MKV with two audio tracks and
 * subtitles) with ffmpeg.wasm, then plays each through the real app.
 * Needs the dev server (npm run dev:web) and Google Chrome; set NOMP4=1 to
 * hide H.264/AAC from MediaSource and exercise the WebM fallback.
 */
import { chromium, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installContractRuntime } from '../integration/contract-runtime-fixture.ts';

const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, channel: process.env.CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const media = mkdtempSync(join(tmpdir(), 'lope-media-'));
const checks = [], errors = [];
const step = (label, detail = '') => { checks.push(label); console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`); };

async function generate() {
  const page = await browser.newPage();
  await page.goto(origin + '/node_modules/@ffmpeg/core/package.json');
  const files = await page.evaluate(async () => {
    const { FFmpeg } = await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', wasmURL: '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm' });
    await ffmpeg.writeFile('subs.srt', '1\n00:00:01,000 --> 00:00:04,000\nEmbedded subtitle one\n\n2\n00:00:05,000 --> 00:00:09,000\nEmbedded subtitle two\n');
    const src = ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=20'];
    const jobs = {
      'mpeg4.avi': [...src, '-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'],
      'h264-ac3.mkv': [...src, '-i', 'subs.srt', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-c:a', 'ac3', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Low tone', '-metadata:s:a:1', 'language=fra', '-metadata:s:a:1', 'title=High tone', '-metadata:s:s:0', 'language=eng'],
      'long.avi': ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=120', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120', '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'libmp3lame'],
      'audio.wma': ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-c:a', 'wmav2', '-metadata', 'title=Test Tone', '-metadata', 'artist=Lope'],
      'flv1.flv': [...src, '-map', '0:v', '-map', '1:a', '-c:v', 'flv1', '-c:a', 'libmp3lame', '-ar', '44100'],
      'native.mp4': [...src, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'],
    };
    const result = {};
    for (const [name, args] of Object.entries(jobs)) {
      if (await ffmpeg.exec(['-y', ...args, name]) !== 0) throw new Error(`Could not generate ${name}`);
      result[name] = Array.from(await ffmpeg.readFile(name));
    }
    return result;
  });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(media, name), Buffer.from(data));
  writeFileSync(join(media, 'external.srt'), '1\n00:00:02,000 --> 00:00:06,000\nExternal <i>subtitle</i>\n');
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
const app = page.getByTestId('media-player');
const status = () => page.evaluate(() => {
  const v = document.querySelector('.mp-video');
  return v && { t: v.currentTime, d: v.duration, paused: v.paused, w: v.videoWidth, audio: v.webkitAudioDecodedByteCount, rate: v.playbackRate, error: document.querySelector('.mp-error')?.textContent };
});
const open = name => app.locator('input[type=file][multiple]:not([webkitdirectory])').setInputFiles(join(media, name));
async function playing(name, { video = true, duration, from = 2 } = {}) {
  const started = Date.now();
  let s;
  while (Date.now() - started < 45000) {
    s = await status();
    if (s?.error || s && s.t > from && (!video || s.w > 0)) break;
    await page.waitForTimeout(200);
  }
  if (!s || s.error || s.t <= from || video && !s.w) throw new Error(`${name} did not play: ${JSON.stringify(s)}`);
  if (duration && Math.abs(s.d - duration) > 0.5) throw new Error(`${name} reports ${s.d}s, expected ${duration}s`);
  return Date.now() - started;
}

try {
  await generate();
  await installContractRuntime(page);
  if (process.env.NOMP4) await page.addInitScript(() => { const original = MediaSource.isTypeSupported.bind(MediaSource); MediaSource.isTypeSupported = type => /avc1|mp4a|hvc1|hev1/.test(type) ? false : original(type); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.welcome-main h1')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Control+1');
  const spotlight = page.getByRole('dialog', { name: 'Find applications' });
  await spotlight.getByRole('textbox').fill('Media Player');
  await expect(spotlight.getByRole('option').first()).toContainText('Media Player');
  await page.keyboard.press('Enter');
  await expect(app).toBeVisible({ timeout: 20000 });

  for (const [name, video, duration] of [['native.mp4', true, 20], ['mpeg4.avi', true, 20], ['flv1.flv', true, 20], ['audio.wma', false, 8], ['h264-ac3.mkv', true, 20]]) {
    await open(name);
    step(`${name} plays`, `${await playing(name, { video, duration })} ms to 2 s`);
  }
  const before = (await status()).audio; await page.waitForTimeout(1200);
  if (!((await status()).audio > before)) throw new Error('AC-3 audio is not decoding');
  step('AC-3 audio decodes');

  await app.getByRole('button', { name: 'Tracks' }).click();
  const tracks = app.getByRole('dialog', { name: 'Tracks and picture' });
  await expect(tracks.getByRole('radiogroup', { name: 'Audio Track' }).getByRole('radio')).toHaveCount(2);
  await tracks.getByRole('radio', { name: /High tone/ }).click();
  await playing('second audio track', { from: (await status()).t + 1 });
  await tracks.getByRole('radio', { name: /English/ }).last().click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelector('.mp-video').currentTime = 6; });
  await expect(app.locator('.mp-subtitles')).toContainText('Embedded subtitle two', { timeout: 20000 });
  step('audio track switch and embedded subtitles');

  // Seek far ahead in transcoded media and measure how long until it plays again.
  await open('long.avi');
  await playing('long avi');
  for (const target of [90, 45, 100]) {
    const started = Date.now();
    await page.evaluate(time => { document.querySelector('.mp-video').currentTime = time; }, target);
    await page.waitForFunction(time => { const v = document.querySelector('.mp-video'); return v.currentTime > time + 0.3 && v.readyState >= 3; }, target, { timeout: 30000 });
    step(`cold seek to ${target}s in transcoded media`, `${Date.now() - started} ms`);
  }

  await app.focus();
  await page.keyboard.press(' ');
  await expect.poll(async () => (await status()).paused).toBe(true);
  await page.keyboard.press(' ');
  await page.keyboard.press(']');
  await expect.poll(async () => (await status()).rate).toBe(1.5);
  await page.keyboard.press('=');
  step('Space and speed hotkeys');

  await open('native.mp4');
  await playing('native again');
  await app.locator('input[type=file]:not([multiple])').setInputFiles(join(media, 'external.srt'));
  await page.evaluate(() => { document.querySelector('.mp-video').currentTime = 3; });
  await expect(app.locator('.mp-subtitles')).toContainText('External subtitle', { timeout: 10000 });
  step('external subtitle file');

  // Preferences: larger, yellow subtitles and a 200% volume ceiling.
  await app.focus();
  await page.keyboard.press('Control+p');
  const prefs = page.getByRole('dialog', { name: 'Simple Preferences' });
  await prefs.getByRole('tab', { name: 'Subtitles' }).click();
  await prefs.getByRole('combobox').selectOption('1.6');
  await prefs.getByLabel('Subtitle text color').fill('#ffff00');
  await prefs.getByRole('tab', { name: 'Audio' }).click();
  await prefs.getByRole('combobox').first().selectOption('2');
  await prefs.getByRole('button', { name: 'Save' }).click();
  await expect(app.locator('.mp-volume')).toHaveAttribute('max', '200');
  await page.evaluate(() => { document.querySelector('.mp-video').currentTime = 3; });
  await expect(app.locator('.mp-subtitles span').first()).toHaveCSS('color', 'rgb(255, 255, 0)');
  step('preferences change subtitles and volume ceiling');

  // Custom bookmarks appear on the seek bar and jump back.
  await app.focus();
  await page.keyboard.press('Control+b');
  const marks = page.getByRole('dialog', { name: 'Edit Bookmarks' });
  await marks.getByRole('button', { name: 'Create' }).click();
  await expect(marks.getByRole('option')).toHaveCount(1);
  const marked = await page.evaluate(() => document.querySelector('.mp-video').currentTime);
  await page.keyboard.press('Escape');
  await expect(app.locator('.mp-seek-bookmark')).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('.mp-video').currentTime = 15; });
  await app.focus(); await page.keyboard.press('Control+b');
  await marks.getByRole('option').first().click();
  await marks.getByRole('button', { name: 'Go' }).click();
  await expect.poll(async () => Math.abs((await status()).t - marked) < 1.5).toBe(true);
  await page.keyboard.press('Escape');
  step('custom bookmarks');

  // System media controls see the current title.
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('native');
  step('media session metadata');

  await open('audio.wma');
  await playing('wma', { video: false });
  await app.focus();
  await page.keyboard.press('Control+r');
  const convert = page.getByRole('dialog', { name: 'Convert' });
  await convert.getByRole('combobox').selectOption('mp3');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), convert.getByRole('button', { name: 'Download' }).click()]);
  const output = await download.path();
  if (readFileSync(output).subarray(0, 3).toString('latin1') !== 'ID3') throw new Error('Conversion did not produce MP3');
  step('Convert WMA to MP3', `${statSync(output).size} bytes`);

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log(`Media Player browser checks passed (${checks.length}).`);
} catch (error) {
  await page.screenshot({ path: join(media, 'failure.png') }).catch(() => {});
  console.error(`FAILED: ${error.message}\nScreenshot: ${join(media, 'failure.png')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
