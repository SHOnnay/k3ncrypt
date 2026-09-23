import { webcrypto } from 'crypto';
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
const bundle = { version: 1 as const, protocol: 'vodozemac-olm-v1' as const,
    identity: { curve25519: key(3), ed25519: key(4) }, oneTimeKeys: [{ id: 'otk-remote-test', key: key(5) }] };
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
const session = (): VodozemacSessionHandle => ({
    sessionId: () => 'session-test',
    encrypt: () => { encryptions++; return JSON.stringify({ version: 1, message_type: 0, ciphertext: 'opaque' }); },
    decrypt: () => new Uint8Array(), saveSession: () => new Uint8Array([1, 2]),
});
const account = (): VodozemacAccountHandle => ({
    identityKeys: () => JSON.stringify({ curve25519: key(1), ed25519: key(2) }),
    availableOneTimeKeys: () => [key(6)], fallbackKey: () => key(7),
    generateOneTimeKeys: () => undefined, generateFallbackKey: () => undefined,
    markKeysAsPublished: () => undefined, saveAccount: () => 'encrypted-account',
    createOutboundSession: () => session(),
});
const loader = async () => ({ protocolVersion: 1 as const,
    accountFactory: { createAccount: account, loadAccount: account },
    sessionFactory: { loadSession: session } });

const fakeTransport = () => {
    const sent: EncryptedEnvelope[] = [];
    const transport = {
        start: async () => undefined, stop: async () => undefined, join: () => undefined,
        sendEnvelope: async (_channel: unknown, envelope: EncryptedEnvelope) => { sent.push(envelope); return { id: `relay-${sent.length}` }; },
        activeTransport: () => undefined,
    } as unknown as TransportManager;
    return { transport, sent };
};

beforeEach(() => jest.clearAllMocks());

it('retries the identical persisted envelope after a lost ACK and after restart', async () => {
    encryptions = 0;
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const storage = new Storage();
    const firstTransport = fakeTransport();
    const first = new ModernConversation(storage, loader, firstTransport.transport);
    await first.connect(room, key(9), remoteAddress, await remoteCommitment());
    await first.send('hello');
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

it('exposes authenticated call composition only after modern identity verification', async () => {
    jest.mocked(publishVodozemacBundle).mockResolvedValue({ address: localAddress, renewalProof: 'r'.repeat(43) });
    jest.mocked(fetchVodozemacBundle).mockResolvedValue(bundle);
    jest.mocked(claimVodozemacOneTimeKey).mockResolvedValue(bundle.oneTimeKeys[0]);
    const conversation = new ModernConversation(new Storage(), loader, fakeTransport().transport);
    await conversation.connect(room, key(9), remoteAddress, await remoteCommitment());
    await expect(conversation.createAuthenticatedCallComposition()).rejects.toThrow('Verify this contact');
    await conversation.verifyContact(true);
    const composition = await conversation.createAuthenticatedCallComposition();
    expect(composition.signalTransport).toBeInstanceOf(AuthenticatedCallSignalTransport);
    expect(composition.service).toBeDefined();
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
