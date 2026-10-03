import type { EncryptedEnvelope } from '../core/contracts';
import { DeliveryCoordinator } from './deliveryCoordinator';
import type { DeliveryPathAdapter } from './contracts';
import { RelayPathAdapter } from '../transports/relayPathAdapter';

const envelope: EncryptedEnvelope = {
    version: 2,
    strategy: 'vodozemac-olm-v1',
    data: { version: 1, olmMessage: 'opaque-test-ciphertext' },
};

describe('relay-only DeliveryCoordinator', () => {
    it('submits the exact opaque envelope through the existing relay operation', async () => {
        const sendEnvelope = jest.fn().mockResolvedValue({ id: 'relay-id', timestamp: 42 });
        const coordinator = new DeliveryCoordinator(new RelayPathAdapter({ sendEnvelope }));

        await expect(coordinator.submit(envelope, 'recipient-route')).resolves.toEqual({ id: 'relay-id', timestamp: 42 });
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
    });

    it('preserves relay errors without translating or retrying on another path', async () => {
        const failure = new Error('relay unavailable');
        const sendEnvelope = jest.fn().mockRejectedValue(failure);
        const coordinator = new DeliveryCoordinator(new RelayPathAdapter({ sendEnvelope }));

        await expect(coordinator.submit(envelope)).rejects.toBe(failure);
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
    });

    it('keeps existing retry throttling, skip behavior, and the same saved ciphertext', async () => {
        let now = 20_000;
        const sendEnvelope = jest.fn().mockResolvedValue({ id: 'relay-retry-id', timestamp: 123 });
        const coordinator = new DeliveryCoordinator(new RelayPathAdapter({ sendEnvelope }), () => now);
        const recent = { envelope, relayId: 'recent-id', sentAt: now - 1_000, clientId: 'recent' };
        const skipped = { envelope, clientId: 'held' };
        const stale = { envelope, relayId: 'old-id', sentAt: now - 6_000, clientId: 'retry' };
        const pending = [recent, skipped, stale];
        const beforeSubmit = jest.fn().mockResolvedValue(undefined);
        const persist = jest.fn().mockResolvedValue(undefined);

        await coordinator.retry({
            pending,
            recipientRoutingId: 'recipient-route',
            skip: (item) => item.clientId === 'held',
            beforeSubmit,
            persist,
        });

        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(sendEnvelope.mock.calls[0][1]).toBe(envelope);
        expect(beforeSubmit).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(pending);
        expect(recent.relayId).toBe('recent-id');
        expect(stale.relayId).toBe('relay-retry-id');
        expect(stale.sentAt).toBe(now);

        now += 1_000;
        await coordinator.retry({ pending, skip: (item) => item.clientId === 'held', beforeSubmit, persist });
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
    });

    it('leaves work pending and stops after a failed submission or pre-submit authorization check', async () => {
        const sendEnvelope = jest.fn().mockRejectedValue(new Error('relay unavailable'));
        const coordinator = new DeliveryCoordinator(new RelayPathAdapter({ sendEnvelope }));
        const pending = [{ envelope }];
        const persist = jest.fn();

        await expect(coordinator.retry({ pending, skip: () => false, beforeSubmit: async () => undefined, persist })).resolves.toBeUndefined();
        expect(pending[0]).toEqual({ envelope });
        expect(persist).not.toHaveBeenCalled();

        sendEnvelope.mockClear();
        await coordinator.retry({ pending, skip: () => false, beforeSubmit: async () => { throw new Error('trust unavailable'); }, persist });
        expect(sendEnvelope).not.toHaveBeenCalled();
        expect(persist).not.toHaveBeenCalled();
    });

    it('rejects adapters that are not an encrypted relay message path', () => {
        const invalid: DeliveryPathAdapter = {
            capabilities: { path: 'lan', encryptedEnvelopes: true, messageDelivery: true, offlineMailbox: false },
            submit: jest.fn(),
        };
        expect(() => new DeliveryCoordinator(invalid)).toThrow('An encrypted relay message path is required.');
    });
});
