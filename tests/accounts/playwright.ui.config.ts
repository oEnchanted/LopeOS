import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'ui.spec.ts', timeout: 45_000,
  expect: { timeout: 10_000 }, workers: 2,
  outputDir: './ui-results', reporter: [['list']],
  use: { baseURL: process.env.LOPE_ACCOUNT_UI_URL || 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: process.env.LOPE_ACCOUNT_UI_URL ? undefined : {
    command: 'npm run dev:web', cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30_000,
  },
});
