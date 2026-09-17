import { webcrypto } from 'crypto';

if (!globalThis.crypto) {
    (globalThis as any).crypto = webcrypto;
}
if (typeof window === 'undefined') {
    (globalThis as any).window = globalThis;
}

import { generateInviteSecret } from '../crypto/inviteCrypto';
import { createSecureStrategy } from '../crypto/strategies/secureStrategy';
import { LegacyInviteCryptoSession } from './legacyInviteCryptoSession';

const encode = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer;
const decode = (value: ArrayBuffer): string => new TextDecoder().decode(value);

describe('LegacyInviteCryptoSession', () => {
    it('preserves compatible message and signaling encryption for peers sharing an invite', async () => {
        const secret = generateInviteSecret();
        const alice = new LegacyInviteCryptoSession(createSecureStrategy);
        const bob = new LegacyInviteCryptoSession(createSecureStrategy);
        await alice.initialize(secret);
        await bob.initialize(secret);

        const message = await alice.encrypt('message', encode('hello'));
        const signal = await alice.encrypt('signaling', encode('offer'));

        expect(decode(await bob.decrypt('message', message))).toBe('hello');
        expect(decode(await bob.decrypt('signaling', signal))).toBe('offer');
        expect(alice.ready).toBe(true);
        expect(alice.encrypted).toBe(true);
    });

    it('keeps message and signaling keys domain-separated', async () => {
        const session = new LegacyInviteCryptoSession(createSecureStrategy);
        await session.initialize(generateInviteSecret());
        const message = await session.encrypt('message', encode('hello'));

        await expect(session.decrypt('signaling', message)).rejects.toThrow();
    });

    it('rejects operations after key state is destroyed', async () => {
        const session = new LegacyInviteCryptoSession(createSecureStrategy);
        await session.initialize(generateInviteSecret());
        session.destroy();

        expect(session.ready).toBe(false);
        await expect(session.encrypt('message', encode('hello'))).rejects.toThrow(/not initialized/i);
    });
});
