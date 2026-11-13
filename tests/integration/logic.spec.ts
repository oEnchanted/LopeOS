import { expect, test } from '@playwright/test';
import { calculate, appendCalculatorInput } from '../../apps/web/src/apps/calculator/engine';
import { acknowledgeSave, applyExternalChange, editDocument, findNext, isDirty, newDocument, replaceAllText, stepHistory } from '../../apps/web/src/apps/text-editor/document';
import { DEFAULT_LOCATION, parseForecast } from '../../apps/web/src/apps/weather/provider';
import { WeatherStore } from '../../apps/web/src/apps/weather/store';
import { isWallpaperAvailable } from '../../apps/web/src/apps/settings/wallpaper-policy';
import { forecastFixture } from './contract-runtime-fixture';

test('arithmetic is exact for decimal input, respects precedence, and rejects executable or excessive input', () => {
  const cases = [ ['0.1+0.2', '0.3'], ['1.01-0.99', '0.02'], ['(7-3)*2', '8'], ['-2*-3', '6'], ['10/-4', '-2.5'], ['50%*200', '100'], ['1/3', '0.333333333333333'], ['1e-20', '1e-20'], ['9999999999999999', '1e+16'], ['0.00000001+0.00000002', '0.00000003'], ['-0', '0'] ];
  for (const [input, output] of cases) expect(calculate(input)).toBe(output);
  for (const input of ['1/0', 'fetch("/")', '2**4', '1;alert(1)', '9'.repeat(513), '('.repeat(33) + '1' + ')'.repeat(33)]) expect(() => calculate(input)).toThrow();
  expect(appendCalculatorInput('1.2', '.')).toBe('1.2'); expect(appendCalculatorInput('1+', '.')).toBe('1+0.'); expect(appendCalculatorInput('0', '7')).toBe('7');
});

test('editor undo/redo, literal replacement, external reload, and in-flight save acknowledgment preserve text', () => {
  let doc = newDocument('before', '/note.txt', 'v1'); doc = editDocument(doc, 'after', 6, 6);
  const undone = stepHistory(doc, 'undo', 5, 5); expect(undone.doc.text).toBe('before'); expect(isDirty(undone.doc)).toBe(false);
  expect(stepHistory(undone.doc, 'redo').doc.text).toBe('after');
  expect(replaceAllText('a.b A.B a?b', 'a.b', '$&')).toEqual({ text: '$& $& a?b', count: 2 });
  expect(findNext('One two one', 'ONE', 4)).toEqual([8, 11]); expect(findNext('hello', '', 0)).toBe(null);
  const conflicted = applyExternalChange(doc, 'external', 'v2'); expect(conflicted.text).toBe('after'); expect(conflicted.externalChange).toBe(true);
  const clean = applyExternalChange(newDocument('before', '/note.txt', 'v1'), 'external', 'v2'); expect(clean.text).toBe('external'); expect(isDirty(clean)).toBe(false);
  const result = acknowledgeSave(editDocument(doc, 'edited during save'), '/note.txt', 'after', 'v3'); expect(result.text).toBe('edited during save'); expect(isDirty(result)).toBe(true);
});

test('weather validates provider data and shares in-flight requests with caching and bounded retry', async () => {
  let calls = 0; let now = 1_000_000; let fail = false;
  let release: ((value: ReturnType<typeof parseForecast>) => void) | undefined;
  const pending = new Promise<ReturnType<typeof parseForecast>>(resolve => { release = resolve; });
  const store = new WeatherStore({ forecast: async () => { calls++; if (fail) throw new Error('Provider unavailable'); return pending; }, search: async () => [] }, () => now);
  const first = store.refresh(); const second = store.refresh(); expect(calls).toBe(1); release!(parseForecast(forecastFixture, DEFAULT_LOCATION, 'celsius', now)); await Promise.all([first, second]);
  await store.refresh(); expect(calls).toBe(1); expect(store.getSnapshot().status).toBe('ready');
  await store.refresh(true); expect(calls).toBe(1);
  now += 16 * 60_000; fail = true; await store.refresh(); expect(calls).toBe(2); expect(store.getSnapshot().status).toBe('error'); expect(store.getSnapshot().data).not.toBe(null);
  await store.refresh(true); expect(calls).toBe(2);
  expect(() => parseForecast({ current: {}, daily: {} }, DEFAULT_LOCATION, 'celsius')).toThrow();
});

test('PerfectHue selections require recorded permission and a valid credit URL', () => {
  const base = { id: 'test-credit', name: 'Metadata-only test', creator: 'Perfect Hue', asset: '/not-a-bundled-wallpaper', sourceURL: 'https://perfecthue.com/wallpapers/', creditURL: 'https://perfecthue.com/wallpapers/', kind: 'light' as const };
  expect(isWallpaperAvailable({ ...base, permission: 'pending' })).toBe(false);
  expect(isWallpaperAvailable({ ...base, permission: 'original' })).toBe(false);
  expect(isWallpaperAvailable({ ...base, permission: 'authorized', creditURL: 'javascript:alert(1)' })).toBe(false);
  expect(isWallpaperAvailable({ ...base, permission: 'authorized' })).toBe(true);
});

test('clearing weather caches prevents a pending response from restoring cleared data and retains cooldown', async () => {
  let now = 1_000_000; let calls = 0;
  let finish!: (value: ReturnType<typeof parseForecast>) => void;
  const response = new Promise<ReturnType<typeof parseForecast>>(resolve => { finish = resolve; });
  const store = new WeatherStore({ forecast: async () => { calls++; return response; }, search: async () => [] }, () => now);
  const pending = store.refresh();
  store.clearCache();
  finish(parseForecast(forecastFixture, DEFAULT_LOCATION, 'celsius', now)); await pending;
  expect(store.getSnapshot().data).toBe(null);
  expect(store.getSnapshot().status).toBe('idle');
  await store.refresh(true); expect(calls).toBe(1);
  now += 60_001; await store.refresh(true); expect(calls).toBe(2);
});
