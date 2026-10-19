import { defineConfig, devices } from '@playwright/test';
// Fixed loopback-only production stage; no test auth hooks or development server.
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 30000,
  expect: { timeout: 15000 },
  outputDir: '/private/tmp/k3ncrypt-phase37/results',
  reporter: [['list']],
  use: { baseURL: 'https://phase37.localhost:3447', headless: true,
    ignoreHTTPSErrors: true, screenshot: 'off', trace: 'off', video: 'off',
    launchOptions: { args: ['--host-resolver-rules=MAP phase37.localhost 127.0.0.1'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
