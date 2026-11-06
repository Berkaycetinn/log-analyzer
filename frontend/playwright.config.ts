import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 240_000,
  expect: { timeout: 15_000 }, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
});
