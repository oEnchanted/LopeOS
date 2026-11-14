/** Uses real Chromium IndexedDB. Start Vite on 5188 or set MOVIE_TEST_URL. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const evidence = { checkedAt: new Date().toISOString(), browser: browser.version(), checks: [] };
try {
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188'}/tests/movie-maker/engine.html`);
  await page.waitForFunction(() => window.engineReady, { timeout: 30000 });
  const beforeReload = await page.evaluate(async () => {
    const m = window.movieModel, s = window.moviePersistence;
    const project = m.createProject('Persistence baseline');
    const asset = { id: 'persistence-image', name: 'Original.png', kind: 'image', mime: 'image/png', size: 4, durationFrames: 0, width: 2, height: 2, hasAudio: false };
    project.assets[asset.id] = asset; project.clips.push(m.createClip(asset));
    project.overlays.push({ id: 'caption', clipId: project.clips[0].id, start: 15, duration: 60, ...m.defaultText('Preserved decisions') });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const blobs = new Map([[asset.id, blob]]);
    await s.saveAutosave(project, blobs);
    const loaded = await s.loadAutosave();
    return { expected: m.serializeProject(project), actual: m.serializeProject(loaded.project), bytes: [...new Uint8Array(await loaded.blobs.get(asset.id).arrayBuffer())], missing: loaded.missing };
  });
  assert.equal(beforeReload.expected, beforeReload.actual); assert.deepEqual(beforeReload.bytes, [1, 2, 3, 4]); assert.deepEqual(beforeReload.missing, []); evidence.checks.push('atomic project and original-media save/load');
  await page.reload(); await page.waitForFunction(() => window.engineReady);
  const afterReload = await page.evaluate(async () => { const loaded = await window.moviePersistence.loadAutosave(); return { project: window.movieModel.serializeProject(loaded.project), bytes: [...new Uint8Array(await loaded.blobs.get('persistence-image').arrayBuffer())] }; });
  assert.equal(afterReload.project, beforeReload.expected); assert.deepEqual(afterReload.bytes, [1, 2, 3, 4]); evidence.checks.push('reload recovery preserves edit decisions and source bytes');
  const failures = await page.evaluate(async () => {
    const s = window.moviePersistence, m = window.movieModel; const baseline = await s.loadAutosave();
    const originalPut = IDBObjectStore.prototype.put;
    const changed = { ...baseline.project, name: 'Must not replace baseline' };
    let message = '';
    // Fail the project-store write after the original-media write has already queued.
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new DOMException('Simulated full disk', 'QuotaExceededError'); return originalPut.apply(this, args); };
    try { await s.saveAutosave(changed, new Map([['persistence-image', new Blob([new Uint8Array([9, 9, 9, 9])])]])); } catch (error) { message = error.message; } finally { IDBObjectStore.prototype.put = originalPut; }
    const unchanged = await s.loadAutosave();
    const recovered = { ...baseline.project, name: 'Save recovered after quota error' }; await s.saveAutosave(recovered, baseline.blobs);
    return { message, unchanged: m.serializeProject(unchanged.project), bytes: [...new Uint8Array(await unchanged.blobs.get('persistence-image').arrayBuffer())], recoveredName: (await s.loadAutosave()).project.name };
  });
  assert.match(failures.message, /storage is full/); assert.equal(failures.unchanged, beforeReload.expected); assert.deepEqual(failures.bytes, [1, 2, 3, 4]); assert.equal(failures.recoveredName, 'Save recovered after quota error'); evidence.checks.push('simulated quota error rolls back both decision and media writes; subsequent save recovers');
  const ordering = await page.evaluate(async () => {
    const s = window.moviePersistence; const loaded = await s.loadAutosave();
    const first = s.saveAutosave({ ...loaded.project, name: 'Concurrent first' }, new Map([['persistence-image', new Blob([new Uint8Array([5])])]]));
    const second = s.saveAutosave({ ...loaded.project, name: 'Concurrent second' }, new Map([['persistence-image', new Blob([new Uint8Array([6])])]]));
    const third = s.saveAutosave({ ...loaded.project, name: 'Concurrent third' }, new Map([['persistence-image', new Blob([new Uint8Array([7])])]]));
    const immediatelyRead = s.loadAutosave(); await Promise.all([first, second, third]); const result = await immediatelyRead;
    const snapshot = structuredClone(result.project), map = new Map(result.blobs); const savingSnapshot = s.saveAutosave(snapshot, map); snapshot.name = 'Mutation after save call'; map.set('persistence-image', new Blob([new Uint8Array([8])])); await savingSnapshot;
    const snapshotResult = await s.loadAutosave();
    return { name: result.project.name, bytes: [...new Uint8Array(await result.blobs.get('persistence-image').arrayBuffer())], snapshotName: snapshotResult.project.name, snapshotBytes: [...new Uint8Array(await snapshotResult.blobs.get('persistence-image').arrayBuffer())] };
  });
  assert.equal(ordering.name, 'Concurrent third'); assert.deepEqual(ordering.bytes, [7]); assert.equal(ordering.snapshotName, 'Concurrent third'); assert.deepEqual(ordering.snapshotBytes, [7]); evidence.checks.push('concurrent saves finish in invocation order; read awaits queued saves; immutable snapshots resist caller mutation');
  const portable = await page.evaluate(async () => {
    const s = window.moviePersistence, m = window.movieModel; const saved = await s.loadAutosave(); const bundle = await s.encodePortable(saved.project, saved.blobs); const opened = await s.decodePortable(bundle);
    const missingProject = structuredClone(saved.project); const reference = { ...Object.values(saved.project.assets)[0], id: 'missing-original' }; missingProject.assets[reference.id] = reference;
    const missing = await s.loadAssets(missingProject);
    await s.clearAutosave(); return { same: m.serializeProject(saved.project) === m.serializeProject(opened.project), bytes: [...new Uint8Array(await opened.blobs.get('persistence-image').arrayBuffer())], missing: missing.missing, cleared: await s.loadAutosave(), sourceRetained: !!(await s.loadAsset('persistence-image')) };
  });
  assert.equal(portable.same, true); assert.deepEqual(portable.bytes, [7]); assert.deepEqual(portable.missing, ['missing-original']); assert.equal(portable.cleared, null); assert.equal(portable.sourceRetained, true); evidence.checks.push('portable reopen, missing-reference recovery list, and clearing project without deleting originals');
  assert.deepEqual(pageErrors, []); evidence.status = 'PASS';
  await mkdir('docs/movie-maker', { recursive: true }); await writeFile('docs/movie-maker/persistence-verification.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
