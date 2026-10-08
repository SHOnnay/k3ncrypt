import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'crypto';

const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? '43101';
const clientPort = process.env.PLAYWRIGHT_CLIENT_PORT ?? '43102';
const host = '127.0.0.1';
const clientUrl = `http://${host}:${clientPort}`;
const backendUrl = `http://${host}:${backendPort}`;
const mongoUri = process.env.PLAYWRIGHT_MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const mongoHost = new URL(mongoUri).hostname.replace(/^\[|\]$/g, '');
if (!['127.0.0.1', 'localhost', '::1'].includes(mongoHost)) {
  throw new Error('Playwright MongoDB must use a loopback host; production and remote MongoDB are not supported.');
}
const mongoDbName = process.env.PLAYWRIGHT_MONGO_DB_NAME ?? `k3ncrypt_playwright_${process.pid}`;
const muxStage1 = process.env.PLAYWRIGHT_MUX_STAGE1 === 'true';
if (!/^k3ncrypt_playwright_[a-zA-Z0-9_-]+$/.test(mongoDbName)) {
  throw new Error('PLAYWRIGHT_MONGO_DB_NAME must use the isolated k3ncrypt_playwright_ prefix.');
}
const deviceTrustTestSecret = randomBytes(32).toString('base64url');

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
      command: `cross-env NODE_ENV=test PORT=${backendPort} K3NCRYPT_ALLOWED_ORIGINS=${clientUrl} npm run serve:dev`,
      url: `${backendUrl}/api/ready`,
      env: {
        K3NCRYPT_BIND_HOST: host,
        MONGO_URI: mongoUri,
        MONGO_DB_NAME: mongoDbName,
        K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: deviceTrustTestSecret,
        ...(muxStage1 ? { K3NCRYPT_MUX_MESSAGE_DELIVERY: 'true', K3NCRYPT_TEST_MUX_SUBSCRIPTION_LEASE_MS: '90000' } : {}),
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `cross-env CHATE2EE_API_URL=${backendUrl} npm run dev --workspace=client -- --host ${host} --port ${clientPort}`,
      url: clientUrl,
      env: muxStage1 ? { VITE_K3NCRYPT_MUX_STAGE1: 'true' } : {},
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
