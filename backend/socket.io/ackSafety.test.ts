import { createServer, type Server as HttpServer } from 'http';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { initSocket } from './index';

// P1-1 (treated as P0): a client-chosen non-function ack must never reach a
// call site. Before the fix, `ack: Ack = noop` only defaulted on undefined, so
// emit('chat-message', {}, 'x') threw inside an async handler and the process
// exited on the unhandled rejection. Fail closed: drop the ack, keep serving.
const events = [
  'chat-join', 'mailbox-replay', 'chat-message', 'webrtc-signal', 'recipient-rejected', 'received',
  'mux-authenticate', 'mux-subscribe', 'mux-unsubscribe', 'mux-send-message', 'mux-send-signal', 'mux-mailbox-replay',
] as const;
const hostileAcks: unknown[] = ['x', 1, { call: 'x' }, ['x'], null, true];

let http: HttpServer; let relay: Server; let url: string; const sockets: Socket[] = [];
const rejections: unknown[] = []; const exceptions: unknown[] = [];
const onRejection = (reason: unknown) => { rejections.push(reason); };
const onException = (error: unknown) => { exceptions.push(error); };

beforeAll(async () => {
  process.env.K3NCRYPT_ALLOWED_ORIGINS = 'http://127.0.0.1';
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  http = createServer(); relay = initSocket(http) as unknown as Server;
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No test port.');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  process.off('unhandledRejection', onRejection); process.off('uncaughtException', onException);
  for (const socket of sockets) socket.disconnect();
  await new Promise<void>(resolve => relay.close(() => resolve()));
});
const client = async (): Promise<Socket> => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 150));

beforeEach(() => { rejections.length = 0; exceptions.length = 0; });
afterEach(() => { delete process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY; });

describe.each([['mux off (production default)', false], ['mux on', true]])('relay acknowledgement safety, %s', (_label, mux) => {
  beforeEach(() => { if (mux) process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY = 'true'; });
  it.each(events)('%s ignores non-function acknowledgements without crashing', async (event) => {
    const socket = await client();
    for (const value of hostileAcks) socket.emit(event, {}, value);
    socket.emit(event, 'not-an-object', 'x');
    await settle();
    expect(rejections).toEqual([]);
    expect(exceptions).toEqual([]);
    // mux-authenticate deliberately disconnects a malformed client; the relay itself must keep serving.
    const fresh = await client();
    const reply = await fresh.timeout(2_000).emitWithAck('chat-join', {});
    expect(reply).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });
});
