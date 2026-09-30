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

    test('does not invoke an unavailable future candidate and continues through relay', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const unavailableLan = nonRelayAdapter('lan', jest.fn().mockRejectedValue(new Error('unavailable')));
        const coordinator = new DeliveryCoordinator([unavailableLan, relay]);

        await coordinator.submit(envelope, 'recipient-route');

        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, 'recipient-route');
        expect(unavailableLan.submit).not.toHaveBeenCalled();
    });

    test('ignores a capability-mismatched future candidate and preserves relay baseline', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const incompatibleLan: DeliveryPathAdapter = {
            capabilities: { path: 'lan', encryptedEnvelopes: false, messageDelivery: true, offlineMailbox: false },
            submit: jest.fn(),
        };
        const coordinator = new DeliveryCoordinator([incompatibleLan, relay]);

        await coordinator.submit(envelope);

        expect(incompatibleLan.submit).not.toHaveBeenCalled();
        expect(sendEnvelope).toHaveBeenCalledWith('message', envelope, undefined);
    });

    test('relay-only privacy behavior never initializes fake LAN or direct candidates', async () => {
        const { relay, sendEnvelope } = relayHarness();
        const lanSubmit = jest.fn();
        const directSubmit = jest.fn();
        const coordinator = new DeliveryCoordinator([
            nonRelayAdapter('lan', lanSubmit), nonRelayAdapter('direct', directSubmit), relay,
        ]);

        await coordinator.submit(envelope);

        expect(lanSubmit).not.toHaveBeenCalled();
        expect(directSubmit).not.toHaveBeenCalled();
        expect(sendEnvelope).toHaveBeenCalledTimes(1);
    });
});

/**
 * Test-only model of the future policy contract. This deliberately does not
 * call or alter the production coordinator: non-relay paths remain disabled.
 */
describe('future transport-policy contract (fake adapters only)', () => {
    type FakeCandidate = {
        path: 'relay' | 'lan' | 'direct';
        locallyImplemented: boolean;
        peerCapabilityAuthenticated: boolean;
        peerSupports: boolean;
        verifiedUnchangedContact: boolean;
        explicitlyEnabled: boolean;
        privacyAllows: boolean;
        healthy: boolean;
        submit: (value: EncryptedEnvelope) => Promise<void>;
    };

    const eligibleInOrder = (candidates: FakeCandidate[], preference: 'relay-only' | 'prefer-nearby' | 'prefer-direct') => {
        const eligible = candidates.filter((candidate) => candidate.path === 'relay' || preference !== 'relay-only' && (
            candidate.locallyImplemented && candidate.peerCapabilityAuthenticated && candidate.peerSupports &&
            candidate.verifiedUnchangedContact && candidate.explicitlyEnabled && candidate.privacyAllows && candidate.healthy
        ));
        const order = preference === 'prefer-nearby' ? ['lan', 'direct', 'relay']
            : preference === 'prefer-direct' ? ['direct', 'lan', 'relay'] : ['relay'];
        return eligible.sort((left, right) => order.indexOf(left.path) - order.indexOf(right.path));
    };

    const submitWithFallback = async (
        candidates: FakeCandidate[], value: EncryptedEnvelope,
        preference: 'relay-only' | 'prefer-nearby' | 'prefer-direct' = 'relay-only',
    ) => {
        for (const candidate of eligibleInOrder(candidates, preference)) {
            try {
                await candidate.submit(value);
                return candidate.path;
            } catch {
                // Contract model only: caller retains the same saved envelope.
            }
        }
        return undefined;
    };

    test('skips unavailable or ineligible candidates and chooses relay', async () => {
        const lanSubmit = jest.fn();
        const relaySubmit = jest.fn().mockResolvedValue(undefined);
        const selected = await submitWithFallback([
            { path: 'lan', locallyImplemented: false, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: lanSubmit },
            { path: 'relay', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: false, explicitlyEnabled: false, privacyAllows: true, healthy: true, submit: relaySubmit },
        ], envelope, 'prefer-nearby');

        expect(selected).toBe('relay');
        expect(lanSubmit).not.toHaveBeenCalled();
        expect(relaySubmit).toHaveBeenCalledWith(envelope);
    });

    test('falls back after a failed preferred candidate using the exact same envelope', async () => {
        const lanSubmit = jest.fn().mockRejectedValue(new Error('definite pre-acceptance failure'));
        const relaySubmit = jest.fn().mockResolvedValue(undefined);
        const selected = await submitWithFallback([
            { path: 'lan', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: lanSubmit },
            { path: 'relay', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: false, explicitlyEnabled: false, privacyAllows: true, healthy: true, submit: relaySubmit },
        ], envelope, 'prefer-nearby');

        expect(selected).toBe('relay');
        expect(lanSubmit).toHaveBeenCalledWith(envelope);
        expect(relaySubmit).toHaveBeenCalledWith(envelope);
        expect(lanSubmit.mock.calls[0][0]).toBe(relaySubmit.mock.calls[0][0]);
    });

    test('ranks only eligible candidates according to explicit local preference', async () => {
        const paths: string[] = [];
        const submit = (path: string) => jest.fn(async (_value: EncryptedEnvelope) => { paths.push(path); });
        const lanSubmit = submit('lan');
        const directSubmit = submit('direct');
        const relaySubmit = submit('relay');
        const candidates: FakeCandidate[] = [
            { path: 'relay', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: false, explicitlyEnabled: false, privacyAllows: true, healthy: true, submit: relaySubmit },
            { path: 'direct', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: directSubmit },
            { path: 'lan', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: lanSubmit },
        ];

        await submitWithFallback(candidates, envelope, 'prefer-nearby');
        expect(paths).toEqual(['lan']);
        paths.length = 0;
        await submitWithFallback(candidates, envelope, 'prefer-direct');
        expect(paths).toEqual(['direct']);
        paths.length = 0;
        await submitWithFallback(candidates, envelope, 'relay-only');
        expect(paths).toEqual(['relay']);
    });

    test('rejects unauthenticated or mismatched capabilities before attempting the candidate', async () => {
        const directSubmit = jest.fn();
        const selected = await submitWithFallback([
            { path: 'direct', locallyImplemented: true, peerCapabilityAuthenticated: false, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: directSubmit },
            { path: 'direct', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: false,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: true, healthy: true, submit: directSubmit },
        ], envelope, 'prefer-nearby');

        expect(selected).toBeUndefined();
        expect(directSubmit).not.toHaveBeenCalled();
    });

    test('privacy restriction excludes optional candidates before submission', async () => {
        const optionalSubmit = jest.fn();
        const relaySubmit = jest.fn().mockResolvedValue(undefined);
        const selected = await submitWithFallback([
            { path: 'direct', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: true, explicitlyEnabled: true, privacyAllows: false, healthy: true, submit: optionalSubmit },
            { path: 'relay', locallyImplemented: true, peerCapabilityAuthenticated: true, peerSupports: true,
                verifiedUnchangedContact: false, explicitlyEnabled: false, privacyAllows: true, healthy: true, submit: relaySubmit },
        ], envelope, 'prefer-direct');

        expect(selected).toBe('relay');
        expect(optionalSubmit).not.toHaveBeenCalled();
        expect(relaySubmit).toHaveBeenCalledWith(envelope);
    });
});
