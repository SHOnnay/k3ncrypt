import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const modulePath = `/@fs${resolve('service/src/storage/persistence.ts')}`;

test('IndexedDB security CAS has one winner across browser pages and rejects partial stale writes', async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto('/'), second.goto('/')]);
    const attempt = async (page: typeof first, next: string) => page.evaluate(async ({ value, modulePath }) => {
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ modulePath);
        const persistence = new IndexedDbVaultPersistence();
        return persistence.compareAndSwapRecords([
            { key: 'closure-state', expected: undefined, next: value },
            { key: 'closure-highwater', expected: undefined, next: value },
        ]);
    }, { value: next, modulePath });
    const results = await Promise.all([attempt(first, 'one'), attempt(second, 'two')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await second.evaluate(async (modulePath) => {
        const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ modulePath);
        const persistence = new IndexedDbVaultPersistence();
        const before = await persistence.readRecord('closure-state');
        const rejected = await persistence.compareAndSwapRecords([
            { key: 'closure-state', expected: before, next: 'partial-write' },
            { key: 'closure-highwater', expected: 'incorrect', next: 'partial-write' },
        ]);
        return { before, rejected, state: await persistence.readRecord('closure-state'), highwater: await persistence.readRecord('closure-highwater') };
    }, modulePath);
    expect(state.rejected).toBe(false);
    expect(state.state).toBe(state.before);
    expect(state.highwater).toBe(state.before);
});
