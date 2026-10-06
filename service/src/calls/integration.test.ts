jest.mock('../crypto/base64url', () => ({
  toBase64Url: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
  fromBase64Url: (value: string) => new Uint8Array(Buffer.from(value, 'base64url')),
}));
import { webcrypto } from 'crypto';
import { ContactIdentityRegistry } from '../identity/contactIdentityRegistry';
import type { CryptoSession, EncryptedEnvelope, TransportManager } from '../core/contracts';
import { createAuthenticatedCallComposition } from './composition';
import { identityBinding, VerifiedCallIdentityVerifier, legacySignalDigest, signalDigest } from './signalBinding';
import type { CallSession, CallSignal } from './contracts';

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
  it('watches only the pinned peer verification and terminates locally when it is lost', async () => {
    jest.useFakeTimers();
    try {
      let peerVerification: 'verified' | 'unverified' | 'unknown' = 'verified';
      let unrelatedVerification: 'verified' | 'unverified' = 'verified';
      const queried: string[] = [];
      const dynamicIdentity = {
        isParticipant: async (_conversation: string, id: string) => ['alice', 'bob', 'charlie'].includes(id),
        getVerification: async (id: string) => {
          queried.push(id);
          return id === 'bob' ? peerVerification : id === 'charlie' ? unrelatedVerification : 'verified';
        },
        identityBinding,
      };
      const sendEnvelope = jest.fn(async () => ({}));
      const transport: TransportManager = { start: async () => undefined, stop: async () => undefined, join: () => undefined, sendEnvelope, activeTransport: () => undefined };
      const caller = createAuthenticatedCallComposition({ session: session(), transport, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: dynamicIdentity, deviceTrust });
      const call = await caller.invite();
      const invalid = jest.fn(async () => { await caller.terminateLocally(call.callId); });
      const stop = caller.watchVerification(invalid, 100);
      await jest.advanceTimersByTimeAsync(100);
      expect(invalid).not.toHaveBeenCalled();
      unrelatedVerification = 'unverified';
      await jest.advanceTimersByTimeAsync(100);
      expect(invalid).not.toHaveBeenCalled();
      expect(queried).not.toContain('unrelated-contact');
      expect(queried).not.toContain('charlie');
      peerVerification = 'unverified';
      await jest.advanceTimersByTimeAsync(100);
      stop();
      expect(invalid).toHaveBeenCalledTimes(1);
      expect(await caller.service.get(call.callId)).toMatchObject({ state: 'failed' });
      expect(sendEnvelope).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  it('terminates after the pinned identity changes even when the call snapshot claims the peer is verified', async () => {
    jest.useFakeTimers();
    try {
      let samePinnedIdentity = true;
      const authority = {
        isParticipant: async (_conversation: string, id: string) => id === 'alice' || (id === 'bob' && samePinnedIdentity),
        getVerification: async () => 'verified' as const,
        identityBinding,
      };
      const sendEnvelope = jest.fn(async () => ({}));
      const transport: TransportManager = { start: async () => undefined, stop: async () => undefined, join: () => undefined, sendEnvelope, activeTransport: () => undefined };
      const caller = createAuthenticatedCallComposition({ session: session(), transport, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: authority, deviceTrust });
      const call = await caller.invite();
      expect(call.participants[1].verification).toBe('verified');
      const invalid = jest.fn(async () => { await caller.terminateLocally(call.callId); });
      const stop = caller.watchVerification(invalid, 100);
      await jest.advanceTimersByTimeAsync(0);
      expect(invalid).not.toHaveBeenCalled();
      samePinnedIdentity = false;
      await jest.advanceTimersByTimeAsync(100);
      stop();
      expect(invalid).toHaveBeenCalledTimes(1);
      expect(await caller.service.get(call.callId)).toMatchObject({ state: 'failed' });
      expect(sendEnvelope).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
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
      protocolVersion: 2,
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
      protocolVersion: 2, nonce: '22222222-2222-4222-8222-222222222222', event: 'invite', kind: 'control', sequence: 3, timestamp: now,
      expiresAt: now + 60_000, identityBinding: call.identityBinding,
    };
    await alice.signalTransport.send({ ...unsigned, payloadDigest: await signalDigest(unsigned) });
    expect(await bob.service.get(call.callId)).toMatchObject({ state: 'cancelled' });
  });

  it('recognizes authenticated legacy invites as incompatible without admitting or replay-claiming them', async () => {
    const transports = connectedTransports();
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect({ receive: async () => undefined }, bob.signalTransport);
    const protocolIssue = jest.fn();
    bob.onProtocolIssue(protocolIssue);
    const now = Date.now();
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conversationId,
      sender: participant('alice', 'alice-id'), receiverIdentityId: 'bob-id', mediaMode: 'audio',
      nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', event: 'invite', kind: 'control', sequence: 1,
      timestamp: now, expiresAt: now + 60_000,
      identityBinding: await identityBinding(conversationId, [participant('alice', 'alice-id'), participant('bob', 'bob-id')]),
    };
    const legacy = { ...unsigned, payloadDigest: await legacySignalDigest(unsigned) };
    await bob.signalTransport.receivePlaintext(new TextEncoder().encode(JSON.stringify(legacy)).buffer as ArrayBuffer);
    expect(protocolIssue).toHaveBeenCalledWith({ callId: legacy.callId, receivedVersion: 1, requiredVersion: 2 });
    expect(await bob.service.get(legacy.callId)).toBeUndefined();
  });

  it('reports a future protocol with extensions as unsupported without treating it as a call', async () => {
    const transports = connectedTransports();
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    const issues = jest.fn(); bob.onProtocolIssue(issues);
    const now = Date.now();
    const futureSignal = {
      protocolVersion: 3,
      callId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      conversationId,
      sender: { ...participant('alice', 'alice-id'), futureSenderField: 'ignored-only-for-version-classification' },
      receiverIdentityId: 'bob-id', mediaMode: 'audio', nonce: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      event: 'invite', kind: 'control', sequence: 1, timestamp: now, expiresAt: now + 30_000,
      identityBinding: await identityBinding(conversationId, [participant('alice', 'alice-id'), participant('bob', 'bob-id')]),
      payloadDigest: 'future-protocol-digest', futureSignalField: { extension: true },
    };
    await bob.signalTransport.receivePlaintext(new TextEncoder().encode(JSON.stringify(futureSignal)).buffer as ArrayBuffer);
    expect(issues).toHaveBeenCalledWith({ callId: futureSignal.callId, receivedVersion: 3, requiredVersion: 2 });
    expect(await bob.service.get(futureSignal.callId)).toBeUndefined();
  });

  it('does not downgrade a current signal when its version is stripped or altered', async () => {
    const transports = connectedTransports();
    const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
    const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
    transports.connect(alice.signalTransport, bob.signalTransport);
    const issues = jest.fn(); bob.onProtocolIssue(issues);
    const binding = await identityBinding(conversationId, [participant('alice', 'alice-id'), participant('bob', 'bob-id')]);
    const now = Date.now();
    const unsigned: Omit<CallSignal, 'payloadDigest'> = {
      callId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', protocolVersion: 2, conversationId,
      sender: participant('alice', 'alice-id'), receiverIdentityId: 'bob-id', mediaMode: 'audio',
      nonce: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', event: 'invite', kind: 'control', sequence: 1,
      timestamp: now, expiresAt: now + 60_000, identityBinding: binding,
    };
    const signed = { ...unsigned, payloadDigest: await signalDigest(unsigned) };
    const stripped = { ...signed } as Record<string, unknown>; delete stripped.protocolVersion;
    await expect(bob.signalTransport.receivePlaintext(new TextEncoder().encode(JSON.stringify(stripped)).buffer as ArrayBuffer)).rejects.toThrow('integrity rejected');
    await expect(bob.signalTransport.receivePlaintext(new TextEncoder().encode(JSON.stringify({ ...signed, protocolVersion: 3 })).buffer as ArrayBuffer)).rejects.toThrow('altered');
    expect(issues).not.toHaveBeenCalled();
    expect(await bob.service.get(signed.callId)).toBeUndefined();
  });

  it('keeps established v2 calls active after the invite deadline while requiring fresh reconnect signals', async () => {
    jest.useFakeTimers();
    try {
      const transports = connectedTransports();
      const alice = createAuthenticatedCallComposition({ session: session(), transport: transports.alice, conversationId, localIdentityId: 'alice-id', localParticipantId: 'alice', remoteParticipant: participant('bob', 'bob-id'), identity: identity('alice', 'bob'), deviceTrust });
      const bob = createAuthenticatedCallComposition({ session: session(), transport: transports.bob, conversationId, localIdentityId: 'bob-id', localParticipantId: 'bob', remoteParticipant: participant('alice', 'alice-id'), identity: identity('bob', 'alice'), deviceTrust });
      transports.connect(alice.signalTransport, bob.signalTransport);
      const received = jest.fn(async (_session: CallSession, _signal: CallSignal) => undefined);
      bob.onMediaSignal(received);
      const invite = await alice.invite();
      await bob.accept(invite.callId);
      for (const composition of [alice, bob]) {
        await composition.service.event(invite.callId, 'connect');
        await composition.service.event(invite.callId, 'connected');
      }

      await jest.advanceTimersByTimeAsync(60_001);
      expect(Date.now()).toBeGreaterThan(invite.expiresAt);
      await alice.sendMediaSignal(invite.callId, 'reconnect', 'offer', { type: 'offer', sdp: 'fresh reconnect' });

      expect(received).toHaveBeenCalledWith(expect.objectContaining({ state: 'connected' }), expect.objectContaining({
        protocolVersion: 2,
        event: 'reconnect',
        expiresAt: expect.any(Number),
      }));
      const receivedSignal = received.mock.calls[0]?.[1];
      expect(receivedSignal?.expiresAt).toBeGreaterThan(Date.now());
      expect(await alice.service.get(invite.callId)).toMatchObject({ state: 'connected', protocolVersion: 2 });
      expect(await bob.service.get(invite.callId)).toMatchObject({ state: 'connected', protocolVersion: 2 });
    } finally {
      jest.useRealTimers();
    }
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
