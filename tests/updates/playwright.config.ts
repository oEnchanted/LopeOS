import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: /.*\.spec\.ts/, timeout: 90000,
  expect: { timeout: 15000 }, fullyParallel: false, workers: 1,
  outputDir: './results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4186', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node tests/updates/server.mjs', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:4186/__test__/health', reuseExistingServer: false, timeout: 10000 },
});
