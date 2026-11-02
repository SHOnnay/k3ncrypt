import { createServer, type Server as HttpServer } from 'http';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { initSocket } from './index';
import { MAX_SOCKETS_PER_ADDRESS } from './socketLimits';

// M3e: unauthenticated join/replay floods and connection floods are bounded per socket / per IP.
let http: HttpServer; let relay: Server; let url: string; const sockets: Socket[] = [];
beforeAll(async () => {
  process.env.K3NCRYPT_ALLOWED_ORIGINS = 'http://127.0.0.1';
  http = createServer(); relay = initSocket(http) as unknown as Server;
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No test port.');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { for (const socket of sockets) socket.disconnect(); await new Promise<void>(resolve => relay.close(() => resolve())); });
const client = async (): Promise<Socket> => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
};

it('rate-limits chat-join and mailbox-replay per socket', async () => {
  const socket = await client();
  const replies: unknown[] = [];
  for (let i = 0; i < 25; i++) replies.push(await socket.timeout(2_000).emitWithAck('chat-join', {}));
  expect(replies.filter((reply) => (reply as { error?: string }).error === 'Rate limit exceeded.').length).toBeGreaterThanOrEqual(10);
  const replay: unknown[] = [];
  for (let i = 0; i < 25; i++) replay.push(await socket.timeout(2_000).emitWithAck('mailbox-replay', {}));
  expect(replay.filter((reply) => (reply as { error?: string }).error === 'Rate limit exceeded.').length).toBeGreaterThanOrEqual(10);
});

it('caps concurrent sockets from one address and frees a slot on disconnect', async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await new Promise(resolve => setTimeout(resolve, 100));
  const open: Socket[] = [];
  for (let i = 0; i < MAX_SOCKETS_PER_ADDRESS; i++) open.push(await client());
  await expect(client()).rejects.toThrow();
  open[0].disconnect(); await new Promise(resolve => setTimeout(resolve, 100));
  await expect(client()).resolves.toBeDefined();
});
