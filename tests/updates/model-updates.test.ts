import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModelUpdates, getModelReleases, parseModelReleases } from '../../apps/web/src/updates/model-updates.ts';

test('release model checks compare the same catalog used by the build without fetching models', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Model update checks must not fetch optional model assets.'); };
  try {
    const catalog = await getModelReleases();
    assert.deepEqual(catalog.map(model => model.id), ['spotlight', 'denoise', 'portrait']);
    assert.deepEqual(parseModelReleases(catalog), catalog);
    assert.equal(new Set(catalog.map(model => model.fingerprint)).size, 3);
    assert.match(await checkModelUpdates(catalog), /No model catalog changes/);
    assert.deepEqual(await getModelReleases(), catalog);
  } finally { globalThis.fetch = originalFetch; }
});

test('a changed fingerprint identifies the affected model without requiring a download', async () => {
  const target = await getModelReleases();
  target[0] = { ...target[0], fingerprint: 'f'.repeat(64) };
  const result = await checkModelUpdates(target);
  assert.match(result, /Model updates found: Spotlight AI/);
  assert.doesNotMatch(result, /Photo denoise|Portrait cutouts/);
  assert.match(result, /downloads remain optional/);
});

test('added and removed model entries are reported as catalog changes', async () => {
  const current = await getModelReleases();
  const target = [...current.slice(1), { id: 'new-assistant', name: 'New assistant', fingerprint: 'a'.repeat(64) }];
  const result = await checkModelUpdates(target);
  assert.match(result, /Model updates found: New assistant/);
  assert.match(result, /No longer listed in this release: Spotlight AI/);
  assert.match(result, /Existing downloads are kept/);
});

test('older releases without model metadata report an unavailable check honestly', async () => {
  assert.equal(parseModelReleases(undefined), undefined);
  assert.match(await checkModelUpdates(undefined), /does not publish model update information/);
  assert.doesNotMatch(await checkModelUpdates(undefined), /No model catalog changes/);
});

test('malformed, duplicated, and oversized model metadata is rejected', () => {
  const valid = { id: 'spotlight', name: 'Spotlight AI', fingerprint: 'a'.repeat(64) };
  for (const value of [null, {}, ['spotlight'], [null], [{ ...valid, fingerprint: 'unknown' }],
    [{ ...valid, id: '../spotlight' }], [{ ...valid, name: ' ' }], [{ ...valid, name: 'a'.repeat(101) }],
    [valid, valid], Array.from({ length: 33 }, (_, index) => ({ ...valid, id: `model-${index}` }))]) {
    assert.throws(() => parseModelReleases(value), /model update information is invalid/);
  }
  assert.deepEqual(parseModelReleases([]), []);
});
