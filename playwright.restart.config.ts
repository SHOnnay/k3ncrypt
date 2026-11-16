import { defineConfig, devices } from '@playwright/test';
// The relay-restart spec starts, kills and restarts its own relay (loopback Mongo only); Playwright serves the client.
//   npx playwright test -c playwright.restart.config.ts            (multiplexed relay, as in production)
//   K3NCRYPT_RESTART_TEST_LEGACY=true npx playwright test -c playwright.restart.config.ts
const legacy = process.env.K3NCRYPT_RESTART_TEST_LEGACY === 'true';
const backendPort = '43451', clientPort = '43452';
export default defineConfig({
  testDir: './e2e', testMatch: 'relay-restart-call.spec.ts', timeout: 240_000,
  expect: { timeout: 15_000 }, workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${clientPort}`, ...devices['Desktop Chrome'] },
  webServer: { command: `npx cross-env CHATE2EE_API_URL=http://127.0.0.1:${backendPort} npm run dev --workspace=client -- --host 127.0.0.1 --port ${clientPort}`,
    url: `http://127.0.0.1:${clientPort}`, env: legacy ? {} : { VITE_K3NCRYPT_MUX_STAGE1: 'true' }, reuseExistingServer: false, timeout: 60_000 },
});
