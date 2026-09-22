import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { RateLimiter } from '../socket.io/rateLimiter';
import { allowedCorsOrigins } from '../security/cors';
import { operationalLog } from '../operations/logger';
import { markRelayReady } from '../operations/status';

export const PRIVATE_NETWORK_SOCKET_PATH = '/private-network/socket.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validAuth = (value: unknown): value is { networkId: string; deviceId: string } => !!value && typeof value === 'object' && UUID.test((value as { networkId?: string }).networkId ?? '') && UUID.test((value as { deviceId?: string }).deviceId ?? '');
const opaqueEnvelope = (value: unknown): boolean => !!value && typeof value === 'object' && JSON.stringify(value).length <= 196_608;

/** User-hostable blind relay. Peer admission and payload authentication occur inside the encrypted SDK session. */
export const initPrivateNetworkRelay = (http: HttpServer): Server => {
  const io = new Server(http, { path: PRIVATE_NETWORK_SOCKET_PATH, maxHttpBufferSize: 200 * 1024, allowEIO3: false, cors: { origin: allowedCorsOrigins(), credentials: false } });
  const routes = new Map<string, Map<string, Socket>>();
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth; if (!validAuth(auth)) { socket.disconnect(true); return; }
    const peers = routes.get(auth.networkId) ?? new Map<string, Socket>();
    if (peers.has(auth.deviceId) || peers.size >= 256) { socket.disconnect(true); return; }
    peers.set(auth.deviceId, socket); routes.set(auth.networkId, peers);
    const limiter = new RateLimiter({ capacity: 32, refillPerSecond: 8 });
    socket.on('private-network-envelope', (value: unknown, callback: unknown) => {
      const ack = typeof callback === 'function' ? callback as (value: { status: 'accepted' } | { error: 'unavailable' }) => void : undefined;
      const payload = value as { targetDeviceId?: unknown; envelope?: unknown };
      if (!limiter.consume(socket.id) || !payload || !UUID.test(payload.targetDeviceId as string) || payload.targetDeviceId === auth.deviceId || !opaqueEnvelope(payload.envelope)) { ack?.({ error: 'unavailable' }); return; }
      const target = routes.get(auth.networkId)?.get(payload.targetDeviceId as string);
      if (!target?.connected) { ack?.({ error: 'unavailable' }); return; }
      target.emit('private-network-envelope', { senderDeviceId: auth.deviceId, envelope: payload.envelope }); ack?.({ status: 'accepted' });
    });
    socket.on('disconnect', () => { const network = routes.get(auth.networkId); if (network?.get(auth.deviceId) === socket) network.delete(auth.deviceId); if (network?.size === 0) routes.delete(auth.networkId); });
  });
  markRelayReady('private-network'); operationalLog('info', 'private_network_relay_ready'); return io;
};
