import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { authorizeRoomControl, isValidControlCapability, isValidRoomId } from '../security/controlCapability';
import channelValid from '../api/chatHash/utils/validateChannel';
import { allowedCorsOrigins } from '../security/cors';
import { RateLimiter } from '../socket.io/rateLimiter';
import { markRelayReady } from '../operations/status';
import { operationalLog } from '../operations/logger';

export const SYNC_SOCKET_PATH = '/sync/socket.io';
export const MAX_SYNC_ENVELOPE_BYTES = 192 * 1024;
// Packet wrapper overhead is separate from the strict serialized-envelope bound.
export const MAX_SYNC_PACKET_BYTES = MAX_SYNC_ENVELOPE_BYTES + 1024;
const unavailable = { error: 'Synchronization unavailable.' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join('|') === keys.sort().join('|');

/** Shape validation only. Only the receiving CryptoSession can authenticate ciphertext. */
export const validSyncEnvelope = (value: unknown): boolean => {
    if (!record(value) || !exact(value, ['version', 'strategy', 'data']) || value.version !== 2 || value.strategy !== 'vodozemac-olm-v1' || !record(value.data) || !exact(value.data, ['version', 'olmMessage']) || value.data.version !== 1 || typeof value.data.olmMessage !== 'string' || value.data.olmMessage.length === 0) return false;
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_SYNC_ENVELOPE_BYTES;
};

/** Independent Engine.IO listener: legacy messaging/call packet and mailbox limits are untouched. */
export const initSyncRelay = (http: HttpServer): Server => {
    const io = new Server(http, { path: SYNC_SOCKET_PATH, maxHttpBufferSize: MAX_SYNC_PACKET_BYTES,
        cors: { origin: allowedCorsOrigins(), credentials: false }, allowEIO3: false });
    const routes = new Map<string, Map<string, Socket>>();
    markRelayReady('sync');
    operationalLog('info', 'sync_relay_ready');
    io.on('connection', (socket) => {
        const limiter = new RateLimiter({ capacity: 8, refillPerSecond: 4 });
        const auth = socket.handshake.auth as unknown;
        let bound = false;
        let busy = false;
        const permitted = async (): Promise<boolean> => {
            if (!record(auth) || !exact(auth, ['room', 'routingId', 'capability']) || !isValidRoomId(auth.room) || !isValidRoomId(auth.routingId) || !isValidControlCapability(auth.capability)) return false;
            return !!await authorizeRoomControl(auth.room, auth.capability) && (await channelValid(auth.room)).valid;
        };
        const ready = (async () => {
            if (!await permitted() || !socket.connected || !record(auth)) throw new Error('unavailable');
            const room = auth.room as string;
            const route = auth.routingId as string;
            const peers = routes.get(room) ?? new Map<string, Socket>();
            if (peers.size >= 2 || peers.has(route)) throw new Error('unavailable');
            peers.set(route, socket); routes.set(room, peers); bound = true;
            socket.emit('sync-ready');
        })();
        void ready.catch(() => socket.disconnect(true));
        socket.on('sync-envelope', async (payload: unknown, callback: unknown) => {
            if (typeof callback !== 'function') return;
            const ack = callback as (value: unknown) => void;
            if (busy || !limiter.consume(socket.id)) { ack(unavailable); return; }
            busy = true;
            try {
                await ready;
                if (!await permitted() || !record(auth) || !record(payload) || !exact(payload, ['recipientRoutingId', 'envelope']) || !isValidRoomId(payload.recipientRoutingId) || payload.recipientRoutingId === auth.routingId || !validSyncEnvelope(payload.envelope)) throw new Error('unavailable');
                const peer = routes.get(auth.room as string)?.get(payload.recipientRoutingId);
                if (!peer?.connected) throw new Error('unavailable');
                // This is a routing candidate, never a cryptographic sender identity.
                const response = await peer.timeout(10_000).emitWithAck('sync-envelope', { senderRoutingId: auth.routingId, envelope: payload.envelope });
                if (!record(response) || response.status !== 'accepted') throw new Error('unavailable');
                ack({ status: 'accepted' });
            } catch { ack(unavailable); }
            finally { busy = false; }
        });
        socket.on('disconnect', () => {
            if (!bound || !record(auth)) return;
            const peers = routes.get(auth.room as string);
            if (peers?.get(auth.routingId as string) === socket) peers.delete(auth.routingId as string);
            if (peers?.size === 0) routes.delete(auth.room as string);
        });
    });
    return io;
};
