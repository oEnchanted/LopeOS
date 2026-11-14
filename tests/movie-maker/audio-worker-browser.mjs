import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); await page.goto(process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188/tests/movie-maker/engine.html'); await page.waitForFunction(() => window.engineReady);
  const report = await page.evaluate(async () => {
    const { AudioMixWorker } = await import('/packages/media-engine/src/mix-worker-client.ts');
    const { mixBlock } = await import('/packages/media-engine/src/mix-math.ts');
    const channel = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i * .07) * .8);
    const music = { assetId: 'sound', kind: 'music', start: 0, duration: 1, offset: .1, speed: .5, volume: .7, fadeIn: .1, fadeOut: .2 };
    const voice = { ...music, assetId: 'voice', kind: 'narration', start: .2, duration: .3, speed: 1.25, volume: .8 };
    const block = { first: 0, length: 48000, sources: [music, voice].map(sound => ({ sound, pcm: { start: 0, sampleRate: 44100, channels: [channel] } })), sounds: [music, voice], emphasis: 'narration' };
    const expected = mixBlock(block), mixer = new AudioMixWorker();
    let maxError = 0;
    try { const actual = await mixer.mix(block); for (let ch = 0; ch < 2; ch++) for (let i = 0; i < actual[ch].length; i++) maxError = Math.max(maxError, Math.abs(actual[ch][i] - expected[ch][i])); } finally { mixer.dispose(); }
    const cancellation = new AudioMixWorker(), controller = new AbortController(); let abortName = '';
    try { const pending = cancellation.mix(block, controller.signal); controller.abort(); await pending; } catch (error) { abortName = error.name; } finally { cancellation.dispose(); }
    const disposal = new AudioMixWorker(); let disposalName = '';
    try { const pending = disposal.mix(block); disposal.dispose(); await pending; } catch (error) { disposalName = error.name; }
    const model = window.movieModel, engine = window.movieEngine, sample = await window.movieSample.createSampleProject();
    sample.project.clips = [{ ...sample.project.clips[3], duration: 90, sourceOut: sample.project.clips[3].sourceIn + 90 }]; sample.project.overlays = [];
    sample.project.audio = [{ ...sample.project.audio[0], sourceOut: 90, fadeIn: 15, fadeOut: 15 }];
    const library = new engine.MediaLibrary(sample.blobs); let output, legacyMaxError = 0;
    try {
      const actual = await engine.mixAudio(sample.project, library), legacy = [new Float32Array(actual.length), new Float32Array(actual.length)], sounds = engine.soundDecisions(sample.project), emphasis = sample.project.emphasis;
      // Preserve the pre-worker mixer as an independent regression oracle.
      for (let start = 0; start < actual.duration; start += 2) for (const sound of sounds) {
        const from = Math.max(start, sound.start), to = Math.min(actual.duration, start + 2, sound.start + sound.duration); if (to <= from) continue;
        const pcm = await library.service.audio(sound.assetId, sound.offset + (from - sound.start) * sound.speed, sound.offset + (to - sound.start) * sound.speed);
        for (let ch = 0; ch < 2; ch++) { const samples = pcm.channels[Math.min(ch, pcm.channels.length - 1)]; for (let i = Math.ceil(from * 48000); i < Math.min(actual.length, Math.ceil(to * 48000)); i++) { const time = i / 48000, sample = (sound.offset + (time - sound.start) * sound.speed) * pcm.sampleRate - pcm.start, index = Math.floor(sample), fraction = sample - index; legacy[ch][i] += ((samples[index] ?? 0) * (1 - fraction) + (samples[index + 1] ?? 0) * fraction) * engine.gainAt(sound, time, sounds, emphasis); } }
      }
      for (let ch = 0; ch < 2; ch++) for (let i = 0; i < actual.length; i++) { if (Math.abs(legacy[ch][i]) > .95) legacy[ch][i] = Math.sign(legacy[ch][i]) * (.95 + .05 * Math.tanh((Math.abs(legacy[ch][i]) - .95) / .05)); legacyMaxError = Math.max(legacyMaxError, Math.abs(actual.getChannelData(ch)[i] - legacy[ch][i])); }
      output = await engine.exportMovie(sample.project, library, { width: 640, height: 360, fps: { num: 30, den: 1 }, bitrate: 900000, audioBitrate: 128000, includeAudio: true, format: 'webm' });
    } finally { library.dispose(); }
    return { maxError, legacyMaxError, sourceStillIntact: channel.byteLength === 44100 * 4, abortName, disposalName, webm: output.validation };
  });
  expect(report.maxError).toBe(0); expect(report.legacyMaxError).toBe(0); expect(report.sourceStillIntact).toBe(true); expect(report.abortName).toBe('AbortError'); expect(report.disposalName).toBe('AbortError'); expect(report.webm.videoCodec).toBe('vp8'); expect(report.webm.audioCodec).toBe('opus'); expect(report.webm.frameCount).toBe(90); expect(report.webm.audioPeak).toBeGreaterThan(.01);
  await writeFile('docs/movie-maker/audio-worker-verification.json', JSON.stringify({ date: '2026-11-13', passed: true, browser: 'Playwright Chromium', ...report }, null, 2) + '\n'); console.log(report);
} finally { await browser.close(); }
