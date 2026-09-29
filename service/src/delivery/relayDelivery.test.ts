import type { EncryptedEnvelope, TransportManager } from '../core/contracts';
import { RelayDeliveryBoundary, type PendingRelayEnvelope } from './relayDelivery';

const envelope: EncryptedEnvelope = {
    version: 2,
    strategy: 'vodozemac-olm-v1',
    data: { version: 1, olmMessage: 'saved-opaque-envelope' },
};

const harness = () => {
    const sendEnvelope = jest.fn<Promise<{ id?: string; timestamp?: number }>, [string, EncryptedEnvelope, string | undefined]>()
        .mockResolvedValue({ id: 'relay-id', timestamp: 123 });
    const boundary = new RelayDeliveryBoundary({ sendEnvelope } as Pick<TransportManager, 'sendEnvelope'>);
    return { boundary, sendEnvelope };
};

describe('relay-only delivery boundary', () => {
    test('submits the existing encrypted envelope with unchanged relay arguments and result', async () => {
        const { boundary, sendEnvelope } = harness();
        await expect(boundary.submit(envelope, 'recipient-route')).resolves.toEqual({ id: 'relay-id', timestamp: 123 });
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
    });

    test('old-client path sends without feature negotiation or a new control frame', async () => {
        const { boundary, sendEnvelope } = harness();
        await boundary.submit(envelope);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, undefined);
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
    });

    test('retry records relay ID and local submission time only after relay succeeds', async () => {
        const { boundary, sendEnvelope } = harness();
        const pending: PendingRelayEnvelope[] = [
            { envelope, relayId: 'recent', sentAt: Date.now() },
            { envelope },
        ];
        const beforeSubmit = jest.fn().mockResolvedValue(undefined);
        const persist = jest.fn().mockResolvedValue(undefined);
        await boundary.retry({ pending, recipientRoutingId: 'recipient-route', skip: () => false, beforeSubmit, persist });
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(beforeSubmit).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(pending);
        expect(pending[0].relayId).toBe('recent');
        expect(pending[1].relayId).toBe('relay-id');
        expect(pending[1].sentAt).toEqual(expect.any(Number));
    });

    test('renewal skip and stale retry use the original pending envelope', async () => {
        const { boundary, sendEnvelope } = harness();
        const old = { envelope, relayId: 'old-id', sentAt: Date.now() - 6000, clientId: 'allowed' };
        const skipped: PendingRelayEnvelope & { clientId: string } = { envelope, clientId: 'held' };
        const pending = [skipped, old];
        await boundary.retry({ pending, skip: (item) => item.clientId !== 'allowed', beforeSubmit: async () => undefined,
            persist: async () => undefined });
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
        expect(sendEnvelope).toHaveBeenCalledWith('message', old.envelope, undefined);
        expect(skipped.relayId).toBeUndefined();
        expect(old.relayId).toBe('relay-id');
    });

    test('direct transport error propagates; retry transport error leaves pending for later', async () => {
        const { boundary, sendEnvelope } = harness();
        sendEnvelope.mockRejectedValue(new Error('relay unavailable'));
        await expect(boundary.submit(envelope, 'recipient-route')).rejects.toThrow('relay unavailable');
        const pending: PendingRelayEnvelope[] = [{ envelope }];
        const persist = jest.fn();
        await expect(boundary.retry({ pending, recipientRoutingId: 'recipient-route', skip: () => false,
            beforeSubmit: async () => undefined, persist })).resolves.toBeUndefined();
        expect(persist).not.toHaveBeenCalled();
        expect(pending[0].relayId).toBeUndefined();
        expect(pending[0].sentAt).toBeUndefined();
    });

    test('authorization failure stops retry before transport submission', async () => {
        const { boundary, sendEnvelope } = harness();
        const pending = [{ envelope }];
        await boundary.retry({ pending, skip: () => false,
            beforeSubmit: async () => { throw new Error('device unavailable'); }, persist: async () => undefined });
        expect(sendEnvelope).not.toHaveBeenCalled();
    });
});
