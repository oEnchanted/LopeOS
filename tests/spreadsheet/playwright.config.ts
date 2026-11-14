import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "./results",
  use: {
    baseURL: process.env.SHEET_TEST_URL ?? "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  },
});
