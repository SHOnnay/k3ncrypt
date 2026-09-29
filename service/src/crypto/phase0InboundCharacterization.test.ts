import { webcrypto } from 'crypto';
import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { ModernConversation } from './modernConversation';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sender = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const envelope: EncryptedEnvelope = {
    version: 2,
    strategy: 'vodozemac-olm-v1',
    data: { version: 1, olmMessage: 'opaque-phase0-envelope' },
};

type Harness = {
    receive: (value: EncryptedEnvelope, address: string) => Promise<boolean>;
    storage: Map<string, ArrayBuffer>;
    received: string[];
    decrypts: () => number;
    failSeenWrite: (value: boolean) => void;
    failConsumer: (value: boolean) => void;
    plaintext: (value: Uint8Array) => void;
};

const harness = (): Harness => {
    const records = new Map<string, ArrayBuffer>();
    const received: string[] = [];
    let seenWriteFails = false;
    let consumerFails = false;
    let decryptCount = 0;
    let plaintext = new TextEncoder().encode('authenticated text');
    const storage = {
        read: async (type: string, id: string) => records.get(`${type}:${id}`),
        write: async (type: string, id: string, value: ArrayBuffer) => {
            if (type === 'modern-seen' && seenWriteFails) throw new Error('injected replay-state failure');
            records.set(`${type}:${id}`, value);
        },
    } as SecureStorage;
    const conversation = new ModernConversation(storage, async () => { throw new Error('loader not expected'); }, {} as TransportManager);
    Object.assign(conversation, {
        roomId: room,
        capability: 'capability-test',
        remoteAddress: sender,
        runtime: {
            activeSessionId: 'session-test',
            decrypt: async () => {
                decryptCount++;
                return plaintext.buffer;
            },
        },
        registry: { get: async () => ({ identityId: 'observed-identity', verification: 'unverified', changeStatus: 'unchanged' }) },
        assertCurrentDeviceTrust: async () => undefined,
        restoreContactAfterAuthenticatedMessage: async () => undefined,
        onMessage: async (text: string) => {
            received.push(text);
            if (consumerFails) throw new Error('injected consumer failure');
        },
    });
    return {
        receive: (value, address) => (conversation as unknown as { receive: (value: EncryptedEnvelope, address: string) => Promise<boolean> }).receive(value, address),
        storage: records,
        received,
        decrypts: () => decryptCount,
        failSeenWrite: (value) => { seenWriteFails = value; },
        failConsumer: (value) => { consumerFails = value; },
        plaintext: (value) => { plaintext = new Uint8Array(value); },
    };
};

describe('Phase 0 inbound crash and replay characterization', () => {
    test('consumer failure prevents replay marker and acceptance', async () => {
        const flow = harness();
        flow.failConsumer(true);
        await expect(flow.receive(envelope, sender)).rejects.toThrow('injected consumer failure');
        expect(flow.storage.has(`modern-seen:${room}`)).toBe(false);
        flow.failConsumer(false);
        await expect(flow.receive(envelope, sender)).resolves.toBe(true);
        expect(flow.decrypts()).toBe(2);
    });

    test('seen-write failure after consumer acceptance permits duplicate consumer invocation', async () => {
        const flow = harness();
        flow.failSeenWrite(true);
        await expect(flow.receive(envelope, sender)).rejects.toThrow('injected replay-state failure');
        flow.failSeenWrite(false);
        await expect(flow.receive(envelope, sender)).resolves.toBe(true);
        expect(flow.received).toEqual(['authenticated text', 'authenticated text']);
    });

    test('accepted duplicate is acknowledged without decrypting or storing twice', async () => {
        const flow = harness();
        await expect(flow.receive(envelope, sender)).resolves.toBe(true);
        await expect(flow.receive(envelope, sender)).resolves.toBe(true);
        expect(flow.decrypts()).toBe(1);
        expect(flow.received).toHaveLength(1);
    });

    test('replay record keeps 1024 newest digests and evicts the oldest', async () => {
        const flow = harness();
        for (let index = 0; index < 1025; index++) {
            const item: EncryptedEnvelope = {
                ...envelope,
                data: { version: 1, olmMessage: `opaque-${index}` },
            };
            await expect(flow.receive(item, sender)).resolves.toBe(true);
        }
        const bytes = flow.storage.get(`modern-seen:${room}`);
        expect(bytes).toBeDefined();
        expect(JSON.parse(new TextDecoder().decode(bytes))).toHaveLength(1024);
        const decryptsBeforeReplay = flow.decrypts();
        await expect(flow.receive({ ...envelope, data: { version: 1, olmMessage: 'opaque-0' } }, sender)).resolves.toBe(true);
        expect(flow.decrypts()).toBe(decryptsBeforeReplay + 1);
    });

    test('unknown malformed binary frame is rejected without consumer acceptance', async () => {
        const flow = harness();
        flow.plaintext(new Uint8Array([0xff, 0x00, 0x01]));
        await expect(flow.receive(envelope, sender)).rejects.toThrow();
        expect(flow.received).toHaveLength(0);
        expect(flow.storage.has(`modern-seen:${room}`)).toBe(false);
    });

    test('unknown printable control candidate is currently displayed as chat text', async () => {
        const flow = harness();
        flow.plaintext(new TextEncoder().encode('future-control-v2'));
        await expect(flow.receive(envelope, sender)).resolves.toBe(true);
        expect(flow.received).toEqual(['future-control-v2']);
    });

});
