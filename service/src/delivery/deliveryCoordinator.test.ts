import type { EncryptedEnvelope } from '../core/contracts';
import { DeliveryCoordinator, type PendingDeliveryEnvelope } from './deliveryCoordinator';
import type { DeliveryPathAdapter } from './contracts';
import { RelayPathAdapter } from '../transports/relayPathAdapter';

const envelope: EncryptedEnvelope = {
    version: 2,
    strategy: 'vodozemac-olm-v1',
    data: { version: 1, olmMessage: 'saved-opaque-envelope' },
};

const relayHarness = () => {
    const sendEnvelope = jest.fn<Promise<{ id?: string; timestamp?: number }>, [string, EncryptedEnvelope, string | undefined]>()
        .mockResolvedValue({ id: 'relay-id', timestamp: 123 });
    const relay = new RelayPathAdapter({ sendEnvelope });
    return { relay, sendEnvelope };
};

const nonRelayAdapter = (path: 'lan' | 'direct', submit = jest.fn().mockResolvedValue({ id: 'other-path' })): DeliveryPathAdapter => ({
    capabilities: { path, encryptedEnvelopes: true, messageDelivery: true, offlineMailbox: false },
    submit,
});

describe('relay-only delivery coordinator', () => {
    test('routes encrypted message submission through the relay adapter unchanged', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const coordinator = new DeliveryCoordinator([relay]);

        await expect(coordinator.submit(envelope, 'recipient-route')).resolves.toEqual({ id: 'relay-id', timestamp: 123 });
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
    });

    test('old-client-compatible send adds no capability or control protocol fields', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const coordinator = new DeliveryCoordinator([relay]);

        await coordinator.submit(envelope);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, undefined);
        expect(relay.capabilities).toEqual({
            path: 'relay', encryptedEnvelopes: true, messageDelivery: true, offlineMailbox: true,
        });
    });

    test('relay is the only selected path even if future-path adapters are present', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const lanSubmit = jest.fn().mockResolvedValue({ id: 'lan-id' });
        const directSubmit = jest.fn().mockResolvedValue({ id: 'direct-id' });
        const coordinator = new DeliveryCoordinator([
            nonRelayAdapter('lan', lanSubmit),
            nonRelayAdapter('direct', directSubmit),
            relay,
        ]);

        await coordinator.submit(envelope, 'recipient-route');
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(lanSubmit).not.toHaveBeenCalled();
        expect(directSubmit).not.toHaveBeenCalled();
    });

    test('requires a message-capable encrypted relay adapter', () => {
        expect(() => new DeliveryCoordinator([nonRelayAdapter('lan')])).toThrow('An encrypted relay message path is required.');
        expect(() => new DeliveryCoordinator([{
            capabilities: { path: 'relay', encryptedEnvelopes: true, messageDelivery: false, offlineMailbox: true },
            submit: jest.fn(),
        }])).toThrow('An encrypted relay message path is required.');
    });

    test('submit failures propagate unchanged; retry failures leave persisted outbox work pending', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const coordinator = new DeliveryCoordinator([relay]);
        sendEnvelope.mockRejectedValue(new Error('relay unavailable'));

        await expect(coordinator.submit(envelope, 'recipient-route')).rejects.toThrow('relay unavailable');
        const pending: PendingDeliveryEnvelope[] = [{ envelope }];
        const persist = jest.fn();
        await expect(coordinator.retry({ pending, recipientRoutingId: 'recipient-route', skip: () => false,
            beforeSubmit: async () => undefined, persist })).resolves.toBeUndefined();
        expect(sendEnvelope).toHaveBeenCalledTimes(2);
        expect(persist).not.toHaveBeenCalled();
        expect(pending[0].relayId).toBeUndefined();
        expect(pending[0].sentAt).toBeUndefined();
    });

    test('keeps retry throttling, skip, and exact saved-envelope behavior', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const coordinator = new DeliveryCoordinator([relay]);
        type TestPending = PendingDeliveryEnvelope & { clientId?: string };
        const recent: TestPending = { envelope, relayId: 'recent', sentAt: Date.now() };
        const skipped: TestPending = { envelope, clientId: 'held' };
        const stale: TestPending = { envelope, relayId: 'old-id', sentAt: Date.now() - 6000, clientId: 'allowed' };
        const pending: TestPending[] = [recent, skipped, stale];
        const beforeSubmit = jest.fn().mockResolvedValue(undefined);
        const persist = jest.fn().mockResolvedValue(undefined);

        await coordinator.retry({ pending, recipientRoutingId: 'recipient-route', skip: (item) => item.clientId === 'held', beforeSubmit, persist });

        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(beforeSubmit).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(pending);
        expect(recent.relayId).toBe('recent');
        expect(skipped.relayId).toBeUndefined();
        expect(stale.relayId).toBe('relay-id');
        expect(stale.sentAt).toEqual(expect.any(Number));
    });

    test('authorization failure stops before relay submission', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const coordinator = new DeliveryCoordinator([relay]);

        await coordinator.retry({ pending: [{ envelope }], skip: () => false,
            beforeSubmit: async () => { throw new Error('device unavailable'); }, persist: async () => undefined });

        expect(sendEnvelope).not.toHaveBeenCalled();
    });
});
