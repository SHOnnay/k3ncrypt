import { generateKeyPairSync, sign as ed25519Sign, webcrypto } from 'crypto';
import type { SecureStorage, TransportManager, EncryptedEnvelope } from '../core/contracts';
import type { VodozemacAccountHandle } from '../identity/vodozemacIdentity';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { ModernConversation } from './modernConversation';
import { publishVodozemacBundle, fetchVodozemacBundle, claimVodozemacOneTimeKey, renewVodozemacBundle } from '../api/prekeys';
import { AuthenticatedCallSignalTransport } from '../calls/authenticatedTransport';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { fingerprintVodozemacIdentity } from '../identity/vodozemacIdentity';

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
    async compareAndSwapRecords(updates: readonly import('../core/contracts').SecureRecordUpdate[]): Promise<boolean> {
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
    await alice.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => aliceMessages.push(text));
    await bob.connect(room, key(9), localAddress, await remoteCommitment(), (text) => bobMessages.push(text));
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

it('commits message and replay state before the consumer callback and retries projection idempotently', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    let fail = true;
    const delivered = jest.fn(async () => { if (fail) throw new Error('persistence unavailable'); });
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    await conversation.send('establish session');
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque' }) } };
    const receive = (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive.bind(conversation);
    await expect(receive(envelope, remoteAddress)).rejects.toThrow('persistence unavailable');
    const seenBytes = await storage.read('modern-seen', room);
    expect(seenBytes).toBeDefined();
    const seen = JSON.parse(new TextDecoder().decode(seenBytes!)) as string[];
    expect(seen).toHaveLength(1);
    const accepted = await storage.read('modern-accepted-message', `${room}:${seen[0]}`);
    expect(JSON.parse(new TextDecoder().decode(accepted!))).toEqual({ version: 1, text: 'restored established message' });
    fail = false;
    await expect(receive(envelope, remoteAddress)).resolves.toBe(true);
    expect(delivered).toHaveBeenCalledTimes(2);
    expect(await storage.read('modern-accepted-message', `${room}:${seen[0]}`)).toBeUndefined();
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
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => received.push(text));
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
    await restored.connect(room, key(9), remoteAddress, await remoteCommitment(), (text) => received.push(text));
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
    await restored.connect(room, key(9), undefined, undefined, (text) => received.push(text), onContactChange);
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
