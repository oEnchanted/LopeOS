import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: /.*\.spec\.ts/, timeout: 30000,
  expect: { timeout: 7000 }, fullyParallel: true, workers: 2, retries: 0,
  outputDir: './results',
  reporter: [['list'], ['html', { outputFolder: resolve(import.meta.dirname, 'report'), open: 'never' }], ['json', { outputFile: resolve(import.meta.dirname, 'results/results.json') }]],
  use: { baseURL: process.env.LOPE_QA_URL || 'http://127.0.0.1:4176', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.LOPE_QA_FIREFOX_PATH } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.LOPE_QA_WEBKIT_PATH } } },
  ],
  webServer: process.env.LOPE_QA_URL ? undefined : { command: 'node tests/integration/serve-preview.mjs', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 30000 },
});
