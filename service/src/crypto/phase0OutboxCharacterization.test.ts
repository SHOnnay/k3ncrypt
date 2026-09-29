import { webcrypto } from 'crypto';
import type { EncryptedEnvelope, SecureStorage, TransportManager } from '../core/contracts';
import { ModernConversation } from './modernConversation';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const recipient = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const envelope: EncryptedEnvelope = {
    version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'one-encrypted-envelope' },
};

const harness = () => {
    const records = new Map<string, ArrayBuffer>();
    const submitted: EncryptedEnvelope[] = [];
    let encryptions = 0;
    let outboxWriteFails = false;
    let sendFails = false;
    const storage = {
        read: async (type: string, id: string) => records.get(`${type}:${id}`),
        write: async (type: string, id: string, value: ArrayBuffer) => {
            if (type === 'modern-outbox' && outboxWriteFails) throw new Error('injected outbox failure');
            records.set(`${type}:${id}`, value);
        },
    } as SecureStorage;
    const transport = {
        sendEnvelope: async (_channel: string, value: EncryptedEnvelope) => {
            submitted.push(value);
            if (sendFails) throw new Error('injected relay failure');
            return { id: 'relay-id', timestamp: Date.now() };
        },
    } as TransportManager;
    const conversation = new ModernConversation(storage, async () => { throw new Error('loader not expected'); }, transport);
    Object.assign(conversation, {
        roomId: room,
        remoteAddress: recipient,
        assertCurrentDeviceTrust: async () => undefined,
        getContact: async () => ({ changeStatus: 'unchanged' }),
        ensureOutboundSession: async () => undefined,
        runtime: { encrypt: async () => { encryptions++; return envelope; } },
    });
    return {
        conversation, records, submitted,
        encryptions: () => encryptions,
        failOutboxWrite: (value: boolean) => { outboxWriteFails = value; },
        failSend: (value: boolean) => { sendFails = value; },
    };
};

describe('Phase 0 outbound crash and retry characterization', () => {
    test('CP5: failed outbox write after encryption leaves no durable retry item', async () => {
        const flow = harness();
        flow.failOutboxWrite(true);
        await expect(flow.conversation.sendWithReceipt('hello')).rejects.toThrow('injected outbox failure');
        expect(flow.encryptions()).toBe(1);
        expect(flow.records.has(`modern-outbox:${room}`)).toBe(false);
        expect(flow.submitted).toHaveLength(0);
    });

    test('CP6: transport failure keeps exact encrypted envelope for later retry', async () => {
        const flow = harness();
        flow.failSend(true);
        await expect(flow.conversation.sendWithReceipt('hello')).resolves.toEqual(expect.any(String));
        expect(flow.records.has(`modern-outbox:${room}`)).toBe(true);
        expect(flow.submitted).toHaveLength(1);
        flow.failSend(false);
        await flow.conversation.retryPending();
        expect(flow.submitted).toHaveLength(2);
        expect(flow.submitted[1]).toEqual(flow.submitted[0]);
        expect(flow.encryptions()).toBe(1);
    });
});
