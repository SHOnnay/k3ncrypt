import { androidJsonQuoteSignalDigestForTest, diagnoseSignalDigestMismatch, signalDigest, signalDigestShape, verifyCurrentSignalDigest, verifySignalDigest } from './signalBinding';
import { DurableReplayProtectionStore, MemoryReplayProtectionStore } from './replayProtection';
import { SecureCallSignaling } from './signaling';
import type { CallSignal } from './contracts';
import { AuthenticatedCallSignalTransport } from './authenticatedTransport';
import { VerifiedCallIdentityVerifier } from './signalBinding';
import { createAuthenticatedCallComposition } from './composition';
const base = (): Omit<CallSignal, 'payloadDigest'> => ({ callId: 'call', conversationId: '11111111-1111-4111-8111-111111111111', sender: { participantId: 'a', identityId: 'id', verification: 'verified' }, receiverIdentityId: 'peer', mediaMode: 'audio', nonce: 'nonce-1', event: 'invite', kind: 'control', payload: { sdp: 'offer' }, sequence: 1, timestamp: 100, expiresAt: 1_000, identityBinding: 'binding' });
describe('call signaling security', () => {
  it('matches the Android canonical digest for SDP and ICE payloads', async () => {
    const common: Omit<CallSignal, 'payloadDigest' | 'kind' | 'payload'> = {
      callId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222',
      sender: { participantId: 'route-a', identityId: 'K3 device-a', verification: 'verified' }, receiverIdentityId: 'K3 device-b',
      mediaMode: 'audio', nonce: '33333333-3333-4333-8333-333333333333', event: 'connect', sequence: 2,
      timestamp: 1000, expiresAt: 61_000, identityBinding: 'binding',
    };
    const sdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
    expect(await signalDigest({ ...common, kind: 'offer', payload: { type: 'offer', sdp } })).toBe('e90ef86c39db5ddb05544835fc6f9eccb2be5ff4a99692d10d3bf35f7f6dfae9');
    const realisticSdp = `${sdp}a=rtpmap:111 opus/48000/2\r\n`;
    expect(await signalDigest({ ...common, kind: 'offer', payload: { type: 'offer', sdp: realisticSdp } })).toBe('21d0dbc9bb1292eafc0415d71c50fb613d9b259215aed4eef3980527b2474e9e');
    expect(await signalDigest({ ...common, kind: 'ice-candidate', payload: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host', sdpMLineIndex: 0 } })).toBe('f57dd5ede9fabfc325c657e28a8394624608cb56b35212fd5dfafc8cbeae7c7a');
  });
  it('keeps legacy digest fixtures and binds protocol v2 with a separate domain', async () => {
    const common: Omit<CallSignal, 'payloadDigest' | 'kind' | 'payload'> = {
      callId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222',
      sender: { participantId: 'route-a', identityId: 'K3 device-a', verification: 'verified' }, receiverIdentityId: 'K3 device-b',
      mediaMode: 'audio', nonce: '33333333-3333-4333-8333-333333333333', event: 'connect', sequence: 2,
      timestamp: 1000, expiresAt: 61_000, identityBinding: 'binding',
    };
    const sdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
    const legacy = { ...common, kind: 'offer' as const, payload: { type: 'offer', sdp } };
    expect(await signalDigest(legacy)).toBe('e90ef86c39db5ddb05544835fc6f9eccb2be5ff4a99692d10d3bf35f7f6dfae9');
    const current = { ...legacy, protocolVersion: 2 };
    expect(await signalDigest(current)).toBe('ba81d8dc7f38c95ad044f2bacadbfbf6d87fad04f677f934b9fe0332fe90e78b');
    expect(await verifyCurrentSignalDigest({ ...current, payloadDigest: await signalDigest(current) })).toBe(true);
    expect(await verifyCurrentSignalDigest({ ...current, protocolVersion: 3, payloadDigest: await signalDigest(current) })).toBe(false);
  });
  it('reports only call digest input component lengths for matched signal kinds', () => {
    const signal = { ...base(), kind: 'offer' as const, payload: { type: 'offer', sdp: 'v=0\r\no=-\r\n' }, payloadDigest: 'not-used-by-shape' };
    const shape = signalDigestShape(signal);
    expect(shape.inputLength).toBe(shape.metadataLength + shape.payloadJsonLength);
    expect(shape.sdpValueLength).toBe(new TextEncoder().encode('v=0\r\no=-\r\n').byteLength);
    expect(shape.inputLength).toBeGreaterThan(shape.payloadJsonLength);
  });
  it('detects modified SDP/ICE payloads through the authenticated envelope digest', async () => { const signal = { ...base(), payloadDigest: await signalDigest(base()) }; expect(await verifySignalDigest(signal)).toBe(true); const modified = { ...signal, payload: { sdp: 'tampered' } }; expect(await verifySignalDigest(modified)).toBe(false); });
  it('classifies legacy Android slash escaping without accepting the mismatched digest', async () => {
    const slashSdp = { ...base(), payload: { sdp: 'v=0\r\na=rtpmap:opus/48000/2' } };
    const received = { ...slashSdp, payloadDigest: await androidJsonQuoteSignalDigestForTest(slashSdp) };
    await expect(diagnoseSignalDigestMismatch(received)).resolves.toBe('escape-mismatch');
    await expect(verifySignalDigest(received)).resolves.toBe(false);
  });
  it('bounds replay entries with TTL and rejects duplicates', async () => { const store = new MemoryReplayProtectionStore(); expect(await store.claim('call:1', 100, 1)).toBe('accepted'); expect(await store.claim('call:1', 100, 2)).toBe('duplicate'); await store.cleanup(101); expect(await store.claim('call:1', 200, 101)).toBe('accepted'); expect(await store.claim('expired', 100, 101)).toBe('expired'); });
  it('delegates production replay claims to an atomic shared adapter', async () => {
    const adapter = { atomicClaim: jest.fn(async () => 'accepted' as const), cleanupExpired: jest.fn(async () => undefined) };
    const store = new DurableReplayProtectionStore(adapter);
    await expect(store.claim('call:1', 100, 1)).resolves.toBe('accepted');
    await store.cleanup(2);
    expect(adapter.atomicClaim).toHaveBeenCalledWith('call:1', 100, 1);
    expect(adapter.cleanupExpired).toHaveBeenCalledWith(2);
  });
  it('rejects invalid, expired, or unsupported versions before claiming replay state', async () => {
    const now = Date.now();
    const claims: string[] = [];
    const replay = { claim: async (key: string) => { claims.push(key); return 'accepted' as const; }, cleanup: async () => undefined };
    const verifier = new VerifiedCallIdentityVerifier(new Set(['a', 'b']), new Map([['a', 'verified'], ['b', 'verified']]));
    const signaling = new SecureCallSignaling(verifier, {} as never, replay);
    const unsigned = { ...base(), protocolVersion: 2, timestamp: now, expiresAt: now + 60_000, payload: undefined, event: 'invite' as const, kind: 'control' as const };
    const current = { ...unsigned, payloadDigest: await signalDigest(unsigned) };
    await expect(signaling.receive({ ...current, expiresAt: now - 1 }, async () => undefined)).rejects.toThrow('Invalid call signal');
    await expect(signaling.receive({ ...current, protocolVersion: 1 }, async () => undefined)).rejects.toThrow('Invalid call signal');
    expect(claims).toEqual([]);
    await signaling.receive(current, async () => undefined);
    expect(claims).toEqual([`${current.conversationId}:${current.callId}:a:${current.sequence}`]);
  });
  it('isolates replay identities by room when call IDs and sender sequences collide', async () => {
    const now = Date.now();
    const claims: string[] = [];
    const replay = { claim: async (key: string) => { claims.push(key); return 'accepted' as const; }, cleanup: async () => undefined };
    const verifier = new VerifiedCallIdentityVerifier(new Set(['a', 'b']), new Map([['a', 'verified'], ['b', 'verified']]));
    const signaling = new SecureCallSignaling(verifier, {} as never, replay);
    const common = { ...base(), protocolVersion: 2, callId: 'same-call-id', sender: { participantId: 'a', identityId: 'id', verification: 'verified' as const }, payload: undefined, event: 'invite' as const, kind: 'control' as const, timestamp: now, expiresAt: now + 60_000 };
    const roomA = { ...common, conversationId: '11111111-1111-4111-8111-111111111111', identityBinding: 'binding-a' };
    const roomB = { ...common, conversationId: '22222222-2222-4222-8222-222222222222', identityBinding: 'binding-b' };
    const signalA = { ...roomA, payloadDigest: await signalDigest(roomA) };
    const signalB = { ...roomB, payloadDigest: await signalDigest(roomB) };
    const accepted: string[] = [];
    await signaling.receive(signalA, async signal => { accepted.push(signal.conversationId); });
    await signaling.receive(signalB, async signal => { accepted.push(signal.conversationId); });
    expect(accepted).toEqual([roomA.conversationId, roomB.conversationId]);
    expect(claims).toEqual([
      `${roomA.conversationId}:same-call-id:a:1`,
      `${roomB.conversationId}:same-call-id:a:1`,
    ]);
  });
  it('binds wire origin to the existing authenticated session identity', async () => {
    const participant = { participantId: 'bob', identityId: 'bob-id', verification: 'verified' as const };
    const identity = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]));
    const cryptoSession = { encrypt: jest.fn(async (_channel: string, bytes: ArrayBuffer) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(bytes) })), decrypt: jest.fn(), ready: true, encrypted: true, initialize: jest.fn(), destroy: jest.fn() };
    const transport = { sendEnvelope: jest.fn(async () => ({})) };
    const signal = { ...base(), protocolVersion: 2, sender: participant, timestamp: Date.now(), expiresAt: Date.now() + 1000, payloadDigest: '' };
    signal.payloadDigest = await signalDigest(signal);
    const bound = new AuthenticatedCallSignalTransport(cryptoSession, transport as never, signal.conversationId, 'alice-id', participant, identity);
    await expect(bound.send(signal)).rejects.toThrow('origin rejected');
  });
  it('refuses to compose calls without an encrypted ready session', () => {
    const identity = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]));
    const session = { encrypted: false, ready: true } as never;
    expect(() => createAuthenticatedCallComposition({ session, transport: {} as never, conversationId: 'room', localIdentityId: 'alice-id', remoteParticipant: { participantId: 'bob', identityId: 'bob-id', verification: 'verified' }, identity, deviceTrust: { assertTrusted: async () => undefined } })).toThrow('not ready');
  });
});
