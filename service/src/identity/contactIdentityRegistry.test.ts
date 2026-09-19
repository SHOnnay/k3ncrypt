jest.mock('../crypto/base64url', () => ({
    toBase64Url: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
    fromBase64Url: (value: string) => new Uint8Array(Buffer.from(value, 'base64url')),
}));
import { ContactIdentityRegistry } from './contactIdentityRegistry';
import type { SecureStorage } from '../core/contracts';

class MemoryStorage implements Pick<SecureStorage, 'read' | 'write'> {
    private readonly values = new Map<string, ArrayBuffer>();
    async read(type: string, id: string) { return this.values.get(`${type}:${id}`); }
    async write(type: string, id: string, value: ArrayBuffer) { this.values.set(`${type}:${id}`, value.slice(0)); }
}

const identity = (id: string, verification: 'unknown' | 'unverified' | 'verified' = 'unverified') => ({
    identityId: id, algorithm: 'Olm-Curve25519+Ed25519', publicKey: new Uint8Array(32).fill(id.charCodeAt(0)), verification,
});

describe('ContactIdentityRegistry', () => {
    it('uses TOFU and invalidates verification when a key changes', async () => {
        const registry = new ContactIdentityRegistry(new MemoryStorage() as unknown as SecureStorage);
        expect((await registry.observe('contact', identity('a'))).kind).toBe('first-seen');
        await registry.markVerified('contact');
        const changed = await registry.observe('contact', identity('b'));
        expect(changed.kind).toBe('identity-changed');
        if (changed.kind === 'identity-changed') {
            expect(changed.current.verification).toBe('unverified');
            expect(changed.verifiedIdentityPreserved).toBe(true);
        }
        await expect(registry.acceptPendingChange('contact')).resolves.toBeUndefined();
        const unchanged = await registry.observe('contact', identity('b'));
        expect(unchanged.kind).toBe('unchanged');
    });
});
