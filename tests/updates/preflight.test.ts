import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUpdateStorage, optionalUpdateCheck, waitForUpdate } from '../../apps/web/src/updates/preflight.ts';

test('storage check rejects insufficient space but permits staged retries and unavailable estimates', () => {
  assert.throws(() => checkUpdateStorage({ quota: 1000, usage: 900 }, 101), /not enough browser storage/);
  assert.doesNotThrow(() => checkUpdateStorage({ quota: 1000, usage: 900 }, 100));
  assert.doesNotThrow(() => checkUpdateStorage({ quota: 1000, usage: 1000 }, 0));
  assert.doesNotThrow(() => checkUpdateStorage({ quota: 1000, usage: 1000 }, 100, true));
  for (const estimate of [undefined, {}, { quota: 1000 }, { usage: 50 }, { quota: NaN, usage: 1 }]) {
    assert.doesNotThrow(() => checkUpdateStorage(estimate, 1000));
  }
});

test('reset interrupts pacing and optional model checks without waiting for their timers', async () => {
  const controller = new AbortController();
  const wait = waitForUpdate(60_000, controller.signal);
  const check = optionalUpdateCheck(new Promise<string>(() => {}), controller.signal, 60_000);
  controller.abort();
  await assert.rejects(wait, { name: 'AbortError' });
  await assert.rejects(check, { name: 'AbortError' });
  assert.throws(() => waitForUpdate(1, controller.signal), { name: 'AbortError' });
});

test('optional model failures and timeouts remain honest and do not block OS updates', async () => {
  const { signal } = new AbortController();
  assert.equal(await optionalUpdateCheck(Promise.resolve('Model updates found: Spotlight AI.'), signal), 'Model updates found: Spotlight AI.');
  assert.match(await optionalUpdateCheck(Promise.reject(new Error('Catalog unavailable')), signal), /information is unavailable/);
  assert.match(await optionalUpdateCheck(new Promise<string>(() => {}), signal, 1), /information is unavailable/);
});
