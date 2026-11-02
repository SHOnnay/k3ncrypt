import { defineConfig, devices } from '@playwright/test';

// Runs against scripts/prod-stage.sh (local production build behind HTTPS). No dev servers.
const origin = process.env.K3NCRYPT_STAGE_ORIGIN ?? 'https://csp.localhost:43543';
export default defineConfig({
  testDir: './e2e-prod-stage',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: true,
    launchOptions: { args: ['--host-resolver-rules=MAP csp.localhost 127.0.0.1', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
