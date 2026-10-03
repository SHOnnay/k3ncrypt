import type { Transport } from '../core/contracts';
import { RelayPathAdapter } from './relayPathAdapter';

describe('RelayPathAdapter', () => {
    const makeRelay = (withReplay = true) => ({
        start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined),
        join: jest.fn().mockResolvedValue(undefined), sendEnvelope: jest.fn().mockResolvedValue({ id: 'relay-id', timestamp: 123 }),
        connectionState: jest.fn().mockReturnValue('connected'), capabilities: jest.fn().mockReturnValue({ envelopes: true, blobs: false, localOnly: false }),
        ...(withReplay ? { requestMailboxReplay: jest.fn().mockResolvedValue(undefined) } : {}),
    } satisfies Transport & Partial<{ requestMailboxReplay: jest.Mock }>);

    it('delegates start, join, send and mailbox replay to relay without changing wire inputs', async () => {
        const relay = makeRelay();
        const adapter = new RelayPathAdapter(relay);
        const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'opaque' } };
        const work = { conversationId: 'room', envelopeId: 'v1:local-only', channel: 'message' as const, envelope, recipientRoutingId: 'peer', proofOperation: 'relay:message' };
        await adapter.start();
        await adapter.join('room', 'peer', 'capability', 'proof');
        await expect(adapter.submit(work)).resolves.toEqual({ id: 'relay-id', timestamp: 123 });
        await adapter.requestMailboxReplay();
        await adapter.stop();
        expect(relay.join).toHaveBeenCalledWith('room', 'peer', 'capability', 'proof');
        expect(relay.sendEnvelope).toHaveBeenCalledWith('message', envelope, 'peer', 'relay:message');
        expect(JSON.stringify(relay.sendEnvelope.mock.calls[0])).not.toContain('v1:local-only');
        expect(relay.requestMailboxReplay).toHaveBeenCalledTimes(1);
    });

    it('preserves the existing relay rejection unchanged', async () => {
        const relay = makeRelay();
        const failure = new Error('relay unavailable');
        relay.sendEnvelope.mockRejectedValue(failure);
        const adapter = new RelayPathAdapter(relay);
        await expect(adapter.submit({ conversationId: 'room', envelopeId: 'v1:local', channel: 'message', envelope: { version: 2, strategy: 'vodozemac-olm-v1', data: {} } })).rejects.toBe(failure);
    });

    it('does not invent mailbox replay when the wrapped transport lacks that capability', async () => {
        const relay = makeRelay(false);
        const adapter = new RelayPathAdapter(relay);
        await expect(adapter.requestMailboxReplay()).rejects.toThrow('unavailable');
    });
});
