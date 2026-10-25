import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 180000, expect: { timeout: 15000 },
  outputDir: '/private/tmp/k3ncrypt-final-gate-production-results', reporter: 'list',
  use: { baseURL: 'https://final-gate.localhost:43473', headless: true, ignoreHTTPSErrors: true,
    trace: 'off', video: 'off', screenshot: 'off', launchOptions: { args: ['--host-resolver-rules=MAP final-gate.localhost 127.0.0.1'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node scripts/validation/final-gate-loopback.cjs', url: 'https://127.0.0.1:43473/api/ready', ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 60000 },
});
