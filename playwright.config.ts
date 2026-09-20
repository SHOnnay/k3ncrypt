import { defineConfig, devices } from '@playwright/test';

const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? '43101';
const clientPort = process.env.PLAYWRIGHT_CLIENT_PORT ?? '43102';
const host = '127.0.0.1';
const clientUrl = `http://${host}:${clientPort}`;
const backendUrl = `http://${host}:${backendPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: clientUrl,
    headless: process.env.PLAYWRIGHT_HEADED === 'true' ? false : true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `cross-env NODE_ENV=test PORT=${backendPort} npm run serve:dev`,
      url: `${backendUrl}/api`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `cross-env CHATE2EE_API_URL=${backendUrl} npm run dev --workspace=client -- --host ${host} --port ${clientPort}`,
      url: clientUrl,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
