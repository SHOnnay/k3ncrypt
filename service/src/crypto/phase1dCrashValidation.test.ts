import { webcrypto } from 'crypto';
import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { ModernConversation } from './modernConversation';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const peer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const envelope: EncryptedEnvelope = {
    version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'same-saved-ciphertext' },
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const parse = <T>(value?: ArrayBuffer): T | undefined => value ? JSON.parse(new TextDecoder().decode(value)) as T : undefined;

type Pending = { envelope: EncryptedEnvelope; clientId: string; relayId?: string; sentAt?: number };

const makeStorage = () => {
    const records = new Map<string, ArrayBuffer>();
    let failingType: string | undefined;
    const storage = {
        read: async (type: string, id: string) => records.get(`${type}:${id}`),
        write: async (type: string, id: string, value: ArrayBuffer) => {
            if (type === failingType) throw new Error(`injected ${type} write failure`);
            records.set(`${type}:${id}`, value.slice(0));
        },
    } as SecureStorage;
    return { storage, records, fail: (type?: string) => { failingType = type; } };
};

const makeSender = (storage: SecureStorage, submissions: EncryptedEnvelope[]) => {
    let encryptions = 0;
    let rejectSubmission = false;
    const transport = {
        sendEnvelope: async (_channel: string, value: EncryptedEnvelope) => {
            submissions.push(value);
            if (rejectSubmission) throw new Error('simulated relay failure');
            return { id: `relay-${submissions.length}`, timestamp: Date.now() };
        },
    } as TransportManager;
    const conversation = new ModernConversation(storage, async () => { throw new Error('unused loader'); }, transport);
    Object.assign(conversation, {
        roomId: room, remoteAddress: peer,
        assertCurrentDeviceTrust: async () => undefined,
        getContact: async () => ({ changeStatus: 'unchanged' }),
        ensureOutboundSession: async () => undefined,
        runtime: { encrypt: async () => {
            encryptions++;
            await storage.write('test-ratchet', room, bytes({ advances: encryptions }));
            return envelope;
        } },
    });
    return { conversation, encryptions: () => encryptions, reject: (value: boolean) => { rejectSubmission = value; } };
};

const makeReceiver = (storage: SecureStorage, consumed: string[], rejectAfterDecrypt = false) => {
    let decryptions = 0;
    const conversation = new ModernConversation(storage, async () => { throw new Error('unused loader'); }, {} as TransportManager);
    Object.assign(conversation, {
        roomId: room, capability: 'test-capability', remoteAddress: peer,
        assertCurrentDeviceTrust: async () => undefined,
        registry: { get: async () => ({ identityId: 'pinned-peer', verification: 'unverified', changeStatus: 'unchanged' }) },
        restoreContactAfterAuthenticatedMessage: async () => undefined,
        runtime: { activeSessionId: 'restored-session', decrypt: async () => {
            decryptions++;
            if (rejectAfterDecrypt && await storage.read('test-ratchet', room)) throw new Error('replayed ciphertext cannot advance restored ratchet');
            await storage.write('test-ratchet', room, bytes({ advanced: true }));
            return new TextEncoder().encode('authenticated text').buffer;
        } },
        onMessage: async (text: string) => {
            const existing = parse<string[]>(await storage.read('product-messages', room)) ?? [];
            await storage.write('product-messages', room, bytes([...existing, text]));
            consumed.push(text);
        },
    });
    return {
        receive: (value = envelope) => (conversation as unknown as {
            receive: (item: EncryptedEnvelope, sender: string) => Promise<boolean>;
        }).receive(value, peer),
        decryptions: () => decryptions,
    };
};

describe('Phase 1D current crash and ACK behavior (fault-injection models)', () => {
    test('S1: failure before outbox persistence leaves advanced sender state but no retry item', async () => {
        const state = makeStorage();
        const submissions: EncryptedEnvelope[] = [];
        const sender = makeSender(state.storage, submissions);
        state.fail('modern-outbox');
        await expect(sender.conversation.sendWithReceipt('text')).rejects.toThrow('injected modern-outbox write failure');
        expect(parse(await state.storage.read('test-ratchet', room))).toEqual({ advances: 1 });
        expect(await state.storage.read('modern-outbox', room)).toBeUndefined();
        expect(submissions).toHaveLength(0);
        state.fail();
        const restarted = makeSender(state.storage, submissions);
        await restarted.conversation.retryPending();
        expect(submissions).toHaveLength(0);
        expect(restarted.encryptions()).toBe(0);
    });

    test('S2 and lost ACK: restart retries the saved ciphertext without encryption', async () => {
        const state = makeStorage();
        const submissions: EncryptedEnvelope[] = [];
        const first = makeSender(state.storage, submissions);
        first.reject(true);
        await first.conversation.sendWithReceipt('text');
        expect(submissions).toHaveLength(1);
        expect(parse<Pending[]>(await state.storage.read('modern-outbox', room))).toHaveLength(1);
        const restarted = makeSender(state.storage, submissions);
        await restarted.conversation.retryPending();
        expect(submissions).toEqual([envelope, envelope]);
        expect(restarted.encryptions()).toBe(0);

        // A lost relay `delivered` event leaves the outbox item present even after submission.
        expect(parse<Pending[]>(await state.storage.read('modern-outbox', room))).toHaveLength(1);
        const pending = parse<Pending[]>(await state.storage.read('modern-outbox', room))!;
        pending[0].sentAt = Date.now() - 6000;
        await state.storage.write('modern-outbox', room, bytes(pending));
        await restarted.conversation.retryPending();
        expect(submissions).toEqual([envelope, envelope, envelope]);
        expect(restarted.encryptions()).toBe(0);
    });

    test('R1/R2: persisted ratchet before failed consumer leaves no seen marker; modeled strict replay fails after restart', async () => {
        const state = makeStorage();
        const consumed: string[] = [];
        const first = makeReceiver(state.storage, consumed, true);
        state.fail('product-messages');
        await expect(first.receive()).rejects.toThrow('injected product-messages write failure');
        expect(parse(await state.storage.read('test-ratchet', room))).toEqual({ advanced: true });
        expect(await state.storage.read('product-messages', room)).toBeUndefined();
        expect(await state.storage.read('modern-seen', room)).toBeUndefined();
        state.fail();
        const restarted = makeReceiver(state.storage, consumed, true);
        await expect(restarted.receive()).rejects.toThrow('replayed ciphertext cannot advance restored ratchet');
        expect(consumed).toHaveLength(0);
        expect(restarted.decryptions()).toBe(1);
    });

    test('R3: a seen-marker failure leaves durable content that can be consumed again after restart', async () => {
        const state = makeStorage();
        const consumed: string[] = [];
        const first = makeReceiver(state.storage, consumed);
        state.fail('modern-seen');
        await expect(first.receive()).rejects.toThrow('injected modern-seen write failure');
        expect(parse<string[]>(await state.storage.read('product-messages', room))).toEqual(['authenticated text']);
        state.fail();
        const restarted = makeReceiver(state.storage, consumed);
        await expect(restarted.receive()).resolves.toBe(true);
        expect(parse<string[]>(await state.storage.read('product-messages', room))).toEqual(['authenticated text', 'authenticated text']);
        expect(consumed).toHaveLength(2);
    });

    test('duplicate and delayed relay ACKs: current relay ID matching is idempotent but an old ID cannot clear a retried item', async () => {
        const state = makeStorage();
        const submissions: EncryptedEnvelope[] = [];
        const sender = makeSender(state.storage, submissions);
        await sender.conversation.sendWithReceipt('text');
        const pending = parse<Pending[]>(await state.storage.read('modern-outbox', room))!;
        expect(pending[0].relayId).toBe('relay-1');
        pending[0].sentAt = Date.now() - 6000;
        await state.storage.write('modern-outbox', room, bytes(pending));
        await sender.conversation.retryPending();
        expect(parse<Pending[]>(await state.storage.read('modern-outbox', room))![0].relayId).toBe('relay-2');
        await sender.conversation.acceptDelivery('relay-1');
        expect(parse<Pending[]>(await state.storage.read('modern-outbox', room))).toHaveLength(1);
        await sender.conversation.acceptDelivery('relay-2');
        await sender.conversation.acceptDelivery('relay-2');
        expect(parse<Pending[]>(await state.storage.read('modern-outbox', room))).toEqual([]);
    });
});
