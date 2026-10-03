import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: /web-outbox-recovery\.spec\.ts/,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    workers: 1,
    reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:43213' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        cwd: process.cwd(),
        command: 'npm run dev --workspace=client -- --host 127.0.0.1 --port 43213',
        url: 'http://127.0.0.1:43213',
        reuseExistingServer: false,
        timeout: 60_000,
    },
});
