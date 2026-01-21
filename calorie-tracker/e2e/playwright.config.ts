import { defineConfig, devices } from '@playwright/test';

const port = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 8000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL,
    headless: true,
    actionTimeout: 5000,
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]]
});
