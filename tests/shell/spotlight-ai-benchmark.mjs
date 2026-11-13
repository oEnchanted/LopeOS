/** Real, opt-in model comparison. Downloads public weights into an isolated browser profile. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.LOPE_QA_URL || 'http://127.0.0.1:5173';
const modelIds = process.env.LOPE_AI_MODELS?.split(',') || ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'Qwen3-1.7B-q4f16_1-MLC'];
const originalSystem = 'You are Spotlight, a small local assistant in LopeOS. Give helpful, concise answers. You can chat, explain, brainstorm, and help draft text. You cannot read files or clipboard, browse live websites, launch apps, or change settings. Do not claim you performed actions. If unsure, say so.';
const improvedSystem = 'You are Spotlight, a helpful assistant in LopeOS. Answer the user directly and concisely using general knowledge. For simple factual questions, give the fact first. Follow the requested format. If you do not know, say so. You have no tools or live data.';
const positiveSystem = 'You are Spotlight, a helpful assistant. Answer questions directly and follow the user’s requested format. Keep replies concise.';
const providerSystem = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';
const finalSystem = "You are Spotlight, a helpful assistant. Answer simple factual questions in one short sentence. Follow the user's instructions exactly. When drafting text, preserve the names, numbers, and details the user provides. Keep replies concise.";
const contaminated = [
  { role: 'user', content: 'where is paris france' },
  { role: 'assistant', content: "I don’t have access to your personal data, files, or real-time location. I can’t browse the internet or determine where you are. Please use a map or search engine for location information." },
];
const report = { modelIds, temperature: 0.3, topP: 0.9, seed: 11, maxTokens: 256, enableThinking: false, testedAt: new Date().toISOString(), results: [] };
const artifacts = new URL('./screenshots/', import.meta.url);
const browser = process.env.LOPE_AI_PROFILE
  ? await chromium.launchPersistentContext(process.env.LOPE_AI_PROFILE, { channel: 'chromium', headless: true })
  : await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + '/tests/shell/spotlight-ai-benchmark.html', { waitUntil: 'domcontentloaded' });
  report.storage = await page.evaluate(() => navigator.storage.estimate());
  await page.exposeFunction('__benchLog', value => console.log(JSON.stringify(value)));
  await page.evaluate(() => {
    window.__benchSequence = 0;
    window.__benchWorker = null;
    window.__benchCall = (payload, timeoutMs = 300000) => new Promise((resolve, reject) => {
      const id = ++window.__benchSequence;
      const started = performance.now();
      let text = '', chunks = 0, firstTokenMs = null, lastBucket = -1;
      const timer = setTimeout(() => { window.__benchWorker.terminate(); reject(new Error('Benchmark operation timed out')); }, timeoutMs);
      window.__benchWorker.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'Worker crashed')); };
      window.__benchWorker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'progress') {
          const bucket = Math.floor(data.progress * 10);
          if (bucket !== lastBucket) { lastBucket = bucket; void window.__benchLog({ model: payload.modelId, progress: data.progress, elapsedMs: Math.round(performance.now() - started) }); }
        }
        if (data.type === 'delta') { text += data.text; chunks++; if (firstTokenMs === null) firstTokenMs = performance.now() - started; }
        if (data.type === 'ready' || data.type === 'done') { clearTimeout(timer); resolve({ text, chunks, firstTokenMs, durationMs: performance.now() - started }); }
        if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
      };
      window.__benchWorker.postMessage({ ...payload, id });
    });
  });
  for (const modelId of modelIds) {
    const item = { modelId, metadata: null, initializationMs: null, cases: [] };
    report.results.push(item);
    item.metadata = await page.evaluate(async id => {
      const response = await fetch('https://huggingface.co/api/models/mlc-ai/' + id + '/tree/main');
      if (!response.ok) return { error: response.status };
      const files = await response.json();
      return { bytes: files.reduce((sum, file) => sum + (file.size || 0), 0), weightBytes: files.filter(file => file.path.endsWith('.bin')).reduce((sum, file) => sum + file.size, 0) };
    }, modelId);
    await page.evaluate(() => {
      window.__benchWorker?.terminate();
      window.__benchWorker = new Worker('/tests/shell/spotlight-ai-benchmark-worker.ts', { type: 'module' });
    });
    const loaded = await page.evaluate(id => window.__benchCall({ type: 'load', modelId: id }), modelId);
    item.initializationMs = loaded.durationMs;
    const systems = modelId.startsWith('SmolLM2') ? [['original', originalSystem], ['concise', improvedSystem]] : [['final', finalSystem]];
    for (const [systemName, system] of systems) {
      const ask = async (name, prompt, previous = []) => {
        const messages = [{ role: 'system', content: system }, ...previous, { role: 'user', content: prompt }];
        const result = await page.evaluate(messages => window.__benchCall({ type: 'generate', messages }, 90000), messages);
        const entry = { name, system: systemName, systemPrompt: system, prompt, ...result };
        item.cases.push(entry);
        console.log(JSON.stringify({ modelId, ...entry }));
        return result.text;
      };
      const paris = await ask('paris-clean', 'where is paris france');
      await ask('paris-followup', 'What river runs through it?', [{ role: 'user', content: 'where is paris france' }, { role: 'assistant', content: paris }]);
      await ask('paris-contaminated', 'where is paris france', contaminated);
      await ask('australia-capital', 'What is the capital of Australia? Answer in one short sentence.');
      await ask('short-draft', 'Write a friendly two-sentence note telling Sam I will be ten minutes late.');
      await ask('word-count', 'Return only the number of letters in the word "planet".');
      await ask('format', 'Give exactly three common fruits, separated by commas. No explanation.');
    }
    await mkdir(artifacts, { recursive: true });
    await writeFile(new URL('spotlight-ai-model-comparison.json', artifacts), JSON.stringify(report, null, 2) + '\n');
    await page.evaluate(async keepCache => { window.__benchWorker?.terminate(); if (!keepCache) for (const name of await caches.keys()) await caches.delete(name); }, Boolean(process.env.LOPE_AI_PROFILE));
  }
  console.log(JSON.stringify({ complete: true, models: report.results.map(model => ({ modelId: model.modelId, initializationMs: model.initializationMs, metadata: model.metadata, cases: model.cases.length })) }));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await mkdir(artifacts, { recursive: true });
  await writeFile(new URL('spotlight-ai-model-comparison.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally { await browser.close(); }
