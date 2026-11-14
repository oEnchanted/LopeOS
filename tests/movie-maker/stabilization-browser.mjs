import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5191'}/tests/movie-maker/engine.html`); await page.waitForFunction(() => window.engineReady);
  const report = await page.evaluate(async () => {
    const codecs = await import('/packages/media-engine/src/shared-codecs.ts');
    const stabilization = await import('/packages/media-engine/src/stabilization.ts');
    const math = await import('/packages/media-engine/src/stabilization-math.ts');
    const model = window.movieModel, engine = window.movieEngine;
    const width = 240, height = 144, padding = 30, fps = 30, count = 60;
    const texture = document.createElement('canvas'); texture.width = width + padding * 2; texture.height = height + padding * 2;
    const textureContext = texture.getContext('2d'); const pixels = textureContext.createImageData(texture.width, texture.height); let seed = 91;
    for (let y = 0; y < texture.height; y += 2) for (let x = 0; x < texture.width; x += 2) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const color = 30 + (seed >>> 24) * .75; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const at = ((y + dy) * texture.width + x + dx) * 4; pixels.data.set([color, color, color, 255], at); } }
    textureContext.putImageData(pixels, 0, 0);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
    const target = new codecs.BufferTarget(), output = new codecs.Output({ format: new codecs.WebMOutputFormat(), target });
    const video = new codecs.CanvasSource(canvas, { codec: 'vp8', bitrate: 3500000 }); output.addVideoTrack(video, { frameRate: fps }); await output.start();
    const xPattern = [0, 4, -3, 2, -4, 3, -2, 0], yPattern = [0, 2, -2, 3, -3, 1, -1, 0];
    const shakes = [];
    for (let index = 0; index < count; index++) { const x = xPattern[index % 8], y = yPattern[index % 8]; shakes.push({ x, y }); context.drawImage(texture, -padding + x, -padding + y); await video.add(index / fps, 1 / fps); }
    video.close(); await output.finalize(); const sourceBlob = new Blob([target.buffer], { type: 'video/webm' });
    const imported = await engine.importMedia(new File([sourceBlob], 'Measured camera shake.webm', { type: 'video/webm' }));
    const project = model.addAssets(model.createProject('Stabilization regression'), [imported.asset]);
    const clip = project.clips[0]; clip.sourceOut = count; clip.duration = count; const library = new engine.MediaLibrary(new Map([[imported.asset.id, sourceBlob]]));
    const progress = []; const workers = []; const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker { constructor(url, options) { workers.push(String(url)); super(url, options); } };
    try {
      const result = await stabilization.analyzeStabilization(project, clip.id, library, { strength: 'gentle', onProgress: value => progress.push(value.fraction) });
      const deviation = values => { const meanX = values.reduce((n, p) => n + p.x, 0) / values.length, meanY = values.reduce((n, p) => n + p.y, 0) / values.length; return Math.sqrt(values.reduce((n, p) => n + (p.x - meanX) ** 2 + (p.y - meanY) ** 2, 0) / values.length); };
      const beforeRms = deviation(shakes), afterRms = deviation(shakes.map((shake, index) => ({ x: shake.x + result.samples[index].x * width, y: shake.y + result.samples[index].y * height })));
      const stabilized = model.updateClip(project, clip.id, { stabilization: result });
      const reopened = model.parseProject(model.serializeProject(stabilized));
      const preview = document.createElement('canvas'); preview.width = width; preview.height = height;
      await engine.renderFrame(stabilized, 24, preview, library); const previewPixels = preview.getContext('2d').getImageData(0, 0, width, height).data;
      const rendered = await engine.exportMovie(stabilized, library, { width, height, fps: project.fps, bitrate: 3500000, audioBitrate: 128000, includeAudio: false, format: 'webm' });
      const check = new engine.MediaLibrary(new Map([['output', rendered.blob]])); const decoded = await check.frame('output', 24 / fps + .00051, width); context.drawImage(decoded, 0, 0, width, height); const actualPixels = context.getImageData(0, 0, width, height).data;
      let error = 0; for (let i = 0; i < actualPixels.length; i += 4) for (let ch = 0; ch < 3; ch++) error += Math.abs(previewPixels[i + ch] - actualPixels[i + ch]); error /= width * height * 3;
      let referenceGray; const renderedMotions = [];
      for (let index = 16; index < 40; index++) {
        const frame = await check.frame('output', index / fps + .00051, width); context.drawImage(frame, 0, 0, width, height); const rgba = context.getImageData(0, 0, width, height).data;
        const data = Uint8Array.from({ length: width * height }, (_, i) => rgba[i * 4]); const gray = { width, height, data };
        if (!referenceGray) referenceGray = gray;
        const motion = math.estimateTranslation(referenceGray, gray); renderedMotions.push(motion);
      }
      const renderedRms = deviation(renderedMotions); const renderedConfidence = renderedMotions.reduce((n, p) => n + p.confidence, 0) / renderedMotions.length; check.dispose();
      const cancellation = new AbortController(); let cancelName = ''; try { await stabilization.analyzeStabilization(project, clip.id, library, { signal: cancellation.signal, onProgress: value => { if (value.fraction > .1) cancellation.abort(); } }); } catch (cause) { cancelName = cause.name; }
      const originalIntact = library.get(imported.asset.id).size === sourceBlob.size;
      const toBase64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
      return { beforeRms, afterRms, reductionPercent: (1 - afterRms / beforeRms) * 100, confidence: result.confidence, cropScale: result.cropScale, croppedAreaPercent: (1 - 1 / result.cropScale ** 2) * 100, samples: result.samples.length, lastProgress: progress.at(-1), progressMonotonic: progress.every((value, i) => !i || value >= progress[i - 1]), workerLaunched: workers.some(url => url.includes('stabilization.worker')), roundtrip: JSON.stringify(reopened.clips[0].stabilization.samples) === JSON.stringify(result.samples) && reopened.clips[0].stabilization.cropScale === result.cropScale, cancelName, originalIntact, previewExportMeanError: error, renderedRms, renderedConfidence, export: rendered.validation, beforeBytes: await toBase64(sourceBlob), afterBytes: await toBase64(rendered.blob) };
    } finally { library.dispose(); window.Worker = OriginalWorker; }
  });
  expect(report.afterRms).toBeLessThan(report.beforeRms * .15); expect(report.confidence).toBeGreaterThan(.7); expect(report.cropScale).toBeGreaterThan(1.03); expect(report.cropScale).toBeLessThan(1.15); expect(report.samples).toBe(60); expect(report.lastProgress).toBe(1); expect(report.progressMonotonic).toBe(true); expect(report.workerLaunched).toBe(true); expect(report.roundtrip).toBe(true); expect(report.cancelName).toBe('AbortError'); expect(report.originalIntact).toBe(true); expect(report.previewExportMeanError).toBeLessThan(6); expect(report.renderedRms).toBeLessThan(.5); expect(report.renderedConfidence).toBeGreaterThan(.7); expect(report.export.frameCount).toBe(60); expect(errors).toEqual([]);
  await writeFile('docs/movie-maker/stabilization-before.webm', Buffer.from(report.beforeBytes, 'base64')); await writeFile('docs/movie-maker/stabilization-after.webm', Buffer.from(report.afterBytes, 'base64'));
  delete report.beforeBytes; delete report.afterBytes;
  await writeFile('docs/movie-maker/stabilization-verification.json', JSON.stringify({ date: '2026-11-13', passed: true, browser: 'Playwright Chromium', ...report, errors }, null, 2) + '\n'); console.log(report);
} finally { await browser.close(); }
