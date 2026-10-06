jest.mock('../crypto/base64url', () => ({
  toBase64Url: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
  fromBase64Url: (value: string) => new Uint8Array(Buffer.from(value, 'base64url')),
}));
import { webcrypto } from 'crypto';
import { ContactIdentityRegistry } from '../identity/contactIdentityRegistry';
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

  it('enforces one active call and does not let a second ringing invite replace it', async () => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    await expect(bob.invite()).rejects.toThrow('already active');
    expect(await bob.service.get(call.callId)).toMatchObject({ state: 'ringing' });
  });

  it.each(['alice', 'bob'] as const)('%s hangup sends the existing authenticated end event and ends both peers', async (endingSide) => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    await bob.accept(call.callId);
    for (const composition of [alice, bob]) {
      await composition.service.event(call.callId, 'connect');
      await composition.service.event(call.callId, 'connected');
    }

    await (endingSide === 'alice' ? alice : bob).end(call.callId);

    expect((await alice.service.get(call.callId))?.state).toBe('ended');
    expect((await bob.service.get(call.callId))?.state).toBe('ended');
  });

  it('does not send duplicate terminal signals for concurrent or repeated End actions', async () => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    await bob.accept(call.callId);
    for (const composition of [alice, bob]) {
      await composition.service.event(call.callId, 'connect');
      await composition.service.event(call.callId, 'connected');
    }
    const events: string[] = [];
    const originalSend = transports.alice.sendEnvelope.bind(transports.alice);
    transports.alice.sendEnvelope = async (channel, envelope, recipient, operation) => {
      if (channel === 'signaling') events.push('signal');
      return originalSend(channel, envelope, recipient, operation);
    };

    await Promise.all([alice.end(call.callId), alice.end(call.callId)]);
    await alice.end(call.callId);

    expect(events).toHaveLength(1);
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

  it('publishes local cancellation before a failed relay send can strand the ringing UI', async () => {
    let sends = 0;
    const transport: TransportManager = {
      start: async () => undefined,
      stop: async () => undefined,
      join: () => undefined,
      activeTransport: () => undefined,
      sendEnvelope: async () => {
        sends += 1;
        if (sends > 1) throw new Error('relay unavailable');
        return {};
      },
    };
    const caller = createAuthenticatedCallComposition({ session: session(), transport, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const observed: string[] = [];
    caller.onCallUpdate((call) => observed.push(call.state));
    const call = await caller.invite();

    await expect(caller.cancel(call.callId)).rejects.toThrow('relay unavailable');

    expect(await caller.service.get(call.callId)).toMatchObject({ state: 'cancelled' });
    expect(observed).toContain('cancelled');
  });

  it('expires unanswered local invitations and publishes terminal state', async () => {
    jest.useFakeTimers();
    try {
      const transports = connectedTransports();
      const caller = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
      const observed: string[] = [];
      caller.onCallUpdate((call) => observed.push(call.state));
      const call = await caller.invite();

      await jest.advanceTimersByTimeAsync(60_001);

      expect(await caller.service.get(call.callId)).toMatchObject({ state: 'expired' });
      expect(observed).toContain('expired');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not resurrect a canceled call when a later invitation reuses its call ID', async () => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    await alice.cancel(call.callId);
    const now = Date.now();
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: call.callId, conversationId, sender: participant('alice', 'alice-id'), receiverIdentityId: 'bob-id', mediaMode: 'audio',
      nonce: '22222222-2222-4222-8222-222222222222', event: 'invite', kind: 'control', sequence: 3, timestamp: now,
      expiresAt: now + 60_000, identityBinding: call.identityBinding,
    };
    await alice.signalTransport.send({ ...unsigned, payloadDigest: await signalDigest(unsigned) });
    expect(await bob.service.get(call.callId)).toMatchObject({ state: 'cancelled' });
  });
});

describe('live local verification call admission', () => {
  const states = ['unverified', 'unknown', 'changed-pending-review'] as const;
  it.each(states)('rejects outgoing %s before encrypted transport and does not promote trust', async (state) => {
    const transports = connectedTransports();
    const sent = jest.spyOn(transports.alice, 'sendEnvelope');
    const verifier = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]), async () => state);
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: verifier, deviceTrust });
    await expect(alice.invite()).rejects.toThrow('Verification');
    expect(sent).not.toHaveBeenCalled();
    expect(await verifier.getVerification('bob')).toBe(state);
  });
  it.each(states)('rejects incoming remote verified claim against local %s', async (state) => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const verifier = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]), async () => state);
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: verifier, deviceTrust });
    const updates = jest.fn(); bob.onCallUpdate(updates);
    transports.connect(alice.signalTransport, bob.signalTransport);
    await expect(alice.invite()).rejects.toThrow();
    expect(updates).not.toHaveBeenCalled();
    expect(await verifier.getVerification('alice')).toBe(state);
  });
  it('rechecks a cached composition after local unverify before accept and further sends', async () => {
    const transports = connectedTransports();
    let state: 'verified' | 'unverified' = 'verified';
    const verifier = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]), async () => state);
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: verifier, deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const call = await alice.invite();
    expect((await bob.service.get(call.callId))?.state).toBe('ringing');
    state = 'unverified';
    await expect(bob.accept(call.callId)).rejects.toThrow('Verification');
    await expect(bob.sendMediaSignal(call.callId, 'connected', 'ice-candidate', { candidate: 'test' })).rejects.toThrow('Verification');
    expect(state).toBe('unverified');
  });
});

describe('call admission backed by actual local contact records', () => {
  const contact = { identityId: 'alice-id', algorithm: 'test', publicKey: new Uint8Array(32).fill(1), verification: 'verified' as const };
  const setup = () => {
    const records = new Map<string, ArrayBuffer>();
    const writes = jest.fn(async (type: string, id: string, bytes: ArrayBuffer) => { records.set(`${type}:${id}`, bytes.slice(0)); });
    const storage = { read: async (type: string, id: string) => records.get(`${type}:${id}`), write: writes } as unknown as import('../core/contracts').SecureStorage;
    const registry = new ContactIdentityRegistry(storage);
    const verifier = new VerifiedCallIdentityVerifier(new Set(['alice', 'bob']), new Map([['alice', 'verified'], ['bob', 'verified']]), async () => {
      const current = await registry.get('alice', false);
      if (!current || current.identityId !== 'alice-id') return 'unknown';
      return current.changeStatus === 'unchanged' ? current.verification : 'changed-pending-review';
    });
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: verifier, deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    return { records, writes, registry, alice, bob };
  };
  it.each(['missing', 'unverified', 'changed', 'corrupt'] as const)('rejects incoming and outgoing with local %s records despite remote verified', async (state) => {
    const { records, writes, registry, alice, bob } = setup();
    if (state !== 'missing') await registry.observe('alice', contact);
    if (state === 'changed') { await registry.markVerified('alice', 'alice-id'); await registry.observe('alice', { ...contact, identityId: 'new-alice', publicKey: new Uint8Array(32).fill(2) }); }
    if (state === 'corrupt') records.set('contact-identity:alice', new TextEncoder().encode('{}').buffer);
    writes.mockClear();
    await expect(bob.invite()).rejects.toThrow();
    await expect(alice.invite()).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
  });
  it('permits an explicitly verified unchanged record and the existing encrypted accept flow without trust writes', async () => {
    const { registry, writes, alice, bob } = setup();
    await registry.observe('alice', contact);
    await registry.markVerified('alice', 'alice-id');
    writes.mockClear();
    const incoming = await alice.invite();
    expect((await bob.service.get(incoming.callId))?.state).toBe('ringing');
    await bob.accept(incoming.callId);
    expect((await alice.service.get(incoming.callId))?.state).toBe('accepted');
    expect(writes).not.toHaveBeenCalled();
  });
});
