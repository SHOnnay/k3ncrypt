import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 180000,
  expect: { timeout: 15000 }, outputDir: '/private/tmp/phase4b-b-results',
  reporter: [['list']],
  use: { baseURL: 'https://phase4b.localhost:3453', headless: true,
    ignoreHTTPSErrors: true, screenshot: 'off', trace: 'off', video: 'off',
    launchOptions: { args: ['--host-resolver-rules=MAP phase4b.localhost 127.0.0.1'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
