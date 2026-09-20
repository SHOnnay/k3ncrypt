import { test, expect } from '@playwright/test';

test.describe('local Vodozemac browser package', () => {
    test('initializes generated bindings and creates a public identity', async ({ page }) => {
        const wasmRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('.wasm')) wasmRequests.push(request.url());
        });
        await page.goto('/crypto-smoke.html');
        const smoke = page.locator('#crypto-smoke');
        await expect(smoke).toHaveAttribute('data-status', 'ready');
        await expect(smoke).toHaveAttribute('data-lifecycle', 'identity-restored');
        await expect(smoke).toHaveAttribute('data-public-identity-length', /\d+/);
        await expect(smoke).toHaveAttribute('data-exposes-private-material', 'false');
        expect(wasmRequests).toHaveLength(1);
        expect(wasmRequests[0]).toContain(`127.0.0.1:${process.env.PLAYWRIGHT_CLIENT_PORT ?? '43102'}`);
    });

    test('fails closed for a missing local crypto artifact without exposing secrets', async ({ page }) => {
        await page.route('**/*.wasm', (route) => route.abort());
        await page.goto('/crypto-smoke.html');
        const smoke = page.locator('#crypto-smoke');
        await expect(smoke).toHaveAttribute('data-status', 'error');
        const error = await smoke.getAttribute('data-error');
        expect(error).not.toMatch(/pickle|private|secret|identity/i);
    });

    test('fails closed for a corrupted local crypto artifact without exposing secrets', async ({ page }) => {
        await page.route('**/*.wasm', (route) => route.fulfill({ status: 200, contentType: 'application/wasm', body: 'corrupted' }));
        await page.goto('/crypto-smoke.html');
        const smoke = page.locator('#crypto-smoke');
        await expect(smoke).toHaveAttribute('data-status', 'error');
        const error = await smoke.getAttribute('data-error');
        expect(error).not.toMatch(/pickle|private|secret|identity/i);
    });
});
