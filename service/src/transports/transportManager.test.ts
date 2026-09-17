import type { Transport } from '../core/contracts';
import { DefaultTransportManager } from './transportManager';

describe('DefaultTransportManager', () => {
    it('delegates opaque envelope operations without touching crypto state', async () => {
        const transport: jest.Mocked<Transport> = {
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            join: jest.fn(),
            sendEnvelope: jest.fn().mockResolvedValue({ id: 'message-id', timestamp: 1 }),
            connectionState: jest.fn().mockReturnValue('connected'),
            capabilities: jest.fn().mockReturnValue({ envelopes: true, blobs: false, localOnly: false }),
        };
        const manager = new DefaultTransportManager(transport);
        const envelope = { version: 1, strategy: 'test', data: { ciphertext: 'opaque' } };

        await manager.start();
        manager.join('conversation', 'routing-peer');
        await expect(manager.sendEnvelope('message', envelope)).resolves.toEqual({ id: 'message-id', timestamp: 1 });
        await manager.stop();

        expect(manager.activeTransport()).toBe(transport);
        expect(transport.join).toHaveBeenCalledWith('conversation', 'routing-peer');
        expect(transport.sendEnvelope).toHaveBeenCalledWith('message', envelope);
    });
});
