import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server as HttpServer } from 'http';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { initSocket } from './index';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';
import * as durableTrust from '../security/durableDeviceTrust';
import { hashControlCapability } from '../security/controlCapability';

// RC1: a family shares one home IP and each Android phone holds up to 8 sockets (1 open + 7 background
// rooms). The cap is per proven device at chat-join (10), with a higher per-IP ceiling at connect.
const ROOMS_PER_PHONE = 8;
const PER_DEVICE = 10;
const account = 'family-account';
const rooms = new Map<string, { cap: string; route: string; routingProof: string }>();

let http: HttpServer; let relay: Server; let url: string; const sockets: Socket[] = [];
const spies: jest.SpyInstance[] = [];
beforeAll(async () => {
  process.env.K3NCRYPT_ALLOWED_ORIGINS = 'http://127.0.0.1';
  spies.push(jest.spyOn(db, 'getDatabase').mockReturnValue({ collection: () => ({
    findOne: async (query: { deviceId: string }) => ({ deviceId: query.deviceId, accountIdentityReference: account, trustEpoch: 1, state: 'active' }),
  }) } as never));
  spies.push(jest.spyOn(db, 'findOneFromDB').mockImplementation(async (query: Record<string, string>, collection: string) => {
    if (collection === 'links' && rooms.has(query.hash)) return { hash: query.hash, deleted: false, expired: false, controlCapabilityHash: hashControlCapability(rooms.get(query.hash)!.cap) } as never;
    const room = rooms.get(query.channel);
    if (collection === PREKEY_COLLECTION && room && query.address === room.route) return { channel: query.channel, address: room.route,
      renewalProofHash: createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${room.routingProof}`).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } as never;
    return undefined;
  }));
  spies.push(jest.spyOn(durableTrust, 'durableDeviceTrustAuthority').mockReturnValue({ verify: async (proof: { deviceId: string; accountIdentityReference: string }) => ({
    deviceId: proof.deviceId, accountIdentityReference: proof.accountIdentityReference, trustEpoch: 1, state: 'active',
  }) } as never));
  http = createServer(); relay = initSocket(http) as unknown as Server;
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No test port.');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise<void>(resolve => relay.close(() => resolve()));
  spies.forEach((spy) => spy.mockRestore());
});

const client = async (): Promise<Socket> => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
};
/** One background-room socket of a phone: its own room, its own routing identity, the phone's device proof. */
const joinRoom = async (socket: Socket, deviceId: string): Promise<{ status?: string; error?: string; code?: string }> => {
  const room = randomUUID(); const value = { cap: randomBytes(32).toString('base64url'), route: randomUUID(), routingProof: randomBytes(32).toString('base64url') };
  rooms.set(room, value);
  const nonce = randomUUID();
  return socket.timeout(5_000).emitWithAck('chat-join', { userID: value.route, channelID: room, controlCapability: value.cap, routingProof: value.routingProof,
    deviceAuthorizationProof: { deviceId, accountIdentityReference: account, trustEpoch: 1, nonce }, proofNonce: nonce });
};
const phone = async (deviceId: string, count: number): Promise<Socket[]> => {
  const open: Socket[] = [];
  for (let i = 0; i < count; i++) {
    const socket = await client();
    expect(await joinRoom(socket, deviceId)).toEqual(expect.objectContaining({ status: 'accepted' }));
    open.push(socket);
  }
  return open;
};

it('admits three phones with eight room sockets each from one IP', async () => {
  const phones = [randomUUID(), randomUUID(), randomUUID()];
  const open = (await Promise.all(phones.map((deviceId) => phone(deviceId, ROOMS_PER_PHONE)))).flat();
  expect(open.filter((socket) => socket.connected)).toHaveLength(3 * ROOMS_PER_PHONE);
});

it('refuses a device its eleventh room socket and frees the slot on disconnect', async () => {
  const deviceId = randomUUID();
  const open = await phone(deviceId, PER_DEVICE);
  const extra = await client();
  expect(await joinRoom(extra, deviceId)).toEqual({ error: 'Too many connections from this device.', code: 'device-socket-limit' });
  open[0].disconnect(); await new Promise(resolve => setTimeout(resolve, 100));
  const replacement = await client();
  expect(await joinRoom(replacement, deviceId)).toEqual(expect.objectContaining({ status: 'accepted' }));
});
