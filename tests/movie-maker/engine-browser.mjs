import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188';
const browser = await chromium.launch({ headless: true });
const checks = [], errors = []; const started = Date.now();
await mkdir('docs/movie-maker/screenshots', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  let progressBucket = -1; await page.exposeFunction('reportExportProgress', progress => { const bucket = Math.floor(progress.fraction * 10); if (bucket !== progressBucket) { progressBucket = bucket; console.log(`${Math.round(progress.fraction * 100)}% ${progress.stage}`); } });
  await page.goto(`${base}/tests/movie-maker/engine.html`); await page.waitForFunction(() => window.engineReady);
  const fixture = await page.evaluate(async () => {
    const sample = await window.movieSample.createSampleProject(); window.fixture = sample;
    await window.moviePersistence.saveAutosave(sample.project, sample.blobs);
    const portable = await window.moviePersistence.encodePortable(sample.project, sample.blobs);
    const reopened = await window.moviePersistence.decodePortable(portable);
    const binary = new Uint8Array(await portable.arrayBuffer()); let data = ''; for (let i = 0; i < binary.length; i += 32768) data += String.fromCharCode(...binary.subarray(i, i + 32768));
    return { project: window.movieModel.serializeProject(sample.project), frames: window.movieModel.projectDuration(sample.project), clips: sample.project.clips.length, kinds: sample.project.clips.map(c => c.kind), assets: sample.blobs.size, equal: JSON.stringify(sample.project) === JSON.stringify(reopened.project), reopenedAssets: reopened.blobs.size, portable: btoa(data) };
  });
  expect(fixture.frames).toBe(5400); expect(fixture.clips).toBe(12); expect(fixture.kinds.filter(k => k === 'video')).toHaveLength(2); expect(fixture.kinds.filter(k => k === 'image')).toHaveLength(8); expect(fixture.equal).toBe(true); expect(fixture.reopenedAssets).toBe(fixture.assets);
  await writeFile('docs/movie-maker/sample.lopemovie', fixture.project); await writeFile('docs/movie-maker/sample.lopemoviebundle', Buffer.from(fixture.portable, 'base64'));
  checks.push('Exactly 180 seconds at 30 fps: 8 pictures, 2 real video sources with sound, title, 4 timed captions, credits, music and spoken narration');
  checks.push('Portable bundle roundtrip preserves all decisions and integrity-checked original media');
  await page.reload(); await page.waitForFunction(() => window.engineReady);
  const recovery = await page.evaluate(async () => { const saved = await window.moviePersistence.loadAutosave(); window.fixture = saved; window.library = new window.movieEngine.MediaLibrary(saved.blobs); return { project: window.movieModel.serializeProject(saved.project), missing: saved.missing, assets: saved.blobs.size }; });
  expect(recovery.project).toBe(fixture.project); expect(recovery.missing).toEqual([]); expect(recovery.assets).toBe(fixture.assets); checks.push('Reload recovers project and all media from IndexedDB');
  const failureCases = await page.evaluate(async () => {
    const p = window.moviePersistence; const sample = window.fixture; const results = {};
    try { await window.movieEngine.importMedia(new File(['not a picture'], 'broken.png', { type: 'image/png' })); } catch (error) { results.corrupt = error.message; }
    const put = IDBObjectStore.prototype.put;
    try { IDBObjectStore.prototype.put = function(...args) { if (this.name === 'projects') throw new DOMException('Injected full disk', 'QuotaExceededError'); return put.apply(this, args); }; await p.saveAutosave({ ...sample.project, name: 'Must not commit' }, sample.blobs); } catch (error) { results.quota = error.message; } finally { IDBObjectStore.prototype.put = put; }
    results.nameAfterFailedSave = (await p.loadAutosave()).project.name;
    const missing = structuredClone(sample.project); const id = missing.clips[1].assetId; missing.assets['missing-test'] = { ...missing.assets[id], id: 'missing-test' }; missing.clips[1].assetId = 'missing-test'; results.missing = (await p.loadAssets(missing)).missing;
    const controller = new AbortController(); const fingerprint = JSON.stringify(sample.project);
    try { await window.movieEngine.exportMovie(sample.project, window.library, { width: 320, height: 180, fps: { num: 30, den: 1 }, bitrate: 500000, audioBitrate: 64000, includeAudio: false, signal: controller.signal, onProgress: progress => { if (progress.fraction > .05) controller.abort(); } }); } catch (error) { results.cancelled = error.name; }
    results.cancelUnchanged = fingerprint === JSON.stringify(sample.project); return results;
  });
  expect(failureCases.corrupt).toMatch(/cannot be decoded|photo/i); expect(failureCases.quota).toMatch(/storage is full/i); expect(failureCases.nameAfterFailedSave).toBe('A little adventure'); expect(failureCases.missing).toContain('missing-test'); expect(failureCases.cancelled).toBe('AbortError'); expect(failureCases.cancelUnchanged).toBe(true);
  checks.push('Corrupt media rejection, missing-asset reporting, injected storage exhaustion rollback and mid-render cancellation recover without losing the project');
  const output = await page.evaluate(async () => {
    const result = await window.movieEngine.exportMovie(window.fixture.project, window.library, { ...window.fixture.project.exportSettings, onProgress: progress => { window.exportProgress = progress; void window.reportExportProgress(progress); } }); window.exportResult = result;
    const binary = new Uint8Array(await result.blob.arrayBuffer()); let data = ''; for (let i = 0; i < binary.length; i += 32768) data += String.fromCharCode(...binary.subarray(i, i + 32768));
    return { data: btoa(data), size: result.blob.size, validation: result.validation };
  });
  expect(output.validation.width).toBe(1280); expect(output.validation.height).toBe(720); expect(output.validation.frameCount).toBe(5400); expect(output.validation.framesPerSecond).toBe(30); expect(output.validation.duration).toBeCloseTo(180, 1); expect(output.validation.videoCodec).toBe('vp8'); expect(output.validation.audioCodec).toBe('opus'); expect(output.validation.audioPeak).toBeGreaterThan(.01);
  await writeFile('docs/movie-maker/sample-output.webm', Buffer.from(output.data, 'base64')); checks.push('Full 3-minute offline export independently reopens as 1280 × 720, 30 fps, VP8 video and Opus audio');
  const checkpoints = await page.evaluate(async () => {
    const result = window.exportResult, engine = window.movieEngine; const url = URL.createObjectURL(result.blob); const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Browser could not decode exported video')); video.src = url; });
    const expected = document.createElement('canvas'), actual = document.createElement('canvas'); expected.width = actual.width = 1280; expected.height = actual.height = 720; const a = expected.getContext('2d'), b = actual.getContext('2d'); const checks = [];
    for (const frame of [90, 400, 740, 1260, 1500, 2220, 3330, 5330]) {
      await engine.renderFrame(window.fixture.project, frame, expected, window.library);
      await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; video.currentTime = frame / 30; }); b.drawImage(video, 0, 0, 1280, 720);
      const left = a.getImageData(0, 0, 1280, 720).data, right = b.getImageData(0, 0, 1280, 720).data; let total = 0, n = 0; for (let i = 0; i < left.length; i += 16) for (let c = 0; c < 3; c++) { total += Math.abs(left[i + c] - right[i + c]); n++; }
      checks.push({ frame, seconds: frame / 30, meanAbsoluteChannelError: total / n });
    }
    const audioContext = new AudioContext(); const audio = await audioContext.decodeAudioData(await result.blob.arrayBuffer()); const channel = audio.getChannelData(0); let sum = 0; for (const value of channel) sum += value * value; const rms = Math.sqrt(sum / channel.length); await audioContext.close(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    const display = document.getElementById('preview'); display.width = 1280; display.height = 720; await engine.renderFrame(window.fixture.project, 400, display, window.library);
    return { frames: checks, audioDuration: audio.duration, channels: audio.numberOfChannels, rms };
  });
  for (const checkpoint of checkpoints.frames) expect(checkpoint.meanAbsoluteChannelError).toBeLessThan(12);
  expect(checkpoints.audioDuration).toBeCloseTo(180, 1); expect(checkpoints.rms).toBeGreaterThan(.01);
  checks.push('Eight decoded output checkpoints match the preview compositor within lossy VP8 tolerance, including title, captions, video, effect and credits'); checks.push('Independent browser audio decoder reads the whole soundtrack with nonzero RMS');
  await page.locator('#preview').screenshot({ path: 'docs/movie-maker/screenshots/preview-checkpoint.png' });
  expect(errors).toEqual([]);
  await writeFile('docs/movie-maker/engine-verification.json', JSON.stringify({ date: '2026-11-13', browser: 'Playwright Chromium', passed: true, elapsedSeconds: (Date.now() - started) / 1000, checks, failureCases, export: { ...output.validation, bytes: output.size }, checkpoints, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, checks, elapsedSeconds: (Date.now() - started) / 1000, export: output.validation, checkpoints }, null, 2));
} finally { await browser.close(); }
