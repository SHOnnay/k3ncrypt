import { generateKeyPairSync, sign as ed25519Sign, webcrypto } from 'crypto';
import type { SecureStorage, TransportManager, EncryptedEnvelope } from '../core/contracts';
import type { VodozemacAccountHandle } from '../identity/vodozemacIdentity';
import type { VodozemacSessionHandle } from '../core/vodozemacCryptoSession';
import { ModernConversation } from './modernConversation';
import { publishVodozemacBundle, fetchVodozemacBundle, claimVodozemacOneTimeKey, renewVodozemacBundle } from '../api/prekeys';
import { AuthenticatedCallSignalTransport } from '../calls/authenticatedTransport';
import { SecureStorageDeviceLifecyclePersistence } from '../devices/runtime';
import { fingerprintVodozemacIdentity } from '../identity/vodozemacIdentity';
import { decodeRoomMessage, encodeRoomMessageV1, ROOM_MESSAGE_V1_FEATURE } from './roomMessageV1';

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
        const fail = this.failNextCas;
        this.failNextCas = undefined;
        if (fail === 'before') throw new Error('simulated transaction abort');
        for (const item of updates) this.values.set(`${item.recordType}:${item.recordId}`, item.next.slice(0));
        if (fail === 'after') throw new Error('simulated uncertain transaction completion');
        return true;
    }
    private readonly values = new Map<string, ArrayBuffer>();
    failNextCas?: 'before' | 'after';
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
let encryptedPlaintexts: Uint8Array[] = [];
const session = (): VodozemacSessionHandle => ({
    sessionId: () => 'session-test',
    encrypt: (plaintext) => { encryptions++; encryptedPlaintexts.push(plaintext.slice()); return JSON.stringify({ version: 1, message_type: 0, ciphertext: `opaque-${encryptions}` }); },
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

const fakeTransport = (supportsJoinIntroduction = false, failSends = 0, supportsRoomMessage = false, requiresRoomMessageV1 = false) => {
    const sent: EncryptedEnvelope[] = [];
    const transport = {
        start: async () => undefined, stop: async () => undefined, join: () => undefined,
        sendEnvelope: async (_channel: unknown, envelope: EncryptedEnvelope) => {
            if (failSends > 0) { failSends -= 1; throw new Error('simulated relay interruption'); }
            sent.push(envelope); return { id: `relay-${sent.length}` };
        },
        activeTransport: () => undefined as unknown as import('../core/contracts').Transport,
        requiresRoomMessageV1,
        peerSupportsFeature: (feature: string) => (feature === 'join-introduction-v1' && supportsJoinIntroduction) ||
            (feature === ROOM_MESSAGE_V1_FEATURE && supportsRoomMessage),
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

const messageAcceptance = (storage: Storage, received?: string[]) => async (text: string, id: string) => {
    const expected = await storage.read('product-messages', room);
    const current = expected ? JSON.parse(new TextDecoder().decode(expected)) as Array<Record<string, unknown>> : [];
    const existing = current.find((message) => message.id === id);
    if (existing && existing.text !== text) throw new Error('Accepted message identity conflicts with saved history.');
    const next = existing ? current : [...current, {
        id, sender: 'contact', text, type: 'received', timestamp: '2026-01-01T00:00:00.000Z',
    }];
    return {
        updates: [{
            recordType: 'product-messages', recordId: room, expected,
            next: new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer,
        }],
        afterCommit: async () => { received?.push(text); },
    };
};

const sentHistoryUpdate = (storage: Storage, text: string) => async (id: string) => {
    const expected = await storage.read('product-messages', room);
    const current = expected ? JSON.parse(new TextDecoder().decode(expected)) as Array<Record<string, unknown>> : [];
    const next = [...current, { id, sender: 'self', text, type: 'sent', timestamp: '2026-01-01T00:00:00.000Z', delivery: 'pending' }];
    return { recordType: 'product-messages', recordId: room, expected,
        next: new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer };
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
    await alice.connect(room, key(9), remoteAddress, await remoteCommitment(), messageAcceptance(aliceStorage, aliceMessages));
    await bob.connect(room, key(9), localAddress, await remoteCommitment(), messageAcceptance(bobStorage, bobMessages));
    await seedVerifiedContact(aliceStorage, remoteAddress);
    await seedVerifiedContact(bobStorage, localAddress);
    await Promise.all([alice.verifyContact(true), bob.verifyContact(true)]);

    return { alice, bob, aliceStorage, bobStorage, aliceTransport, bobTransport, aliceMessages, bobMessages };
};

it('keeps a ModernConversation and its transport permanently bound to the first room', async () => {
    const pair = await verifiedPeerPair();
    try {
        await expect(pair.alice.connect('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', key(9))).rejects.toThrow('cannot change its bound room');
    } finally {
        await Promise.all([pair.alice.close(false), pair.bob.close(false)]);
    }
});

const receiveFirstMessage = (conversation: ModernConversation, envelope: EncryptedEnvelope, senderAddress: string): Promise<boolean> =>
    (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive(envelope, senderAddress);

beforeEach(() => { jest.clearAllMocks(); encryptions = 0; outboundSessionCreations = 0; inboundSessionCreations = 0; sessionDecryptions = 0; decryptedBytes = undefined; encryptedPlaintexts = []; });

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
    const delivered = jest.fn(messageAcceptance(storage));
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
    const persistMessage = messageAcceptance(storage);
    const delivered = jest.fn(async (text: string, id: string) => {
        if (fail) throw new Error('persistence unavailable');
        return persistMessage(text, id);
    });
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    await conversation.send('establish session');
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque' }) } };
    const receive = (conversation as unknown as { receive: (value: EncryptedEnvelope, sender: string) => Promise<boolean> }).receive.bind(conversation);
    await expect(receive(envelope, remoteAddress)).rejects.toThrow('persistence unavailable');
    expect(await storage.read('modern-seen', room)).toBeUndefined();
    expect(await storage.read('modern-seen-m1-v1', room)).toBeUndefined();
    expect(await storage.read('product-messages', room)).toBeUndefined();
    fail = false;
    await expect(receive(envelope, remoteAddress)).resolves.toBe(true);
    expect(delivered).toHaveBeenCalledTimes(2);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-seen', room))!))).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-seen-m1-v1', room))!)).ids).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('product-messages', room))!))).toHaveLength(1);
    await expect(receive(envelope, remoteAddress)).resolves.toBe(true);
    expect(delivered).toHaveBeenCalledTimes(2);
    await conversation.close();
});

it('recovers an aborted established-session acceptance after restart and redelivery', async () => {
    const pair = await verifiedPeerPair();
    await pair.alice.sendWithReceipt('establish the receive session');
    await receiveFirstMessage(pair.bob, pair.aliceTransport.sent[0], localAddress);
    await pair.alice.sendWithReceipt('recover this message');
    const envelope = pair.aliceTransport.sent[1];
    const beforeSession = await pair.bobStorage.read('vodozemac-session', room);
    const beforeLegacy = await pair.bobStorage.read('modern-seen', room);
    const beforeM1 = await pair.bobStorage.read('modern-seen-m1-v1', room);
    const beforeMessages = await pair.bobStorage.read('product-messages', room);
    decryptedBytes = new Uint8Array([1, 1, ...new TextEncoder().encode('recover this message')]);
    pair.bobStorage.failNextCas = 'before';

    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).rejects.toThrow();
    expect(await pair.bobStorage.read('vodozemac-session', room)).toEqual(beforeSession);
    expect(await pair.bobStorage.read('modern-seen', room)).toEqual(beforeLegacy);
    expect(await pair.bobStorage.read('modern-seen-m1-v1', room)).toEqual(beforeM1);
    expect(await pair.bobStorage.read('product-messages', room)).toEqual(beforeMessages);
    const decryptionsAfterAbort = sessionDecryptions;
    expect(decryptionsAfterAbort).toBeGreaterThan(0);

    await pair.bob.close();
    const restarted = new ModernConversation(pair.bobStorage, loader, fakeTransport().transport);
    await restarted.connect(room, key(9), localAddress, await remoteCommitment(), messageAcceptance(pair.bobStorage, pair.bobMessages));
    decryptedBytes = new Uint8Array([1, 1, ...new TextEncoder().encode('recover this message')]);
    await expect(receiveFirstMessage(restarted, envelope, localAddress)).resolves.toBe(true);
    expect(sessionDecryptions).toBe(decryptionsAfterAbort + 1);
    expect(pair.bobMessages).toEqual(['android first message', 'recover this message']);
    const afterAcceptance = sessionDecryptions;
    await expect(receiveFirstMessage(restarted, envelope, localAddress)).resolves.toBe(true);
    expect(sessionDecryptions).toBe(afterAcceptance);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('modern-seen-m1-v1', room))!)).ids).toHaveLength(2);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('product-messages', room))!))).toHaveLength(2);

    await restarted.close();
    await pair.alice.close();
});

it('resolves an uncertain completed transaction from durable state without accepting twice', async () => {
    const pair = await verifiedPeerPair();
    await pair.alice.sendWithReceipt('establish the receive session');
    await receiveFirstMessage(pair.bob, pair.aliceTransport.sent[0], localAddress);
    await pair.alice.sendWithReceipt('commit despite lost completion signal');
    const envelope = pair.aliceTransport.sent[1];
    decryptedBytes = new Uint8Array([1, 1, ...new TextEncoder().encode('commit despite lost completion signal')]);
    pair.bobStorage.failNextCas = 'after';

    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).resolves.toBe(true);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('modern-seen-m1-v1', room))!)).ids).toHaveLength(2);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('product-messages', room))!))).toHaveLength(2);
    const afterCommit = sessionDecryptions;
    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).resolves.toBe(true);
    expect(sessionDecryptions).toBe(afterCommit);

    await pair.bob.close();
    await pair.alice.close();
});

it('recognizes a previously accepted exact envelope before a second decrypt', async () => {
    const pair = await verifiedPeerPair();
    await pair.alice.sendWithReceipt('single receiver delivery');
    const envelope = pair.aliceTransport.sent[0];

    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).resolves.toBe(true);
    expect(pair.bobMessages).toEqual(['android first message']);
    const m1 = JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('modern-seen-m1-v1', room))!)).ids[0];
    expect(m1).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('modern-seen', room))!))).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('product-messages', room))!))[0].id).toBe(m1);
    const inboundSessions = inboundSessionCreations;
    const decryptions = sessionDecryptions;

    const reordered = {
        data: { olmMessage: (envelope.data as { olmMessage: string }).olmMessage, version: 1 },
        strategy: 'vodozemac-olm-v1',
        version: 2,
    } as EncryptedEnvelope;
    await expect(receiveFirstMessage(pair.bob, reordered, localAddress)).resolves.toBe(true);
    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).resolves.toBe(true);
    expect(inboundSessionCreations).toBe(inboundSessions);
    expect(sessionDecryptions).toBe(decryptions);
    expect(pair.bobMessages).toEqual(['android first message']);

    await pair.alice.close();
    await pair.bob.close();

    const restarted = new ModernConversation(pair.bobStorage, loader, fakeTransport().transport);
    await restarted.connect(room, key(9), localAddress, await remoteCommitment(), messageAcceptance(pair.bobStorage, pair.bobMessages));
    await expect(receiveFirstMessage(restarted, reordered, localAddress)).resolves.toBe(true);
    expect(sessionDecryptions).toBe(decryptions);
    expect(pair.bobMessages).toEqual(['android first message']);
    await restarted.close();
});

it('suppresses a legacy-only replay marker before decrypt without fabricating M1 history', async () => {
    const pair = await verifiedPeerPair();
    await pair.alice.sendWithReceipt('legacy replay');
    const envelope = pair.aliceTransport.sent[0];
    const digestBytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(envelope))));
    const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await pair.bobStorage.write('modern-seen', room, new TextEncoder().encode(JSON.stringify([digest])).buffer as ArrayBuffer);
    const decryptions = sessionDecryptions;

    await expect(receiveFirstMessage(pair.bob, envelope, localAddress)).resolves.toBe(true);
    expect(sessionDecryptions).toBe(decryptions);
    expect(pair.bobMessages).toEqual([]);
    expect(await pair.bobStorage.read('modern-seen-m1-v1', room)).toBeUndefined();
    expect(await pair.bobStorage.read('product-messages', room)).toBeUndefined();

    await pair.bob.close();
    await pair.alice.close();
});

it('serializes concurrent live and mailbox copies through one pre-decrypt M1 check', async () => {
    const pair = await verifiedPeerPair();
    await pair.alice.sendWithReceipt('overlapping relay delivery');
    const envelope = pair.aliceTransport.sent[0];
    const before = sessionDecryptions;

    const results = await Promise.all([
        receiveFirstMessage(pair.bob, envelope, localAddress),
        receiveFirstMessage(pair.bob, { ...envelope }, localAddress),
    ]);
    expect(results).toEqual([true, true]);
    expect(inboundSessionCreations).toBe(1);
    expect(sessionDecryptions).toBe(before);
    expect(pair.bobMessages).toEqual(['android first message']);
    expect(JSON.parse(new TextDecoder().decode((await pair.bobStorage.read('product-messages', room))!))).toHaveLength(1);

    await pair.bob.close();
    await pair.alice.close();
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

it('commits the first-send account, ratchet, outbox, history, and local origin before relay submission', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    const compareAndSwap = jest.spyOn(storage, 'compareAndSwapRecords');

    const clientId = await conversation.sendWithReceipt('atomic first send', sentHistoryUpdate(storage, 'atomic first send'));
    const senderCommit = compareAndSwap.mock.calls.find(([updates]) =>
        ['vodozemac-account', 'vodozemac-session', 'modern-outbox', 'product-messages', 'conversation-protocol', 'conversation-session-audit']
            .every((type) => updates.some((item) => item.recordType === type)));
    expect(senderCommit).toBeDefined();
    expect(transport.sent).toHaveLength(1);
    expect(Object.keys(transport.sent[0]).sort()).toEqual(['data', 'strategy', 'version']);
    const pending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ clientId, envelope: transport.sent[0], senderOrigin: { version: 1, basis: 'durable-commit' } });
    const history = JSON.parse(new TextDecoder().decode((await storage.read('product-messages', room))!));
    expect(history).toContainEqual(expect.objectContaining({ id: clientId, text: 'atomic first send', type: 'sent', delivery: 'pending' }));
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!))).toHaveProperty('sessionId');
    await conversation.close();
});

it('rolls back in-memory first-send advancement when the sender transaction aborts and submits nothing', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    storage.failNextCas = 'before';

    await expect(conversation.sendWithReceipt('abort this send', sentHistoryUpdate(storage, 'abort this send'))).rejects.toThrow();
    expect(transport.sent).toHaveLength(0);
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    expect(await storage.read('modern-outbox', room)).toBeUndefined();
    expect(await storage.read('product-messages', room)).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).sessionId).toBeUndefined();
    expect(encryptions).toBe(1);

    await expect(conversation.sendWithReceipt('new explicit send')).resolves.toBeTruthy();
    expect(transport.sent).toHaveLength(1);
    expect(encryptions).toBe(2);
    await conversation.close();
});

it('keeps an established ratchet and sender history unchanged when its outbound commit aborts', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    await conversation.sendWithReceipt('seed established session');
    await conversation.acceptDelivery('relay-1');
    const beforeSession = await storage.read('vodozemac-session', room);
    const beforeHistory = await storage.read('product-messages', room);
    const beforeEncryptionCount = encryptions;
    const beforeSubmissionCount = transport.sent.length;
    storage.failNextCas = 'before';

    await expect(conversation.sendWithReceipt('must remain uncommitted', sentHistoryUpdate(storage, 'must remain uncommitted'))).rejects.toThrow();
    expect(await storage.read('vodozemac-session', room)).toEqual(beforeSession);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))).toEqual([]);
    expect(await storage.read('product-messages', room)).toEqual(beforeHistory);
    expect(transport.sent).toHaveLength(beforeSubmissionCount);
    expect(encryptions).toBe(beforeEncryptionCount + 1);
    await conversation.close();
});

it('restores the old first-send account and session if sender history preparation fails', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());

    await expect(conversation.sendWithReceipt('history preparation fault', async () => { throw new Error('history persistence unavailable'); })).rejects.toThrow();
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    expect(await storage.read('modern-outbox', room)).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-protocol', room))!)).sessionId).toBeUndefined();
    expect(transport.sent).toHaveLength(0);
    expect(encryptions).toBe(1);
    await conversation.close();
});

it('recovers an uncertain completed sender transaction without re-encrypting', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    storage.failNextCas = 'after';

    const clientId = await conversation.sendWithReceipt('commit then lose completion', sentHistoryUpdate(storage, 'commit then lose completion'));
    expect(encryptions).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))[0])
        .toMatchObject({ clientId, envelope: transport.sent[0], senderOrigin: { version: 1, basis: 'durable-commit' } });
    expect(JSON.parse(new TextDecoder().decode((await storage.read('product-messages', room))!)))
        .toContainEqual(expect.objectContaining({ id: clientId, text: 'commit then lose completion' }));
    await conversation.close();
});

it('returns the durable pending id when dispatch cannot reread the committed outbox', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport();
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    const commit = storage.compareAndSwapRecords.bind(storage);
    let failOutboxRead = false;
    jest.spyOn(storage, 'compareAndSwapRecords').mockImplementation(async (updates) => {
        const committed = await commit(updates);
        if (committed && updates.some((item) => item.recordType === 'modern-outbox')) failOutboxRead = true;
        return committed;
    });
    const read = storage.read.bind(storage);
    jest.spyOn(storage, 'read').mockImplementation(async (type, id) => {
        if (failOutboxRead && type === 'modern-outbox') { failOutboxRead = false; throw new Error('simulated post-commit local read failure'); }
        return read(type, id);
    });

    const clientId = await conversation.sendWithReceipt('committed before dispatch failure');
    expect(clientId).toBeTruthy();
    expect(encryptions).toBe(1);
    expect(transport.sent).toHaveLength(0);
    expect(JSON.parse(new TextDecoder().decode((await read('modern-outbox', room))!))[0])
        .toMatchObject({ clientId, senderOrigin: { version: 1, basis: 'durable-commit' } });
    await conversation.close();
});

it('retries the committed envelope after restart when relay submission failed', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const interruptedTransport = fakeTransport(false, 1);
    const first = new ModernConversation(storage, loader, interruptedTransport.transport);
    await first.connect(room, key(9), remoteAddress, await remoteCommitment());
    const clientId = await first.sendWithReceipt('retry after restart');
    expect(interruptedTransport.sent).toHaveLength(0);
    const committed = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))[0];
    expect(committed).toMatchObject({ clientId, senderOrigin: { version: 1, basis: 'durable-commit' } });
    await first.close();

    const restoredTransport = fakeTransport();
    const restarted = new ModernConversation(storage, loader, restoredTransport.transport);
    await restarted.connect(room, key(9), remoteAddress, await remoteCommitment());
    await restarted.retryPending();
    expect(restoredTransport.sent).toEqual([committed.envelope]);
    expect(encryptions).toBe(1);
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))[0].senderOrigin)
        .toEqual({ version: 1, basis: 'durable-commit' });
    await restarted.close();
});

it('restores legacy pending envelopes without inventing origin metadata', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const firstTransport = fakeTransport();
    const first = new ModernConversation(storage, loader, firstTransport.transport);
    await first.connect(room, key(9), remoteAddress, await remoteCommitment());
    await first.sendWithReceipt('legacy compatible');
    const originalEnvelope = firstTransport.sent[0];
    const pending = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!)) as Array<Record<string, unknown>>;
    delete pending[0].senderOrigin;
    await storage.write('modern-outbox', room, new TextEncoder().encode(JSON.stringify(pending)).buffer as ArrayBuffer);
    await first.close();

    const restartedTransport = fakeTransport();
    const restarted = new ModernConversation(storage, loader, restartedTransport.transport);
    const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    await restarted.connect(room, key(9), remoteAddress, await remoteCommitment());
    await restarted.retryPending();
    expect(restartedTransport.sent).toEqual([originalEnvelope]);
    expect(encryptions).toBe(1);
    const restored = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
    expect(restored[0]).not.toHaveProperty('senderOrigin');
    await restarted.close();
    later.mockRestore();
});

it('accepts the peer first-message pre-key after joining without creating a competing outbound session', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const transport = fakeTransport();
    const received: string[] = [];
    const conversation = new ModernConversation(storage, loader, transport.transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), messageAcceptance(storage, received));
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
    const compareAndSwap = jest.spyOn(storage, 'compareAndSwapRecords');
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), undefined, undefined, undefined, { sendJoinIntroduction: true });

    expect(compareAndSwap.mock.calls.some(([updates]) =>
        ['vodozemac-account', 'vodozemac-session', 'conversation-join-introduction', 'conversation-protocol', 'conversation-session-audit']
            .every((type) => updates.some((item) => item.recordType === type)))).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(outboundSessionCreations).toBe(1);
    expect(claimVodozemacOneTimeKey).toHaveBeenCalledTimes(1);
    expect(await storage.read('modern-outbox', room)).toBeUndefined();
    expect(JSON.parse(new TextDecoder().decode((await storage.read('conversation-session-audit', room))!)))
        .toMatchObject({ classification: 'active-established', direction: 'outbound', origin: 'join' });
    const intro = JSON.parse(new TextDecoder().decode((await storage.read('conversation-join-introduction', room))!));
    expect(intro).toMatchObject({ version: 1, recipientAddress: remoteAddress, recipientIdentityCommitment: await remoteCommitment() });
    expect(intro).toMatchObject({ clientId: expect.any(String), senderOrigin: { version: 1, basis: 'durable-commit' } });
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
    const onMessage = jest.fn(async (_text: string, _id: string) => ({ updates: [] }));
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
    const onMessage = jest.fn(async (_text: string, _id: string) => ({ updates: [] }));
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
    await restored.connect(room, key(9), remoteAddress, await remoteCommitment(), messageAcceptance(storage, received));
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
    await restored.connect(room, key(9), undefined, undefined, messageAcceptance(storage, received), onContactChange);
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

    const onMessage = jest.fn(async (_text: string, _id: string) => ({ updates: [] }));
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

    const onMessage = jest.fn(async (_text: string, _id: string) => ({ updates: [] }));
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

it('cached call composition denies local unverify without mutating verification during gate checks', async () => {
    const pair = await verifiedPeerPair();
    await pair.bob.sendWithReceipt('establish session');
    await receiveFirstMessage(pair.alice, pair.bobTransport.sent[0], remoteAddress);
    const composition = await pair.alice.createAuthenticatedCallComposition();
    await expect(composition.assertVerifiedContact?.()).resolves.toBeUndefined();
    await pair.alice.unverifyContact();
    expect((await pair.alice.getContact())?.verification).toBe('unverified');
    await expect(pair.alice.createAuthenticatedCallComposition()).rejects.toThrow('Verify');
    await expect(composition.invite()).rejects.toThrow('Verification');
    expect((await pair.alice.getContact())?.verification).toBe('unverified');
    await pair.alice.close(); await pair.bob.close();
});

it('file sender authority requires explicit unchanged verification; reset denies new files while pinned receiving remains available', async () => {
    const pair = await verifiedPeerPair();
    try {
        const binding = await pair.alice.fileTransferBinding(true);
        expect(binding.senderParticipantId).toBe(localAddress); expect(binding.recipientParticipantId).toBe(remoteAddress);
        expect(binding.recipientIdentityReference).toBe((await pair.alice.getContact())!.identityId);
        await pair.alice.unverifyContact();
        await expect(pair.alice.fileTransferBinding(true)).rejects.toThrow('Verified unchanged');
        await expect(pair.alice.fileTransferBinding(false)).resolves.toEqual(binding);
        await pair.alice.verifyContact(true); await expect(pair.alice.fileTransferBinding(true)).resolves.toEqual(binding);
    } finally { await pair.alice.close(); await pair.bob.close(); }
});

it('V2 reference publication uses protected verification CAS and reset denies re-publication', async () => {
    const pair = await verifiedPeerPair();
    try {
        const { serializeFileReference, b64, FILE_LIMITS } = await import('../files/protocol');
        const binding = await pair.alice.fileTransferBinding(true); const createdAt = Date.now();
        const reference = serializeFileReference({ version: 2, context: { ...binding, transferId: crypto.randomUUID(), fileSize: 1, chunkSize: FILE_LIMITS.MAX_CHUNK_SIZE, chunkCount: 1 }, key: b64(new Uint8Array(32)), createdAt, expiresAt: createdAt + FILE_LIMITS.TRANSFER_EXPIRY });
        await expect(pair.alice.sendWithReceipt(reference)).resolves.toEqual(expect.any(String));
        await pair.alice.unverifyContact(); const before = pair.aliceTransport.sent.length;
        await expect(pair.alice.sendWithReceipt(reference)).rejects.toThrow('Verified unchanged'); expect(pair.aliceTransport.sent).toHaveLength(before);
    } finally { await pair.alice.close(); await pair.bob.close(); }
});

it('wraps negotiated outbound text with stable room and identity bindings while preserving the legacy peer path', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const transport = fakeTransport(false, 0, true);
    const conversation = new ModernConversation(storage, loader, transport.transport);
    const own = await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    await seedVerifiedContact(storage, remoteAddress);
    await conversation.verifyContact(true);
    await conversation.sendWithReceipt('room-bound hello');
    const frame = encryptedPlaintexts[0];
    expect(frame.slice(0, 2)).toEqual(new Uint8Array([1, 1]));
    const decoded = decodeRoomMessage(frame.slice(2), {
        roomId: room, senderIdentityReference: own.ownFingerprint,
        recipientIdentityReference: (await conversation.getContact())!.identityId,
    });
    expect(decoded.version).toBe('room-message-v1');
    expect(JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!))[0].roomMessageVersion).toBe(1);
    if (decoded.version === 'room-message-v1') expect(new TextDecoder().decode(decoded.payload)).toBe('room-bound hello');
    await conversation.close();

    const legacyStorage = new Storage();
    const legacyTransport = fakeTransport();
    const legacy = new ModernConversation(legacyStorage, loader, legacyTransport.transport);
    await legacy.connect(room, key(9), remoteAddress, await remoteCommitment());
    await seedVerifiedContact(legacyStorage, remoteAddress);
    await legacy.verifyContact(true);
    await legacy.sendWithReceipt('legacy compatible');
    expect(new TextDecoder().decode(encryptedPlaintexts[1].slice(2))).toBe('legacy compatible');
    expect(JSON.parse(new TextDecoder().decode((await legacyStorage.read('modern-outbox', room))!))[0]).not.toHaveProperty('roomMessageVersion');
    await legacy.close();
});

it('keeps legacy outbox ciphertext off a room-message-v1-required transport', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const legacyTransport = fakeTransport();
    const legacy = new ModernConversation(storage, loader, legacyTransport.transport);
    await legacy.connect(room, key(9), remoteAddress, await remoteCommitment());
    await seedVerifiedContact(storage, remoteAddress);
    await legacy.verifyContact(true);
    await legacy.sendWithReceipt('legacy outbox item');
    await legacy.close(false);

    const strictTransport = fakeTransport(false, 0, false, true);
    const strict = new ModernConversation(storage, loader, strictTransport.transport);
    await strict.connect(room, key(9), remoteAddress, await remoteCommitment());
    expect(strictTransport.transport.activeTransport()?.requiresRoomMessageV1).toBe(true);
    await strict.retryPending();
    expect(strictTransport.sent).toHaveLength(0);
    await expect(strict.sendWithReceipt('must fail without peer room-message-v1 support')).rejects.toThrow('requires peer room-message-v1 support');
    expect(strictTransport.sent).toHaveLength(0);
    const outbox = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
    expect(outbox).toHaveLength(1);
    await strict.close(false);

    const v1Transport = fakeTransport(false, 0, true, true);
    const v1 = new ModernConversation(storage, loader, v1Transport.transport);
    const own = await v1.connect(room, key(9), remoteAddress, await remoteCommitment());
    await v1.sendWithReceipt('strict room-bound send');
    expect(v1Transport.sent).toHaveLength(1);
    const nextOutbox = JSON.parse(new TextDecoder().decode((await storage.read('modern-outbox', room))!));
    expect(nextOutbox).toHaveLength(2);
    expect(nextOutbox[1].roomMessageVersion).toBe(1);
    expect(decodeRoomMessage(encryptedPlaintexts[1].slice(2), {
        roomId: room, senderIdentityReference: own.ownFingerprint,
        recipientIdentityReference: (await v1.getContact())!.identityId,
    }).version).toBe('room-message-v1');
    await v1.close();
});

it('rejects a wrong-room first-prekey wrapper before durable account, session, message, or ACK acceptance', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const delivered = jest.fn(messageAcceptance(storage));
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const own = await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    const accountBefore = await storage.read('vodozemac-account', 'local');
    expect(accountBefore).toBeDefined();
    const wrongRoom = encodeRoomMessageV1({ roomId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        senderIdentityReference: await remoteCommitment(), recipientIdentityReference: own.ownFingerprint,
        eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', kind: 'text', payload: new TextEncoder().encode('must reject') });
    decryptedBytes = new Uint8Array([1, 1, ...wrongRoom]);
    const envelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque-wrong-room' }) } };
    await expect(receiveFirstMessage(conversation, envelope, remoteAddress)).rejects.toThrow('binding mismatch');
    expect(await storage.read('vodozemac-account', 'local')).toEqual(accountBefore);
    expect(await storage.read('vodozemac-session', room)).toBeUndefined();
    expect(await storage.read('product-messages', room)).toBeUndefined();
    expect(await storage.read('modern-seen-m1-v1', room)).toBeUndefined();
    expect(delivered).not.toHaveBeenCalled();
    await conversation.close();
});

it('rejects an established-session cross-room file reference before the application consumer runs', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const delivered = jest.fn(messageAcceptance(storage));
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const own = await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), delivered);
    await seedVerifiedContact(storage, remoteAddress);
    const good = encodeRoomMessageV1({ roomId: room, senderIdentityReference: await remoteCommitment(),
        recipientIdentityReference: own.ownFingerprint, eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', kind: 'text',
        payload: new TextEncoder().encode('establish') });
    decryptedBytes = new Uint8Array([1, 1, ...good]);
    const first: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque-first' }) } };
    await expect(receiveFirstMessage(conversation, first, remoteAddress)).resolves.toBe(true);
    const messagesBefore = await storage.read('product-messages', room);
    const sessionBefore = await storage.read('vodozemac-session', room);
    const moved = encodeRoomMessageV1({ roomId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        senderIdentityReference: await remoteCommitment(), recipientIdentityReference: own.ownFingerprint,
        eventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', kind: 'attachment-reference',
        payload: new TextEncoder().encode('k3ncrypt-file-cross-room') });
    decryptedBytes = new Uint8Array([1, 1, ...moved]);
    const second: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque-second' }) } };
    await expect(receiveFirstMessage(conversation, second, remoteAddress)).rejects.toThrow('binding mismatch');
    expect(await storage.read('product-messages', room)).toEqual(messagesBefore);
    expect(await storage.read('vodozemac-session', room)).toEqual(sessionBefore);
    expect(delivered).toHaveBeenCalledTimes(1);
    await conversation.close();
});

it('deduplicates authenticated event identity within its room and rejects conflicting event-ID reuse', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    const storage = new Storage();
    const consumer = jest.fn(messageAcceptance(storage));
    const conversation = new ModernConversation(storage, loader, fakeTransport().transport);
    const own = await conversation.connect(room, key(9), remoteAddress, await remoteCommitment(), consumer);
    const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const wrapper = encodeRoomMessageV1({ roomId: room, senderIdentityReference: await remoteCommitment(),
        recipientIdentityReference: own.ownFingerprint, eventId, kind: 'text', payload: new TextEncoder().encode('once') });
    decryptedBytes = new Uint8Array([1, 1, ...wrapper]);
    const first: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 1, ciphertext: 'opaque-event-first' }) } };
    await expect(receiveFirstMessage(conversation, first, remoteAddress)).resolves.toBe(true);
    expect(consumer).toHaveBeenCalledTimes(1);

    decryptedBytes = new Uint8Array([1, 1, ...wrapper]);
    const duplicate: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque-event-replay' }) } };
    await expect(receiveFirstMessage(conversation, duplicate, remoteAddress)).resolves.toBe(true);
    expect(consumer).toHaveBeenCalledTimes(1);

    const conflicting = encodeRoomMessageV1({ roomId: room, senderIdentityReference: await remoteCommitment(),
        recipientIdentityReference: own.ownFingerprint, eventId, kind: 'text', payload: new TextEncoder().encode('changed') });
    decryptedBytes = new Uint8Array([1, 1, ...conflicting]);
    const conflictEnvelope: EncryptedEnvelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1,
        olmMessage: JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque-event-conflict' }) } };
    await expect(receiveFirstMessage(conversation, conflictEnvelope, remoteAddress)).rejects.toThrow('reused with different content');
    expect(consumer).toHaveBeenCalledTimes(1);
    await conversation.close();
});
