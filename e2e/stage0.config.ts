import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: '.', testMatch: /stage0-boundaries\.spec\.ts/, timeout: 60000,
    workers: 1, reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:43212' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: { cwd: process.cwd(), command: 'npm run dev --workspace=client -- --host 127.0.0.1 --port 43212', url: 'http://127.0.0.1:43212', reuseExistingServer: false },
});
