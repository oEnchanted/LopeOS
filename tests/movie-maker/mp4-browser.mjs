import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188/tests/movie-maker/engine.html');
  await page.waitForFunction(() => window.engineReady);
  const result = await page.evaluate(async () => {
    const sample = await window.movieSample.createSampleProject(); const engine = window.movieEngine;
    const capabilities = await engine.getExportCapabilities(1280, 720, 30);
    if (!capabilities.mp4) return { skipped: true, capabilities };
    const project = sample.project; project.clips = [project.clips[0], project.clips[1], project.clips[3]].map(clip => ({ ...clip, duration: 90, sourceOut: clip.sourceIn + 90 }));
    project.overlays = []; project.audio = [{ ...project.audio[0], sourceOut: 270, fadeIn: 15, fadeOut: 15 }];
    const library = new engine.MediaLibrary(sample.blobs);
    try {
      const movie = await engine.exportMovie(project, library, { ...project.exportSettings, format: 'mp4' });
      const bytes = new Uint8Array(await movie.blob.arrayBuffer());
      const audioContext = new AudioContext(); const sound = await audioContext.decodeAudioData(bytes.buffer.slice(0)); const channel = sound.getChannelData(0); let energy = 0; for (const value of channel) energy += value * value; await audioContext.close();
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { skipped: false, capabilities, extension: movie.extension, mime: movie.mimeType, magic: String.fromCharCode(...bytes.slice(4, 8)), bytes: bytes.length, validation: movie.validation, audioRms: Math.sqrt(energy / channel.length), audioDuration: sound.duration, data: btoa(binary) };
    } finally { library.dispose(); }
  });
  if (!result.skipped) { expect(result.extension).toBe('mp4'); expect(result.mime).toBe('video/mp4'); expect(result.magic).toBe('ftyp'); expect(result.validation.videoCodec).toBe('avc'); expect(result.validation.audioCodec).toBe('aac'); expect(result.validation.width).toBe(1280); expect(result.validation.height).toBe(720); expect(result.validation.framesPerSecond).toBe(30); expect(result.validation.frameCount).toBe(270); expect(result.validation.duration).toBeCloseTo(9, 1); expect(result.audioRms).toBeGreaterThan(.01); await writeFile('docs/movie-maker/mp4-smoke-output.mp4', Buffer.from(result.data, 'base64')); }
  const { data, ...report } = result;
  await writeFile('docs/movie-maker/mp4-verification.json', JSON.stringify({ date: '2026-11-13', passed: !result.skipped, browser: 'Playwright Chromium', ...report }, null, 2) + '\n');
  console.log(report);
} finally { await browser.close(); }
