import { createServer } from 'http';
import { createHash, randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import client, { type Socket } from 'socket.io-client';
import { initSyncRelay, MAX_SYNC_ENVELOPE_BYTES, validSyncEnvelope } from './relay';
import { initSocket } from '../socket.io';
import { authorizeRoomControl } from '../security/controlCapability';
import db from '../db';

jest.mock('../security/controlCapability', () => ({ ...jest.requireActual('../security/controlCapability'), authorizeRoomControl: jest.fn(async () => ({})) }));
jest.mock('../api/chatHash/utils/validateChannel', () => ({ __esModule: true, default: async () => ({ valid: true }) }));
const routingProof = 'b'.repeat(43);
const routingProofHash = createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${routingProof}`).digest('hex');
jest.mock('../db', () => ({ __esModule: true, default: { getDatabase: () => undefined, cleanupExpiredOfflineMessages: jest.fn(), claimOfflineMessage: async () => undefined, storeOfflineMessage: jest.fn(async (record) => record), countOfflineMessages: jest.fn(async () => 0), ackOfflineMessage: jest.fn(async () => true), persistentStorageReady: () => true, findOneFromDB: async () => ({ renewalProofHash: routingProofHash, expiresAt: new Date(Date.now() + 60_000) }) } }));
jest.mock('../security/durableDeviceTrust', () => ({ durableDeviceTrustAuthority: jest.fn(() => ({ verify: jest.fn(async () => ({ deviceId: 'test-device', accountIdentityReference: 'test-account' })) })) }));
const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const alice = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bob = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const unknown = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const envelope = (size: number) => ({ version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'x'.repeat(size) } });
const carrier = (conversationId = room) => ({ deviceAuthorizationProof: { deviceId: 'test-device', accountIdentityReference: 'test-account', nonce: 'test-proof-nonce', resource: { conversationId } }, proofNonce: 'test-proof-nonce' });

describe('isolated sync relay', () => {
    const http = createServer();
    let modern: ReturnType<typeof initSyncRelay>;
    let original: ReturnType<typeof initSocket>;
    let url: string;
    const sockets: Socket[] = [];
    beforeAll(async () => {
        original = initSocket(http);
        modern = initSyncRelay(http);
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        sockets.forEach((socket) => socket.disconnect());
        await new Promise<void>((resolve) => modern.close(() => resolve()));
        await new Promise<void>((resolve) => original.close(() => resolve()));
        if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    const connect = async (routingId: string, sync: boolean): Promise<Socket> => {
        const socket = client(url, { path: sync ? '/sync/socket.io' : '/socket.io', transports: ['websocket'], reconnection: false,
            auth: sync ? { room, routingId, capability: 'a'.repeat(43) } : undefined });
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => { socket.once(sync ? 'sync-ready' : 'connect', resolve); socket.once('connect_error', reject); });
        return socket;
    };
    it('preserves messaging/call bounds while forwarding large opaque sync envelopes only to the selected peer', async () => {
        const a = await connect(alice, false);
        const b = await connect(bob, false);
        const joined = new Promise<void>((resolve) => a.once('on-alice-join', resolve));
        a.emit('chat-join', { userID: alice, channelID: room, controlCapability: 'a'.repeat(43), routingProof, ...carrier() });
        b.emit('chat-join', { userID: bob, channelID: room, controlCapability: 'a'.repeat(43), routingProof, ...carrier() });
        await joined;
        const large = envelope(80 * 1024);
        // 40 KiB is below the original Engine.IO cap but above its unchanged app cap.
        expect((await a.timeout(2000).emitWithAck('chat-message', { envelope: envelope(40 * 1024) })).error).toMatch(/oversized/);
        expect((await a.timeout(2000).emitWithAck('webrtc-signal', { envelope: envelope(40 * 1024) })).error).toMatch(/oversized/);
        const sa = await connect(alice, true);
        const sb = await connect(bob, true);
        const received: unknown[] = [];
        sb.on('sync-envelope', (payload, ack) => { received.push(payload); ack({ status: 'accepted' }); });
        expect(await sa.timeout(2000).emitWithAck('sync-envelope', { recipientRoutingId: bob, envelope: large })).toEqual({ status: 'accepted' });
        expect(received).toEqual([{ senderRoutingId: alice, envelope: large }]);
        expect((await sa.timeout(2000).emitWithAck('sync-envelope', { recipientRoutingId: unknown, envelope: large })).error).toBeDefined();
        expect((await sa.timeout(2000).emitWithAck('sync-envelope', { recipientRoutingId: bob, envelope: envelope(MAX_SYNC_ENVELOPE_BYTES) })).error).toBeDefined();
        expect(received).toHaveLength(1);
        jest.mocked(authorizeRoomControl).mockResolvedValueOnce(undefined);
        expect((await sa.timeout(2000).emitWithAck('sync-envelope', { recipientRoutingId: bob, envelope: large })).error).toBeDefined();
    }, 20_000);

    it('waits for live recipient acceptance and retains a declined envelope for mailbox replay', async () => {
        const isolatedRoom = randomUUID();
        const isolatedSender = randomUUID();
        const isolatedRecipient = randomUUID();
        const sender = await connect(isolatedSender, false);
        const recipient = await connect(isolatedRecipient, false);
        const joined = new Promise<void>((resolve) => sender.once('on-alice-join', resolve));
        sender.emit('chat-join', { userID: isolatedSender, channelID: isolatedRoom, controlCapability: 'a'.repeat(43), routingProof, ...carrier(isolatedRoom) });
        recipient.emit('chat-join', { userID: isolatedRecipient, channelID: isolatedRoom, controlCapability: 'a'.repeat(43), routingProof, ...carrier(isolatedRoom) });
        await joined;

        const incoming = new Promise<{ acknowledgement?: (value: { accepted: boolean }) => void }>((resolve) => {
            recipient.once('chat-message', (_message, acknowledgement) => resolve({ acknowledgement }));
        });
        const acceptedSend = sender.timeout(2_000).emitWithAck('chat-message', {
            envelope: envelope(1), recipientRoutingId: isolatedRecipient, ...carrier(isolatedRoom), proofOperation: 'relay:message',
        });
        const acceptedDelivery = await incoming;
        expect(typeof acceptedDelivery.acknowledgement).toBe('function');
        acceptedDelivery.acknowledgement?.({ accepted: true });
        const accepted = await acceptedSend;
        expect(accepted.id).toBeDefined();
        expect(accepted.stored).toBeUndefined();

        jest.mocked(db.storeOfflineMessage).mockClear();
        const declinedIncoming = new Promise<{ acknowledgement?: (value: { accepted: boolean }) => void }>((resolve) => {
            recipient.once('chat-message', (_message, acknowledgement) => resolve({ acknowledgement }));
        });
        const declinedSend = sender.timeout(2_000).emitWithAck('chat-message', {
            envelope: envelope(2), recipientRoutingId: isolatedRecipient, ...carrier(isolatedRoom), proofOperation: 'relay:message',
        });
        const declinedDelivery = await declinedIncoming;
        declinedDelivery.acknowledgement?.({ accepted: false });
        const retained = await declinedSend;
        expect(retained.stored).toBe(true);
        expect(db.storeOfflineMessage).toHaveBeenCalledTimes(1);
    }, 15_000);
    it('rejects malformed, legacy and oversized envelopes without interpreting ciphertext', () => {
        const overhead = Buffer.byteLength(JSON.stringify(envelope(0)));
        expect(validSyncEnvelope(envelope(MAX_SYNC_ENVELOPE_BYTES - overhead))).toBe(true);
        expect(validSyncEnvelope(envelope(MAX_SYNC_ENVELOPE_BYTES - overhead + 1))).toBe(false);
        expect(validSyncEnvelope(envelope(80 * 1024))).toBe(true);
        expect(validSyncEnvelope(envelope(MAX_SYNC_ENVELOPE_BYTES))).toBe(false);
        expect(validSyncEnvelope({ ...envelope(10), version: 1 })).toBe(false);
        expect(validSyncEnvelope({ ...envelope(10), data: { plaintext: 'not encrypted' } })).toBe(false);
    });
});
