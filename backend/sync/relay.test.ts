import { createServer } from 'http';
import type { AddressInfo } from 'net';
import client, { type Socket } from 'socket.io-client';
import { initSyncRelay, MAX_SYNC_ENVELOPE_BYTES, validSyncEnvelope } from './relay';
import { initSocket } from '../socket.io';
import { authorizeRoomControl } from '../security/controlCapability';

jest.mock('../security/controlCapability', () => ({ ...jest.requireActual('../security/controlCapability'), authorizeRoomControl: jest.fn(async () => ({})) }));
jest.mock('../api/chatHash/utils/validateChannel', () => ({ __esModule: true, default: async () => ({ valid: true }) }));
jest.mock('../db', () => ({ __esModule: true, default: { cleanupExpiredOfflineMessages: jest.fn(), claimOfflineMessage: async () => undefined, findOneFromDB: async () => undefined } }));
const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const alice = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bob = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const unknown = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const envelope = (size: number) => ({ version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: 'x'.repeat(size) } });

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
        a.emit('chat-join', { userID: alice, channelID: room, controlCapability: 'a'.repeat(43) });
        b.emit('chat-join', { userID: bob, channelID: room, controlCapability: 'a'.repeat(43) });
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
    });
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
