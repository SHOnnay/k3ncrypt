import { webcrypto } from 'crypto';
import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import { createAuthenticatedCallComposition } from './composition';
import { VerifiedCallIdentityVerifier, signalDigest } from './signalBinding';
import type { CallSignal } from './contracts';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const conversationId = '11111111-1111-4111-8111-111111111111';
const participant = (participantId: string, identityId: string) => ({ participantId, identityId, verification: 'verified' as const });
const deviceTrust = { assertTrusted: async () => undefined };

const session = (): CryptoSession => ({
  encrypted: true,
  ready: true,
  initialize: async () => undefined,
  encrypt: async (_channel, plaintext) => ({ version: 1, strategy: 'test', data: new TextDecoder().decode(plaintext) }),
  decrypt: async (_channel, envelope) => new TextEncoder().encode(String(envelope.data)).buffer as ArrayBuffer,
  destroy: () => undefined,
});

const connectedTransports = (): { alice: TransportManager; bob: TransportManager; connect: (a: { receive(envelope: EncryptedEnvelope): Promise<void> }, b: { receive(envelope: EncryptedEnvelope): Promise<void> }) => void } => {
  let alicePeer: { receive(envelope: EncryptedEnvelope): Promise<void> } | undefined;
  let bobPeer: { receive(envelope: EncryptedEnvelope): Promise<void> } | undefined;
  const create = (side: 'alice' | 'bob'): TransportManager => ({
    start: async () => undefined,
    stop: async () => undefined,
    join: () => undefined,
    sendEnvelope: async (_channel, envelope) => {
      const peer = side === 'alice' ? bobPeer : alicePeer;
      if (peer) await peer.receive(envelope);
      return {};
    },
    activeTransport: () => undefined,
  });
  return {
    alice: create('alice'),
    bob: create('bob'),
    connect: (a, b) => { alicePeer = a; bobPeer = b; },
  };
};

const identity = (local: string, remote: string) => new VerifiedCallIdentityVerifier(
  new Set([local, remote]),
  new Map([[local, 'verified'], [remote, 'verified']]),
);

describe('authenticated bidirectional call flow', () => {
  it('delivers invite and accept only through encrypted authenticated signaling', async () => {
    const transports = connectedTransports();
    const aliceIdentity = identity('alice', 'bob');
    const bobIdentity = identity('bob', 'alice');
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: aliceIdentity, deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: bobIdentity, deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const bobStates: string[] = [];
    bob.onCallUpdate((call) => bobStates.push(call.state));
    const outgoing = await alice.invite();
    expect(outgoing.state).toBe('inviting');
    expect(bobStates).toContain('ringing');
    const accepted = await bob.accept(outgoing.callId);
    expect(accepted.state).toBe('accepted');
    expect((await alice.service.get(outgoing.callId))?.state).toBe('accepted');
  });

  it('rejects a replayed or cross-conversation signal before lifecycle processing', async () => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: call.callId,
      conversationId: '22222222-2222-4222-8222-222222222222',
      sender: participant('alice', 'alice-id'),
      receiverIdentityId: 'bob-id',
      mediaMode: 'audio',
      nonce: '11111111-1111-4111-8111-111111111111',
      event: 'invite',
      kind: 'control',
      sequence: 1,
      timestamp: Date.now(),
      expiresAt: call.expiresAt,
      identityBinding: call.identityBinding,
    };
    const envelope = await session().encrypt('signaling', new TextEncoder().encode(JSON.stringify({ ...unsigned, payloadDigest: await signalDigest(unsigned) })).buffer);
    await expect(bob.signalTransport.receive(envelope)).rejects.toThrow('origin rejected');
  });
});
