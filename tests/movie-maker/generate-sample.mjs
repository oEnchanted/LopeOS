/** Start Vite, then node tests/movie-maker/generate-sample.mjs. Uses the app's offline renderer. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); page.on('pageerror', error => console.error(error.message));
  await page.goto(`${process.env.MOVIE_TEST_URL || 'http://127.0.0.1:5188'}/tests/movie-maker/engine.html`);
  await page.waitForFunction(() => window.engineReady, { timeout: 30000 });
  const outputs = await page.evaluate(async () => {
    const sources = await window.movieSample.generateSampleVideoSources();
    return Promise.all(sources.map(async source => ({ name: source.name, data: [...new Uint8Array(await source.blob.arrayBuffer())] })));
  });
  const target = 'apps/web/src/apps/movie-maker/sample-media';
  await mkdir(target, { recursive: true });
  for (const output of outputs) { await writeFile(`${target}/${output.name}`, Buffer.from(output.data)); console.log(`${output.name}: ${output.data.length} bytes`); }
} finally { await browser.close(); }
