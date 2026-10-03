import { generateKeyPairSync, sign as ed25519Sign, webcrypto } from 'crypto';
import type { SecureStorage, TransportManager, EncryptedEnvelope } from '../core/contracts';
import type { VodozemacAccountHandle } from '../identity/vodozemacIdentity';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { ModernConversation } from './modernConversation';
import { publishVodozemacBundle, fetchVodozemacBundle, claimVodozemacOneTimeKey, renewVodozemacBundle } from '../api/prekeys';
import { AuthenticatedCallSignalTransport } from '../calls/authenticatedTransport';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { fingerprintVodozemacIdentity } from '../identity/vodozemacIdentity';
import { envelopeIdForEnvelope } from '../delivery/envelopeIdentity';

jest.mock('../api/prekeys', () => ({
    publishVodozemacBundle: jest.fn(), fetchVodozemacBundle: jest.fn(), claimVodozemacOneTimeKey: jest.fn(), renewVodozemacBundle: jest.fn(),
}));
// Bootstrap is exercised against the durable authority integration suite. These
// conversation tests model its already-verified result so their fake WASM
// account does not stand in for an identity signer.
jest.mock('../devices/bootstrap', () => ({
    bootstrapFirstDevice: jest.fn(async (_signer: unknown, input: { deviceId: string; deviceIdentityReference: string }) => ({
        accountIdentityReference: 'account-test', deviceId: input.deviceId, deviceIdentityReference: input.deviceIdentityReference, trustEpoch: 0,
    })),
}));
Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'), atob: (value: string) => Buffer.from(value, 'base64').toString('binary') } });
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const localAddress = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const remoteAddress = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const key = (byte: number) => Buffer.alloc(32, byte).toString('base64url');
const rawEd25519Public = (pair: any): string => pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const localSigningPair = generateKeyPairSync('ed25519');
const remoteSigningPair = generateKeyPairSync('ed25519');
const bundle = { version: 1 as const, protocol: 'vodozemac-olm-v1' as const,
    identity: { curve25519: key(3), ed25519: rawEd25519Public(remoteSigningPair) }, oneTimeKeys: [{ id: 'otk-remote-test', key: key(5) }] };
const remoteCommitment = async (): Promise<string> => fingerprintVodozemacIdentity(bundle.identity);

class Storage implements SecureStorage {
    public failNextCompareAndSwap = false;
    async compareAndSwapRecords(updates: readonly import('../core/contracts').SecureRecordUpdate[]): Promise<boolean> {
        if (this.failNextCompareAndSwap) { this.failNextCompareAndSwap = false; return false; }
        if (updates.some((item) => { const old = this.values.get(`${item.recordType}:${item.recordId}`); return old === undefined ? item.expected !== undefined : item.expected === undefined || !Buffer.from(old).equals(Buffer.from(item.expected)); })) return false;
        for (const item of updates) this.values.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
        return true;
    }
    private readonly values = new Map<string, ArrayBuffer>();
    async initializeWithPassphrase() {}
    async unlock() {}
    lock() {}
    async changeUnlockSecret() {}
    isLocked() { return false; }
    async read(type: string, id: string) { return this.values.get(`${type}:${id}`)?.slice(0); }
    async write(type: string, id: string, value: ArrayBuffer) { this.values.set(`${type}:${id}`, value.slice(0)); }
    async delete(type: string, id: string) { this.values.delete(`${type}:${id}`); }
    async withVodozemacPickleKey<T>(fn: (key: Uint8Array) => Promise<T>) { return fn(new Uint8Array(32)); }
}

let encryptions = 0;
let outboundSessionCreations = 0;
let inboundSessionCreations = 0;
let sessionDecryptions = 0;
let decryptedBytes: Uint8Array | undefined;
const session = (): VodozemacSessionHandle => ({
    sessionId: () => 'session-test',
    encrypt: () => { encryptions++; return JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque' }); },
    decrypt: () => { sessionDecryptions++; return decryptedBytes ?? new Uint8Array([1, 1, ...new TextEncoder().encode('restored established message')]); }, saveSession: () => new Uint8Array([1, 2]),
});
const account = (): VodozemacAccountHandle => ({
    identityKeys: () => JSON.stringify({ curve25519: key(1), ed25519: rawEd25519Public(localSigningPair) }),
    signControlEvent: (payload) => ed25519Sign(null, Buffer.from(payload), localSigningPair.privateKey).toString('base64url'),
    availableOneTimeKeys: () => [key(6)], fallbackKey: () => key(7),
    generateOneTimeKeys: () => undefined, generateFallbackKey: () => undefined,
    markKeysAsPublished: () => undefined, saveAccount: () => 'encrypted-account',
    createOutboundSession: () => { outboundSessionCreations++; return session(); },
    createInboundSession: () => {
        inboundSessionCreations++;
        const plaintext = decryptedBytes ?? new Uint8Array([1, 1, ...new TextEncoder().encode('android first message')]);
        return { takeSession: () => session(), plaintext: () => plaintext };
    },
});
const loader = async () => ({ protocolVersion: 1 as const,
    accountFactory: { createAccount: account, loadAccount: account },
    sessionFactory: { loadSession: session } });

const fakeTransport = (supportsJoinIntroduction = false) => {
    const sent: EncryptedEnvelope[] = [];
    const transport = {
        start: async () => undefined, stop: async () => undefined, join: () => undefined,
        sendEnvelope: async (_channel: unknown, envelope: EncryptedEnvelope) => { sent.push(envelope); return { id: `relay-${sent.length}` }; },
        activeTransport: () => undefined as unknown as import('../core/contracts').Transport,
        peerSupportsFeature: (feature: string) => feature === 'join-introduction-v1' && supportsJoinIntroduction,
    } as unknown as TransportManager & { peerSupportsFeature: (feature: string) => boolean };
    transport.activeTransport = () => transport as unknown as import('../core/contracts').Transport;
    return { transport, sent };
};

const signedJoinIntroductionPlaintext = async (overrides: Partial<{ eventId: string; conversationId: string; senderAddress: string; identityCommitment: string }> = {}): Promise<Uint8Array> => {
    const unsigned = {
        version: 1 as const,
        type: 'join-introduction' as const,
        eventId: overrides.eventId ?? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        conversationId: overrides.conversationId ?? room,
        senderAddress: overrides.senderAddress ?? remoteAddress,
        identityCommitment: overrides.identityCommitment ?? await remoteCommitment(),
        createdAt: Date.now(),
    };
    const payloadBase = unsigned;
    const signature = ed25519Sign(null, Buffer.from(JSON.stringify(payloadBase)), remoteSigningPair.privateKey).toString('base64url');
    const body = new TextEncoder().encode(JSON.stringify({ ...payloadBase, signature }));
    const magic = new Uint8Array([0x00, 0x4b, 0x33, 0x4e, 0x43, 0x49, 0x01]);
    const result = new Uint8Array(2 + magic.length + body.length);
    result.set([1, 1]);
    result.set(magic, 2);
    result.set(body, 2 + magic.length);
    return result;
};

const seedVerifiedContact = async (storage: Storage, contactId: string): Promise<void> => {
    await storage.write('contact-identity', contactId, new TextEncoder().encode(JSON.stringify({
        contactId,
        identityId: await remoteCommitment(),
        algorithm: 'Olm-Curve25519+Ed25519',
        publicKey: Buffer.from(JSON.stringify(bundle.identity)).toString('base64url'),
        verification: 'unverified',
        changeStatus: 'unchanged',
    })).buffer as ArrayBuffer);
};

const verifiedPeerPair = async () => {
    jest.mocked(publishVodozemacBundle)
        .mockResolvedValueOnce({ address: localAddress, renewalProof: 'r'.repeat(43) })
        .mockResolvedValueOnce({ address: remoteAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);

    const aliceStorage = new Storage();
    const bobStorage = new Storage();
    const aliceTransport = fakeTransport();
    const bobTransport = fakeTransport();
    const aliceMessages: string[] = [];
    const bobMessages: string[] = [];
    const alice = new ModernConversation(aliceStorage, loader, aliceTransport.transport);
    const bob = new ModernConversation(bobStorage, loader, bobTransport.transport);
    await alice.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => { aliceMessages.push(text); return { updates: [] }; });
    await bob.connect(room, key(9), localAddress, await remoteCommitment(), (text) => { bobMessages.push(text); return { updates: [] }; });
    await seedVerifiedContact(aliceStorage, remoteAddress);
    await seedVerifiedContact(bobStorage, localAddress);
    await Promise.all([alice.verifyContact(true), bob.verifyContact(true)]);

    return { alice, bob, aliceTransport, bobTransport, aliceMessages, bobMessages };
};

const receiveFirstMessage = (conversation: ModernConversation, envelope: EncryptedEnvelope, senderAddress: string): Promise<boolean> =>
    (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive(envelope, senderAddress);

beforeEach(() => { jest.clearAllMocks(); outboundSessionCreations = 0; inboundSessionCreations = 0; sessionDecryptions = 0; decryptedBytes = undefined; });

it('registers and removes the existing relay peer-disconnect observer', () => {
    const conversation = new ModernConversation(new Storage(), loader, fakeTransport().transport);
    const observer = jest.fn();
    const unsubscribe = conversation.onPeerDisconnect(observer);
    const subscriptions = (conversation as unknown as { subscriptions: Map<string, Set<(...args: unknown[]) => void>> }).subscriptions;
    subscriptions.get('on-alice-disconnect')?.forEach((callback) => callback());
    expect(observer).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(subscriptions.has('on-alice-disconnect')).toBe(false);
});

it('rejects malformed UTF-8 without recording a replay marker', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const delivered = jest.fn();
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    await conversation.send('establish session');
    decryptedBytes = new Uint8Array([0xc3, 0x28]);
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque' }) } };
    await expect((conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive(envelope, remoteAddress)).rejects.toThrow();
    expect(delivered).not.toHaveBeenCalled();
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    await conversation.close();
});

it('does not mark a message seen until durable consumer acceptance succeeds', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    let fail = true;
    const delivered = jest.fn(async () => { if (fail) throw new Error('persistence unavailable'); return { updates: [] }; });
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    await conversation.send('establish session');
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque' }) } };
    const receive = (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive.bind(conversation);
    await expect(receive(envelope, remoteAddress)).rejects.toThrow('persistence unavailable');
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    fail = false;
    await expect(receive(envelope, remoteAddress)).resolves.toBe(true);
    expect(delivered).toHaveBeenCalledTimes(2);
    await expect(receive(envelope, remoteAddress)).resolves.toBe(true);
    expect(delivered).toHaveBeenCalledTimes(2);
    await conversation.close();
});

it('retries the identical persisted envelope after a lost ACK and after restart', async () => {
    encryptions = 0;
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const firstTransport = fakeTransport();
    const first = new ModernConversation(storage, loader, firstTransport.transport);
    await first.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(claimVodozemacOneTimeKey).not.toHaveBeenCalled();
    expect(outboundSessionCreations).toBe(0);
    await first.send('hello');
    expect(claimVodozemacOneTimeKey).toHaveBeenCalledTimes(1);
    expect(outboundSessionCreations).toBe(1);
    expect(encryptions).toBe(1);
    expect(firstTransport.sent).toHaveLength(1);
    const baseline = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(baseline + 6000);
    await first.retryPending();
    expect(firstTransport.sent).toHaveLength(2);
    expect(firstTransport.sent[1]).toEqual(firstTransport.sent[0]);
    await first.close();
    now.mockRestore();

    const secondTransport = fakeTransport();
    const second = new ModernConversation(storage, loader, secondTransport.transport);
    const later = jest.spyOn(Date, 'now').mockReturnValue(baseline + 12000);
    await second.connect(room, key(9), remoteAddress, await remoteCommitment());
    await second.retryPending();
    expect(secondTransport.sent[0]).toEqual(firstTransport.sent[0]);
    expect(encryptions).toBe(1);
    await second.close();
    later.mockRestore();
});

it('accepts the peer first-message pre-key after joining without creating a competing outbound session', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const transport = fakeTransport();
    const received: string[] = [];
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => { received.push(text); return { updates: [] }; });
    expect(outboundSessionCreations).toBe(0);
    expect(claimVodozemacOneTimeKey).not.toHaveBeenCalled();

    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque' }) },
    };
    const accepted = await (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive(envelope, remoteAddress);
    expect(accepted).toBe(true);
    expect(inboundSessionCreations).toBe(1);
    expect(sessionDecryptions).toBe(0);
    expect(received).toEqual(['android first message']);
    await conversation.close();
});

it('creates the browser outbound session only when the browser sends first', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(outboundSessionCreations).toBe(0);
    expect(claimVodozemacOneTimeKey).not.toHaveBeenCalled();
    await conversation.send('browser first message');
    expect(outboundSessionCreations).toBe(1);
    expect(claimVodozemacOneTimeKey).toHaveBeenCalledTimes(1);
    expect(transport.sent).toHaveLength(1);
    const audit = JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-audit', room))!));
    expect(audit).toMatchObject({ classification: 'active-established', direction: 'outbound', origin: 'first-message' });
    await conversation.close();
});

it('sends a signed encrypted join introduction only when the peer advertises support', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport(true);
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), undefined, undefined, undefined, { sendJoinIntroduction: true });

    expect(transport.sent).toHaveLength(1);
    expect(outboundSessionCreations).toBe(1);
    expect(claimVodozemacOneTimeKey).toHaveBeenCalledTimes(1);
    expect(await storage.read('modern-outbox', room)).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-audit', room))!)))
        .toMatchObject({ classification: 'active-established', direction: 'outbound', origin: 'join' });
    const intro = JSON.parse(new TextDecoder().decode((await storage.read('conversation-join-introduction', room))!));
    expect(intro).toMatchObject({ version: 1, recipientAddress: remoteAddress, recipientIdentityCommitment: await remoteCommitment() });
    expect(intro.envelope).toEqual(transport.sent[0]);
    await conversation.close();
});

it('keeps legacy peers on the existing first-message route when they do not advertise introductions', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const transport = fakeTransport(false);
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), undefined, undefined, undefined, { sendJoinIntroduction: true });

    expect(transport.sent).toHaveLength(0);
    expect(outboundSessionCreations).toBe(0);
    expect(claimVodozemacOneTimeKey).not.toHaveBeenCalled();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-join-introduction', room))!)))
        .toMatchObject({ version: 1, recipientAddress: remoteAddress });
    await conversation.close();
});

it('commits join-introduction route, identity and replay state only with the inbound session', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    await conversation.connect(room, key(9), undefined, undefined, async () => ({ updates: [] }));
    storage.failNextCompareAndSwap = true;
    decryptedBytes = await signedJoinIntroductionPlaintext();
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'atomic-introduction' }) } };

    await expect(receiveFirstMessage(conversation, envelope, remoteAddress)).rejects.toThrow();
    expect(await conversation.getContact()).toBeUndefined();
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    expect(await storage.read('conversation-join-introduction-seen', room)).toBeUndefined();
    expect(await storage.read('modern-seen-v1', room)).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).remoteAddress).toBeUndefined();
    await conversation.close();

    const retry = new ModernConversation(storage, loader, fakeTransport().transport);
    await retry.connect(room, key(9), undefined, undefined, async () => ({ updates: [] }));
    decryptedBytes = await signedJoinIntroductionPlaintext();
    await expect(receiveFirstMessage(retry, envelope, remoteAddress)).resolves.toBe(true);
    expect(await retry.getContact()).toMatchObject({ contactId: remoteAddress, verification: 'unverified', changeStatus: 'unchanged' });
    expect(await storage.read('conversation-join-introduction-seen', room)).toBeDefined();
    expect(await storage.read('modern-seen-v1', room)).toBeDefined();
    await retry.close();
});

it('accepts an authenticated join introduction without creating a chat message or trust state', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const onMessage = jest.fn();
    await conversation.connect(room, key(9), undefined, undefined, onMessage);
    decryptedBytes = await signedJoinIntroductionPlaintext();
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque-introduction' }) },
    };

    await expect(receiveFirstMessage(conversation, envelope, remoteAddress)).resolves.toBe(true);
    expect(onMessage).not.toHaveBeenCalled();
    expect(await conversation.getContact()).toMatchObject({ contactId: remoteAddress, verification: 'unverified', changeStatus: 'unchanged' });
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!))).toMatchObject({ remoteAddress });
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-join-introduction-seen', room))!))).toEqual({
        version: 1, eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    decryptedBytes = await signedJoinIntroductionPlaintext();
    const replayEnvelope: EncryptedEnvelope = {
        ...envelope,
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'same-event-new-envelope' }) },
    };
    await expect(receiveFirstMessage(conversation, replayEnvelope, remoteAddress)).resolves.toBe(true);
    expect(onMessage).not.toHaveBeenCalled();
    await conversation.close();
});

it('rejects a signed introduction for another conversation without learning its route', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const onMessage = jest.fn();
    await conversation.connect(room, key(9), undefined, undefined, onMessage);
    decryptedBytes = await signedJoinIntroductionPlaintext({ conversationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'wrong-conversation' }) },
    };

    await expect(receiveFirstMessage(conversation, envelope, remoteAddress)).rejects.toThrow('Join introduction binding is invalid.');
    expect(onMessage).not.toHaveBeenCalled();
    expect(await conversation.getContact()).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).remoteAddress).toBeUndefined();
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    await conversation.close();
});

it('establishes the first B-to-A message session after both contacts verify', async () => {
    const pair = await verifiedPeerPair();
    expect(outboundSessionCreations).toBe(0);
    expect(inboundSessionCreations).toBe(0);

    await pair.bob.sendWithReceipt('first message from B');
    expect(outboundSessionCreations).toBe(1);
    expect(pair.bobTransport.sent).toHaveLength(1);
    await expect(receiveFirstMessage(pair.alice, pair.bobTransport.sent[0], remoteAddress)).resolves.toBe(true);
    expect(inboundSessionCreations).toBe(1);
    expect(pair.aliceMessages).toEqual(['android first message']);
    expect(sessionDecryptions).toBe(0);

    await pair.alice.close();
    await pair.bob.close();
});

it('establishes the first A-to-B message session after both contacts verify', async () => {
    const pair = await verifiedPeerPair();
    expect(outboundSessionCreations).toBe(0);
    expect(inboundSessionCreations).toBe(0);

    await pair.alice.sendWithReceipt('first message from A');
    expect(outboundSessionCreations).toBe(1);
    expect(pair.aliceTransport.sent).toHaveLength(1);
    await expect(receiveFirstMessage(pair.bob, pair.aliceTransport.sent[0], localAddress)).resolves.toBe(true);
    expect(inboundSessionCreations).toBe(1);
    expect(pair.bobMessages).toEqual(['android first message']);
    expect(sessionDecryptions).toBe(0);

    await pair.alice.close();
    await pair.bob.close();
});

it('initializes authenticated call support after messaging established the session', async () => {
    const pair = await verifiedPeerPair();
    await expect(pair.alice.createAuthenticatedCallComposition()).rejects.toThrow('secure message before starting a call');
    expect(outboundSessionCreations).toBe(0);

    await pair.bob.sendWithReceipt('establish session for call support');
    await expect(receiveFirstMessage(pair.alice, pair.bobTransport.sent[0], remoteAddress)).resolves.toBe(true);
    const callComposition = await pair.alice.createAuthenticatedCallComposition();
    expect(callComposition.signalTransport).toBeInstanceOf(AuthenticatedCallSignalTransport);
    expect(outboundSessionCreations).toBe(1);

    await pair.alice.close();
    await pair.bob.close();
});

it('preserves an existing established conversation session and decrypts after the audit migration', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const initialTransport = fakeTransport();
    const initial = new ModernConversation(storage, loader, initialTransport.transport);
    await initial.connect(room, key(9), remoteAddress, await remoteCommitment());
    await initial.send('establish the existing session');
    await initial.acceptDelivery('relay-1');
    await initial.close();

    // Simulate a pre-migration persisted session record with durable message evidence.
    await storage.delete('conversation-session-audit', room);
    await storage.write('product-messages', room, new TextEncoder().encode(JSON.stringify([
        { id: 'sent-1', sender: 'self', text: 'previous encrypted message', type: 'sent', timestamp: '2026-09-24T00:00:00.000Z', delivery: 'accepted' },
    ])).buffer as ArrayBuffer);
    const received: string[] = [];
    const restored = new ModernConversation(storage, loader, fakeTransport().transport);
    await restored.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => { received.push(text); return { updates: [] }; });
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque' }) },
    };
    const accepted = await (restored as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive(envelope, remoteAddress);
    expect(accepted).toBe(true);
    expect(sessionDecryptions).toBe(1);
    expect(received).toEqual(['restored established message']);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-audit', room))!)))
        .toMatchObject({ classification: 'session-with-message-history' });
    await restored.close();
});

it('restores missing contact and route state after an existing session authenticates a message', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const initial = new ModernConversation(storage, loader, fakeTransport().transport);
    await initial.connect(room, key(9), remoteAddress, await remoteCommitment());
    await initial.verifyContact(true);
    await initial.send('persist an established session');
    await initial.close();

    // Model an older/raced descriptor that retained the encrypted session but
    // lost its peer route and registry entry.
    const mode = JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!));
    delete mode.remoteAddress;
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify(mode)).buffer as ArrayBuffer);
    await storage.delete('contact-identity', remoteAddress);

    const received: string[] = [];
    const onContactChange = jest.fn();
    const restored = new ModernConversation(storage, loader, fakeTransport().transport);
    await restored.connect(room, key(9), undefined, await remoteCommitment(), (text) => { received.push(text); return { updates: [] }; }, onContactChange);
    decryptedBytes = new Uint8Array([1, 1, ...new TextEncoder().encode('authenticated peer message')]);
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'authenticated' }) },
    };

    await expect(receiveFirstMessage(restored, envelope, remoteAddress)).resolves.toBe(true);
    expect(received).toEqual(['authenticated peer message']);
    expect(await restored.getContact()).toMatchObject({ contactId: remoteAddress, verification: 'unverified', changeStatus: 'unchanged' });
    expect(onContactChange).toHaveBeenLastCalledWith(expect.objectContaining({ contactId: remoteAddress, verification: 'unverified' }));
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!))).toMatchObject({ remoteAddress });

    // The normal explicit verification action is available after repair; no
    // trust state is created automatically by receiving the message.
    await restored.verifyContact(true);
    await expect(restored.sendWithReceipt('reply after explicit verification')).resolves.toBeDefined();
    await restored.close();
});

it('does not create contact state when an authenticated session sender conflicts with the saved identity commitment', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const initial = new ModernConversation(storage, loader, fakeTransport().transport);
    await initial.connect(room, key(9), remoteAddress, await remoteCommitment());
    await initial.verifyContact(true);
    await initial.send('persist an established session');
    await initial.close();

    const mode = JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!));
    delete mode.remoteAddress;
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify(mode)).buffer as ArrayBuffer);
    await storage.delete('contact-identity', remoteAddress);

    const onMessage = jest.fn();
    const onContactChange = jest.fn();
    const restored = new ModernConversation(storage, loader, fakeTransport().transport);
    await restored.connect(room, key(9), undefined, '0'.repeat(43), onMessage, onContactChange);
    decryptedBytes = new Uint8Array([1, 1, ...new TextEncoder().encode('authenticated peer message')]);
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'authenticated' }) },
    };

    await expect(receiveFirstMessage(restored, envelope, remoteAddress)).rejects.toThrow('does not match the saved invitation');
    expect(onMessage).not.toHaveBeenCalled();
    expect(onContactChange).not.toHaveBeenCalled();
    expect(await restored.getContact()).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).remoteAddress).toBeUndefined();
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    await restored.close();
});

it('does not create contact state when the restored session rejects an incoming sender message', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const initial = new ModernConversation(storage, loader, fakeTransport().transport);
    await initial.connect(room, key(9), remoteAddress, await remoteCommitment());
    await initial.verifyContact(true);
    await initial.send('persist an established session');
    await initial.close();

    const mode = JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!));
    delete mode.remoteAddress;
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify(mode)).buffer as ArrayBuffer);
    await storage.delete('contact-identity', remoteAddress);

    const onMessage = jest.fn();
    const onContactChange = jest.fn();
    const restored = new ModernConversation(storage, loader, fakeTransport().transport);
    await restored.connect(room, key(9), undefined, undefined, onMessage, onContactChange);
    // Wrong inner version/channel causes the session authentication boundary
    // to reject before identity lookup or route repair can run.
    decryptedBytes = new Uint8Array([9, 9, ...new TextEncoder().encode('untrusted')]);
    const envelope: EncryptedEnvelope = {
        version: 2,
        strategy: 'vodozemac-olm-v1',
        data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'invalid' }) },
    };

    await expect(receiveFirstMessage(restored, envelope, remoteAddress)).rejects.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onContactChange).not.toHaveBeenCalled();
    expect(await restored.getContact()).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).remoteAddress).toBeUndefined();
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    await restored.close();
});

it('keeps an unclassified legacy session when history evidence is absent', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify({
        version: 1, mode: 'modern', sessionId: 'session-test', localAddress, remoteAddress, routingProof: 'r'.repeat(43),
    })).buffer as ArrayBuffer);
    await storage.write('vodozemac-session', room, new Uint8Array([9]).buffer);
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(await storage.read('vodozemac-session', room)).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-audit', room))!)))
        .toMatchObject({ classification: 'legacy-unclassified' });
    await conversation.close();
});

it('opens an orphaned conversation read-only without deleting trust or history', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const mode = { version: 1, mode: 'modern', sessionId: 'session-test', localAddress, remoteAddress, routingProof: 'r'.repeat(43) };
    const history = [{ id: 'prior', text: 'saved locally' }];
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify(mode)).buffer as ArrayBuffer);
    await storage.write('product-messages', room, new TextEncoder().encode(JSON.stringify(history)).buffer as ArrayBuffer);
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(conversation.getSessionHealth()).toBe('unhealthy');
    expect(conversation.hasEstablishedSession()).toBe(false);
    await expect(conversation.prepareVerifiedSessionRenewal(true)).rejects.toThrow('not verified');
    await expect(conversation.send('blocked')).rejects.toThrow('verified renewal');
    await expect(conversation.createAuthenticatedCallComposition()).rejects.toThrow('verified renewal');
    expect(await storage.read('conversation-protocol', room)).toEqual(new TextEncoder().encode(JSON.stringify(mode)).buffer);
    expect(await storage.read('product-messages', room)).toEqual(new TextEncoder().encode(JSON.stringify(history)).buffer);
    expect(outboundSessionCreations).toBe(0);
    await conversation.verifyContact(true);
    await expect(conversation.prepareVerifiedSessionRenewal(false)).rejects.toThrow('explicit');
    await conversation.prepareVerifiedSessionRenewal(true);
    expect(conversation.getSessionHealth()).toBe('renewal-pending');
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).sessionId).toBeUndefined();
    expect(await storage.read('product-messages', room)).toEqual(new TextEncoder().encode(JSON.stringify(history)).buffer);
    expect(outboundSessionCreations).toBe(0);
    const receipt = await conversation.sendWithReceipt('verified renewal message');
    expect(receipt).toBeTruthy();
    expect(transport.sent).toHaveLength(1);
    expect(conversation.getSessionHealth()).toBe('renewal-pending');
    await conversation.acceptDelivery('relay-1');
    expect(conversation.getSessionHealth()).toBe('healthy');
    expect(await storage.read('product-messages', room)).toEqual(new TextEncoder().encode(JSON.stringify(history)).buffer);
    await conversation.close();
});

it('retires only a session explicitly proven unused and created outbound during join', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify({
        version: 1, mode: 'modern', sessionId: 'session-test', localAddress, remoteAddress, routingProof: 'r'.repeat(43),
    })).buffer as ArrayBuffer);
    await storage.write('vodozemac-session', room, new Uint8Array([9]).buffer);
    await storage.write('conversation-session-audit', room, new TextEncoder().encode(JSON.stringify({
        version: 1, classification: 'unused-outbound', direction: 'outbound', origin: 'join',
    })).buffer as ArrayBuffer);
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    expect(outboundSessionCreations).toBe(0);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).sessionId).toBeUndefined();
    await conversation.close();
});

it('does not retry queued envelopes after durable future-epoch suspension', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    try {
        await conversation.send('queued message');
        const state = (await conversation.getDeviceLifecycleState())!;
        await new SecureStorageDeviceLifecyclePersistence(storage).suspendTrust(state.list.identityReference, state.list.epoch + 1, 'a'.repeat(64));
        const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
        try { await conversation.retryPending(); } finally { now.mockRestore(); }
        expect(transport.sent).toHaveLength(1);
        await expect(conversation.send('must not send')).rejects.toThrow();
    } finally { await conversation.close(); }
});

it('does not republish possibly claimed one-time keys after an uncertain publication response', async () => {
    jest.mocked(publishVodozemacBundle).mockRejectedValueOnce(new Error('network disconnected'));
    const storage = new Storage();
    const first = new ModernConversation(storage, loader, fakeTransport().transport);
    await expect(first.connect(room, key(9))).rejects.toThrow('network disconnected');
    const second = new ModernConversation(storage, loader, fakeTransport().transport);
    await expect(second.connect(room, key(9))).rejects.toThrow('uncertain outcome');
    expect(publishVodozemacBundle).toHaveBeenCalledTimes(1);
});

it('blocks a restored session when its pinned contact identity changes', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const first = new ModernConversation(storage, loader, fakeTransport().transport);
    await first.connect(room, key(9), remoteAddress, await remoteCommitment());
    await first.close();

    jest.mocked(fetchVodozemacBundle).mockResolvedValue({
        ...bundle, identity: { ...bundle.identity, curve25519: key(8) },
    });
    const restored = new ModernConversation(storage, loader, fakeTransport().transport);
    await expect(restored.connect(room, key(9), remoteAddress, await remoteCommitment())).rejects.toThrow('identity changed');
});

it('keeps a fallback tab lease for the conversation lifetime and releases it on close', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const values = new Map<string, string>();
    const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
    Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'), atob: (value: string) => Buffer.from(value, 'base64').toString('binary') }, localStorage });
    try {
        const first = new ModernConversation(new Storage(), loader, fakeTransport().transport);
        await first.connect(room, key(9));
        const second = new ModernConversation(new Storage(), loader, fakeTransport().transport);
        await expect(second.connect(room, key(9))).rejects.toThrow('active in another tab');
        await first.close();
        await expect(second.connect(room, key(9))).resolves.toBeDefined();
        await second.close();
    } finally {
        Object.assign(globalThis, { window: previousWindow, localStorage: previousStorage });
    }
});

it('does not lock a shared vault when switching saved conversations', async () => {
    const storage = new Storage();
    const lock = jest.spyOn(storage, 'lock');
    const first = new ModernConversation(storage, loader, fakeTransport().transport);
    await first.close(false);
    expect(lock).not.toHaveBeenCalled();
    const second = new ModernConversation(storage, loader, fakeTransport().transport);
    await second.close();
    expect(lock).toHaveBeenCalledTimes(1);
});

it('exposes authenticated call composition only after verification and session establishment', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    await expect(conversation.createAuthenticatedCallComposition()).rejects.toThrow('Verify this contact');
    await seedVerifiedContact(storage, remoteAddress);
    await conversation.verifyContact(true);
    expect(outboundSessionCreations).toBe(0);
    await expect(conversation.createAuthenticatedCallComposition()).rejects.toThrow('secure message before starting a call');
    expect(outboundSessionCreations).toBe(0);
    await conversation.sendWithReceipt('establish session before calling');
    const composition = await conversation.createAuthenticatedCallComposition();
    expect(composition.signalTransport).toBeInstanceOf(AuthenticatedCallSignalTransport);
    expect(composition.service).toBeDefined();
    expect(outboundSessionCreations).toBe(1);
    const call = await composition.invite();
    expect(call.state).toBe('inviting');
    await conversation.close();
});

it('rejects a server-substituted first-contact bundle that does not match the invitation identity commitment', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue({ ...bundle, identity: { curve25519: key(8), ed25519: key(9) } });
    const conversation = new ModernConversation(new Storage(), loader, fakeTransport().transport);
    await expect(conversation.connect(room, key(9), remoteAddress, await remoteCommitment())).rejects.toThrow('identity commitment');
    await conversation.close();
});

// Stage 0: these fakes exercise orchestration, not native cryptographic proof.
// Real WASM/IndexedDB crash probes live in e2e/stage0-boundaries.spec.ts.
describe('Stage 0 identity authorization and delivery boundaries', () => {
    const envelope = (label: string): EncryptedEnvelope => ({ version: 2, strategy: 'vodozemac-olm-v1', data: {
        version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: label }),
    } });
    const setup = async () => {
        jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
        jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
        jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
        const storage = new Storage();
        const transport = fakeTransport();
        const received = jest.fn(async () => ({ updates: [] }));
        const conversation = new ModernConversation(storage, loader, transport.transport);
        await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), received);
        await conversation.send('synthetic stage0 setup');
        return { storage, transport, received, conversation };
    };

    it.each(['missing-commitment', 'wrong-descriptor', 'changed-key'])('%s cannot attach identity after successful decrypt', async (scenario) => {
        const { storage, conversation } = await setup();
        await conversation.close();
        const mode = JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!));
        delete mode.remoteAddress;
        await storage.write('conversation-protocol', room, new TextEncoder().encode(JSON.stringify(mode)).buffer as ArrayBuffer);
        await storage.delete('contact-identity', remoteAddress);
        const observed = jest.fn();
        const received = jest.fn(async () => ({ updates: [] }));
        const restored = new ModernConversation(storage, loader, fakeTransport().transport);
        await restored.connect(room, key(9), undefined, scenario === 'missing-commitment' ? undefined : await remoteCommitment(), received, observed);
        const wrong = { ...bundle, identity: scenario === 'changed-key' ? { ...bundle.identity, ed25519: key(22) } : { ...bundle.identity, curve25519: key(22) } };
        if (scenario !== 'missing-commitment') jest.mocked(fetchVodozemacBundle).mockResolvedValue(wrong);
        const before = sessionDecryptions;
        await expect(receiveFirstMessage(restored, envelope(scenario), remoteAddress)).rejects.toThrow('does not match the saved invitation');
        expect(sessionDecryptions).toBe(before + 1); // decrypt success is NOT descriptor authorization
        expect(await storage.read('contact-identity', remoteAddress)).toBeUndefined();
        expect(await storage.read('modern-seen', room)).toBeUndefined();
        expect(observed).not.toHaveBeenCalled();
        expect(received).not.toHaveBeenCalled();
        await restored.close();
    });

    it('identity replacement while bundle lookup is pending cannot be accepted', async () => {
        const { storage, conversation } = await setup();
        await storage.delete('contact-identity', remoteAddress);
        let release!: (value: typeof bundle) => void;
        let entered!: () => void;
        const lookingUp = new Promise<void>((resolve) => { entered = resolve; });
        jest.mocked(fetchVodozemacBundle).mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
        const pending = receiveFirstMessage(conversation, envelope('identity-race'), remoteAddress);
        const rejected = expect(pending).rejects.toThrow('does not match the saved invitation');
        await lookingUp;
        (conversation as unknown as { remoteIdentityCommitment: string }).remoteIdentityCommitment = key(23);
        release(bundle);
        await rejected;
        expect(await storage.read('contact-identity', remoteAddress)).toBeUndefined();
        expect(await storage.read('modern-seen', room)).toBeUndefined();
        await conversation.close();
    });

    it('simultaneous outgoing messages are serialized by one conversation owner', async () => {
        const { conversation, storage } = await setup();
        await conversation.acceptDelivery('relay-1');
        const before = encryptions;
        await Promise.all([conversation.send('synthetic one'), conversation.send('synthetic two')]);
        expect(encryptions).toBe(before + 2);
        const records = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
        expect(records).toHaveLength(2);
        expect(new Set(records.map((record: { clientId: string }) => record.clientId)).size).toBe(2);
        await conversation.close();
    });

    it('delayed old relay ID cannot complete a retried envelope after ID replacement (known gap)', async () => {
        const { conversation, storage } = await setup();
        const pending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
        pending[0].sentAt = 0;
        await storage.write('modern-outbox', room, new TextEncoder().encode(JSON.stringify(pending)).buffer as ArrayBuffer);
        await conversation.retryPending();
        await conversation.acceptDelivery('relay-1');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toHaveLength(1);
        await conversation.acceptDelivery('relay-2');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
        await conversation.close();
    });

    it.each(['dddddddd-dddd-4ddd-8ddd-dddddddddddd', localAddress])('changed/stale route %s is rejected before decrypt', async (route) => {
        const { conversation, received } = await setup();
        const before = sessionDecryptions;
        expect(await receiveFirstMessage(conversation, envelope('wrong-route'), route)).toBe(false);
        expect(sessionDecryptions).toBe(before);
        expect(received).not.toHaveBeenCalled();
        await conversation.close();
    });

    it('deduplicates the same envelope from two logical paths despite JSON key ordering changes', async () => {
        const { conversation, received, storage } = await setup();
        const canonical = envelope('multi-path-duplicate');
        const reordered = { data: canonical.data, strategy: canonical.strategy, version: canonical.version } as EncryptedEnvelope;
        expect(JSON.stringify(canonical)).not.toBe(JSON.stringify(reordered));
        const before = sessionDecryptions;
        expect(await receiveFirstMessage(conversation, canonical, remoteAddress)).toBe(true);
        expect(await receiveFirstMessage(conversation, reordered, remoteAddress)).toBe(true);
        expect(sessionDecryptions).toBe(before + 1);
        expect(received).toHaveBeenCalledTimes(1);
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-seen-v1', room))!)).ids).toHaveLength(1);
        await conversation.close();
    });

    it('accepted duplicate does not decrypt, observe, or deliver twice and never verifies', async () => {
        const { conversation, received } = await setup();
        const wire = envelope('duplicate');
        const before = sessionDecryptions;
        expect(await receiveFirstMessage(conversation, wire, remoteAddress)).toBe(true);
        expect(await receiveFirstMessage(conversation, wire, remoteAddress)).toBe(true);
        expect(sessionDecryptions).toBe(before + 1);
        expect(received).toHaveBeenCalledTimes(1);
        expect((await conversation.getContact())?.verification).toBe('unverified');
        await conversation.close();
    });

    it('atomic outbox persistence failure leaves the ratchet unchanged and retryable', async () => {
        const { conversation, storage } = await setup();
        await conversation.acceptDelivery('relay-1');
        const beforeSession = await storage.read('vodozemac-session', room);
        const compareAndSwap = storage.compareAndSwapRecords.bind(storage);
        jest.spyOn(storage, 'compareAndSwapRecords').mockImplementation(async (updates) => {
            if (updates.some((item) => item.recordType === 'modern-outbox')) return false;
            return compareAndSwap(updates);
        });
        const before = encryptions;
        await expect(conversation.send('synthetic recoverable work')).rejects.toThrow('safely persisted');
        expect(encryptions).toBe(before + 1);
        expect(Buffer.from(await storage.read('vodozemac-session', room)!).equals(Buffer.from(beforeSession!))).toBe(true);
        expect(await storage.read('vodozemac-commit', 'local')).toBeUndefined();
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
        jest.restoreAllMocks();
        await expect(conversation.send('retry after atomic abort')).resolves.toBe('pending');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toHaveLength(1);
        await conversation.close();
    });

    it('commits caller-owned sender history with the session and exact outbox envelope', async () => {
        const { conversation, storage } = await setup();
        await conversation.acceptDelivery('relay-1');
        await conversation.sendWithReceipt('recoverable plaintext', (clientId) => [{
            recordType: 'product-messages', recordId: room, expected: undefined,
            next: new TextEncoder().encode(JSON.stringify([{ id: clientId, sender: localAddress, text: 'recoverable plaintext', type: 'sent', timestamp: '2026-01-01T00:00:00.000Z', delivery: 'pending' }])).buffer as ArrayBuffer,
        }]);
        const history = JSON.parse(new TextDecoder().decode((await storage.read('product-messages', room))!));
        const outbox = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ sender: localAddress, text: 'recoverable plaintext', type: 'sent', delivery: 'pending' });
        expect(outbox).toHaveLength(1);
        expect(outbox[0].clientId).toBe(history[0].id);
        expect(outbox[0].envelope).toBeDefined();
        await conversation.close();
    });

    it('commits the accepted history state with the corresponding outbox removal', async () => {
        const { conversation, storage } = await setup();
        await conversation.acceptDelivery('relay-1');
        await conversation.sendWithReceipt('history is recoverable', (clientId) => [{
            recordType: 'product-messages', recordId: room, expected: undefined,
            next: new TextEncoder().encode(JSON.stringify([{ id: clientId, sender: localAddress, text: 'history is recoverable', type: 'sent', timestamp: '2026-01-01T00:00:00.000Z', delivery: 'pending' }])).buffer as ArrayBuffer,
        }]);
        conversation.onDeliveryUpdate(() => undefined, async (clientId) => {
            const expected = await storage.read('product-messages', room);
            const history = JSON.parse(new TextDecoder().decode(expected!));
            const next = history.map((message: { id: string }) => message.id === clientId ? { ...message, delivery: 'accepted' } : message);
            return { recordType: 'product-messages', recordId: room, expected, next: new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer };
        });
        const compareAndSwap = storage.compareAndSwapRecords.bind(storage);
        const updatesSeen: string[][] = [];
        jest.spyOn(storage, 'compareAndSwapRecords').mockImplementation(async (updates) => {
            updatesSeen.push(updates.map((update) => update.recordType));
            return compareAndSwap(updates);
        });
        await conversation.acceptDelivery('relay-2');
        expect(updatesSeen[updatesSeen.length - 1]?.sort()).toEqual(['modern-outbox', 'product-messages']);
        expect(JSON.parse(new TextDecoder().decode((await storage.read('product-messages', room))!))[0].delivery).toBe('accepted');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
        jest.restoreAllMocks();
        await conversation.close();
    });

    it('sender-history CAS failure aborts session and outbox acceptance together', async () => {
        const { conversation, storage } = await setup();
        await conversation.acceptDelivery('relay-1');
        const beforeSession = await storage.read('vodozemac-session', room);
        const compareAndSwap = storage.compareAndSwapRecords.bind(storage);
        jest.spyOn(storage, 'compareAndSwapRecords').mockImplementation(async (updates) => {
            if (updates.some((update) => update.recordType === 'product-messages')) return false;
            return compareAndSwap(updates);
        });
        await expect(conversation.sendWithReceipt('must be recoverable', (clientId) => [{
            recordType: 'product-messages', recordId: room, expected: undefined,
            next: new TextEncoder().encode(JSON.stringify([{ id: clientId, sender: localAddress, text: 'must be recoverable', type: 'sent', timestamp: '2026-01-01T00:00:00.000Z', delivery: 'pending' }])).buffer as ArrayBuffer,
        }])).rejects.toThrow('safely persisted');
        expect(Buffer.from(await storage.read('vodozemac-session', room)!).equals(Buffer.from(beforeSession!))).toBe(true);
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
        expect(await storage.read('product-messages', room)).toBeUndefined();
        jest.restoreAllMocks();
        await conversation.close();
    });

    it('relay submission is not completion; restart retries unchanged envelope without encrypting', async () => {
        const { conversation, storage, transport } = await setup();
        const wire = JSON.stringify(transport.sent[0]);
        const pending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
        expect(pending).toHaveLength(1);
        expect(pending[0].envelopeId).toBe(await envelopeIdForEnvelope(room, pending[0].envelope));
        await conversation.close();
        pending[0].sentAt = 0;
        delete pending[0].envelopeId; // legacy outbox records remain readable during M1 adoption.
        await storage.write('modern-outbox', room, new TextEncoder().encode(JSON.stringify(pending)).buffer as ArrayBuffer);
        const retry = fakeTransport();
        const before = encryptions;
        const restored = new ModernConversation(storage, loader, retry.transport);
        await restored.connect(room, key(9), remoteAddress, await remoteCommitment());
        await restored.retryPending();
        expect(encryptions).toBe(before);
        expect(retry.sent.map((item) => JSON.stringify(item))).toContain(wire);
        const upgradedPending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
        expect(upgradedPending[0].envelopeId).toBe(await envelopeIdForEnvelope(room, upgradedPending[0].envelope));
        await restored.acceptDelivery('unknown-relay-id');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toHaveLength(1);
        await restored.acceptDelivery('relay-1');
        await restored.acceptDelivery('relay-1');
        expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
        expect((await restored.getContact())?.verification).toBe('unverified');
        await restored.close();
    });
});

describe('Stage 0 tab lease boundaries', () => {
    type LeaseProbe = {
        tabOwnerId: string; fallbackLeaseKey?: string;
        withTabLock<T>(id: string, operation: () => Promise<T>): Promise<T>;
        refreshFallbackLease(storage: globalThis.Storage, key: string): void;
    };
    const leaseKey = `k3ncrypt-tab-lease:${room}`;
    let storage: globalThis.Storage;
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    beforeEach(() => {
        const records = new Map<string, string>();
        storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } } as globalThis.Storage;
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    });
    afterEach(() => {
        if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
        if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    });
    const owner = () => new ModernConversation(new Storage(), loader, fakeTransport().transport) as unknown as LeaseProbe;

    it('second owner is rejected while first lease is live', async () => {
        const a = owner(); const b = owner(); const effect = jest.fn(async () => undefined);
        await a.withTabLock(room, async () => undefined);
        await expect(b.withTabLock(room, effect)).rejects.toThrow('another tab');
        expect(effect).not.toHaveBeenCalled();
    });
    it('resumed stale heartbeat cannot reclaim a newer owner lease', async () => {
        const a = owner(); const b = owner();
        await a.withTabLock(room, async () => undefined);
        storage.setItem(leaseKey, `${a.tabOwnerId}:0`);
        await b.withTabLock(room, async () => undefined);
        const current = storage.getItem(leaseKey);
        a.refreshFallbackLease(storage, leaseKey);
        expect(storage.getItem(leaseKey)).toBe(current);
    });
    it('queued operation rechecks owner after acquiring Web Lock', async () => {
        const a = owner(); const effect = jest.fn(async () => undefined);
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, callback: () => Promise<unknown>) => {
            storage.setItem(leaseKey, `new-owner:${Date.now() + 30000}`);
            return callback();
        } } } });
        await expect(a.withTabLock(room, effect)).rejects.toThrow('another tab');
        expect(effect).not.toHaveBeenCalled();
    });
    it('documents that an already-running callback is not fenced by lease takeover', async () => {
        const a = owner(); const b = owner(); const effects: string[] = [];
        let release!: () => void;
        const paused = new Promise<void>((resolve) => { release = resolve; });
        const first = a.withTabLock(room, async () => { await paused; effects.push('stale'); });
        storage.setItem(leaseKey, `${a.tabOwnerId}:0`);
        await b.withTabLock(room, async () => { effects.push('new'); });
        release(); await first;
        expect(effects).toEqual(['new', 'stale']); // known gap; not a fencing guarantee
        expect(storage.getItem(leaseKey)?.startsWith(`${b.tabOwnerId}:`)).toBe(true);
    });
});
