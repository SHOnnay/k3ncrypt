import { signalDigest, verifySignalDigest } from './signalBinding';
import { MemoryReplayProtectionStore } from './replayProtection';
import type { CallSignal } from './contracts';
import { AuthenticatedCallSignalTransport } from './authenticatedTransport';
import { VerifiedCallIdentityVerifier } from './signalBinding';
const base = (): Omit<CallSignal, 'payloadDigest'> => ({ callId: 'call', conversationId: '11111111-1111-4111-8111-111111111111', sender: { participantId: 'a', identityId: 'id', verification: 'verified' }, event: 'invite', kind: 'control', payload: { sdp: 'offer' }, sequence: 1, timestamp: 100, expiresAt: 1_000, identityBinding: 'binding' });
describe('call signaling security', () => {
  it('detects modified SDP/ICE payloads through the authenticated envelope digest', async () => { const signal = { ...base(), payloadDigest: await signalDigest(base()) }; expect(await verifySignalDigest(signal)).toBe(true); const modified = { ...signal, payload: { sdp: 'tampered' } }; expect(await verifySignalDigest(modified)).toBe(false); });
  it('bounds replay entries with TTL and rejects duplicates', async () => { const store = new MemoryReplayProtectionStore(); expect(await store.claim('call:1', 100, 1)).toBe('accepted'); expect(await store.claim('call:1', 100, 2)).toBe('duplicate'); await store.cleanup(101); expect(await store.claim('call:1', 200, 101)).toBe('accepted'); expect(await store.claim('expired', 100, 101)).toBe('expired'); });
  it('binds wire origin to the existing authenticated session identity', async () => {
    const participant = { participantId: 'bob', identityId: 'bob-id', verification: 'verified' as const };
    const identity = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]));
    const cryptoSession = { encrypt: jest.fn(async (_channel: string, bytes: ArrayBuffer) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(bytes) })), decrypt: jest.fn(), ready: true, encrypted: true, initialize: jest.fn(), destroy: jest.fn() };
    const transport = { sendEnvelope: jest.fn(async () => ({})) };
    const signal = { ...base(), sender: participant, timestamp: Date.now(), expiresAt: Date.now() + 1000, payloadDigest: '' };
    signal.payloadDigest = await signalDigest(signal);
    const bound = new AuthenticatedCallSignalTransport(cryptoSession, transport as never, signal.conversationId, 'alice-id', participant, identity);
    await expect(bound.send(signal)).rejects.toThrow('origin rejected');
  });
});
