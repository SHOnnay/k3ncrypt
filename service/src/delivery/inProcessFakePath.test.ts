import type { EncryptedEnvelope } from '../core/contracts';
import type { DeliveryPathAdapter } from './contracts';

/** Test-only local path: no sockets, discovery, keys, identities, or crypto. */
class InProcessFakeLanPath implements DeliveryPathAdapter {
    public readonly capabilities = { path: 'lan', encryptedEnvelopes: true, messageDelivery: true, offlineMailbox: false } as const;
    private nextId = 0;
    constructor(private readonly receiver: (envelope: EncryptedEnvelope) => Promise<void>) {}
    async submit(envelope: EncryptedEnvelope, _recipientRoutingId?: string): Promise<{ id: string; timestamp: number }> {
        await this.receiver(envelope);
        this.nextId += 1;
        return { id: `in-process-${this.nextId}`, timestamp: this.nextId };
    }
}

describe('in-process local path adapter contract', () => {
    it('moves only the same opaque encrypted-envelope object to the fake peer', async () => {
        const envelope: EncryptedEnvelope = { version: 2, strategy: 'test-opaque', data: { ciphertext: 'dummy-ciphertext' } };
        const receive = jest.fn().mockResolvedValue(undefined);
        const fakeLan = new InProcessFakeLanPath(receive);

        await expect(fakeLan.submit(envelope, 'ephemeral-test-peer')).resolves.toEqual({ id: 'in-process-1', timestamp: 1 });
        expect(receive).toHaveBeenCalledTimes(1);
        expect(receive.mock.calls[0][0]).toBe(envelope);
        expect(fakeLan.capabilities.path).toBe('lan');
    });
});
