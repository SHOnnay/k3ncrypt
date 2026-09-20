import { signalDigest, verifySignalDigest } from './signalBinding';
import { MemoryReplayProtectionStore } from './replayProtection';
import type { CallSignal } from './contracts';
const base = (): Omit<CallSignal, 'payloadDigest'> => ({ callId: 'call', conversationId: '11111111-1111-4111-8111-111111111111', sender: { participantId: 'a', identityId: 'id', verification: 'verified' }, event: 'invite', kind: 'control', payload: { sdp: 'offer' }, sequence: 1, timestamp: 100, expiresAt: 1_000, identityBinding: 'binding' });
describe('call signaling security', () => {
  it('detects modified SDP/ICE payloads through the authenticated envelope digest', async () => { const signal = { ...base(), payloadDigest: await signalDigest(base()) }; expect(await verifySignalDigest(signal)).toBe(true); const modified = { ...signal, payload: { sdp: 'tampered' } }; expect(await verifySignalDigest(modified)).toBe(false); });
  it('bounds replay entries with TTL and rejects duplicates', async () => { const store = new MemoryReplayProtectionStore(); expect(await store.claim('call:1', 100, 1)).toBe(true); expect(await store.claim('call:1', 100, 2)).toBe(false); await store.cleanup(101); expect(await store.claim('call:1', 200, 101)).toBe(true); });
});
