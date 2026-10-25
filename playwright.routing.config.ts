import { defineConfig } from '@playwright/test';
const mux = process.env.K3NCRYPT_ROUTING_TEST_MUX === 'true';
const backendPort = '43431', clientPort = '43432';
export default defineConfig({
  testDir: './e2e', testMatch: 'routing-lifecycle.spec.ts', timeout: 120000,
  expect: { timeout: 15000 }, workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${clientPort}` },
  webServer: { command: `CHATE2EE_API_URL=http://127.0.0.1:${backendPort} npm run dev --workspace=client -- --host 127.0.0.1 --port ${clientPort}`, url: `http://127.0.0.1:${clientPort}`, env: mux ? { VITE_K3NCRYPT_MUX_STAGE1: 'true' } : {}, reuseExistingServer: false, timeout: 60000 },
});
