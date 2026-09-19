import type { SecureStorage } from '../core/contracts';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { VodozemacSessionRepository } from './vodozemacSessionRepository';

class Records {
    private readonly values = new Map<string, ArrayBuffer>();
    async read(type: string, id: string) { return this.values.get(`${type}:${id}`)?.slice(0); }
    async write(type: string, id: string, bytes: ArrayBuffer) { this.values.set(`${type}:${id}`, bytes.slice(0)); }
    async delete(type: string, id: string) { this.values.delete(`${type}:${id}`); }
}

const session = (id: string): VodozemacSessionHandle => ({
    sessionId: () => id,
    saveSession: () => new TextEncoder().encode(id),
    encrypt: () => '', decrypt: () => new Uint8Array(),
});

it('retains the active outbound session and recently used inbound sessions within eight records', async () => {
    const records = new Records();
    const repository = new VodozemacSessionRepository(records as unknown as SecureStorage, {
        loadSession: (bytes) => session(new TextDecoder().decode(bytes)),
    });
    await repository.save('contact', session('active'), true);
    for (let index = 1; index <= 7; index++) await repository.save('contact', session(`inbound-${index}`));
    expect(await repository.activeOutboundSessionId('contact')).toBe('active');
    await repository.load('contact', 'inbound-1');
    await repository.save('contact', session('inbound-8'));
    expect(await repository.listSessionIds('contact')).toEqual([
        'active', 'inbound-3', 'inbound-4', 'inbound-5', 'inbound-6', 'inbound-7', 'inbound-1', 'inbound-8',
    ]);
    await expect(repository.load('contact', 'inbound-2')).rejects.toThrow('not retained');
    expect((await repository.load('contact', 'active')).sessionId()).toBe('active');
});
