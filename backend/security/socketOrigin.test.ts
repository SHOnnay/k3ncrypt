import { createServer } from 'http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { socketOriginAdmission } from './cors';
import { readFileSync } from 'fs';

describe('WebSocket Origin admission', () => {
  const original = process.env.K3NCRYPT_ALLOWED_ORIGINS;
  beforeEach(() => { process.env.K3NCRYPT_ALLOWED_ORIGINS = 'https://trusted.example.test'; });
  afterEach(() => { if (original === undefined) delete process.env.K3NCRYPT_ALLOWED_ORIGINS; else process.env.K3NCRYPT_ALLOWED_ORIGINS = original; });
  test.each([['https://trusted.example.test', true], ['https://disallowed.example.test', false], ['null', false], [undefined, true]])('Origin %s admission = %s', async (origin, expected) => {
    const http = createServer(); const server = new Server(http, { allowRequest: socketOriginAdmission });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
    const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], extraHeaders: origin === undefined ? {} : { Origin: origin }, reconnection: false, timeout: 2000 });
    try {
      const accepted = await new Promise<boolean>(resolve => { client.once('connect', () => resolve(true)); client.once('connect_error', () => resolve(false)); });
      expect(accepted).toBe(expected);
    } finally { client.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('applies admission to all existing relays', () => {
    for (const file of ['backend/socket.io/index.ts', 'backend/sync/relay.ts', 'backend/privateNetwork/relay.ts']) expect(readFileSync(file, 'utf8')).toContain('allowRequest: socketOriginAdmission');
  });
});
