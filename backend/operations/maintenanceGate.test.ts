import { createServer } from 'http';
import express from 'express';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { readFileSync } from 'fs';
import { maintenanceHttpGate, installMaintenanceSocketGuards, maintenanceModeEnabled } from './maintenanceGate';
import { socketOriginAdmission } from '../security/cors';

const SOCKET_PATHS = ['/socket.io', '/sync/socket.io', '/private-network/socket.io'];

describe('maintenance gate', () => {
  const previous = process.env.K3NCRYPT_MAINTENANCE_MODE;
  afterEach(() => {
    if (previous === undefined) delete process.env.K3NCRYPT_MAINTENANCE_MODE;
    else process.env.K3NCRYPT_MAINTENANCE_MODE = previous;
  });

  test.each([undefined, 'false', 'true', 'typo'])('maintenance mode is fail closed for config %s', (value) => {
    if (value === undefined) delete process.env.K3NCRYPT_MAINTENANCE_MODE;
    else process.env.K3NCRYPT_MAINTENANCE_MODE = value;
    expect(maintenanceModeEnabled()).toBe(value !== undefined && value !== 'false');
  });

  it('allows only health/ready probes and rejects HTTP writes and static requests while active', async () => {
    process.env.K3NCRYPT_MAINTENANCE_MODE = 'true';
    const app = express();
    app.use(maintenanceHttpGate);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/api/ready', (_req, res) => res.json({ status: 'ready' }));
    app.post('/api/message', (_req, res) => res.sendStatus(200));
    app.get('/', (_req, res) => res.send('client'));

    await request(app).get('/api/health').expect(200, { status: 'ok' });
    await request(app).get('/api/ready').expect(200, { status: 'ready' });
    await request(app).post('/api/message').expect('Retry-After', '60').expect(503, { error: 'maintenance' });
    await request(app).get('/').expect(503, { error: 'maintenance' });
    await request(app).options('/api/message').expect(503, { error: 'maintenance' });
  });

  test.each(SOCKET_PATHS)('rejects new Socket.IO handshakes on %s', async (path) => {
    process.env.K3NCRYPT_MAINTENANCE_MODE = 'true';
    const http = createServer();
    const io = new Server(http, { path, allowRequest: socketOriginAdmission });
    installMaintenanceSocketGuards(io);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const client = connect(`http://127.0.0.1:${address.port}`, { path, transports: ['websocket'], reconnection: false, timeout: 2_000 });
    try {
      const connected = await new Promise<boolean>((resolve) => {
        client.once('connect', () => resolve(true));
        client.once('connect_error', () => resolve(false));
      });
      expect(connected).toBe(false);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  it('disconnects an already-connected socket before its next event can mutate state', async () => {
    delete process.env.K3NCRYPT_MAINTENANCE_MODE;
    const http = createServer();
    const io = new Server(http, { path: '/socket.io', allowRequest: socketOriginAdmission });
    installMaintenanceSocketGuards(io);
    const write = jest.fn();
    io.on('connection', (socket) => socket.on('test-write', write));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const client: Socket = connect(`http://127.0.0.1:${address.port}`, { path: '/socket.io', transports: ['websocket'], reconnection: false, timeout: 2_000 });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      process.env.K3NCRYPT_MAINTENANCE_MODE = 'true';
      const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));
      client.emit('test-write', { opaque: true });
      await disconnected;
      expect(write).not.toHaveBeenCalled();
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  it('is installed on all production Socket.IO surfaces and sits before HTTP routes', () => {
    expect(readFileSync('app.ts', 'utf8').indexOf('app.use(maintenanceHttpGate)')).toBeLessThan(readFileSync('app.ts', 'utf8').indexOf('app.use("/api", apiController)'));
    for (const file of ['backend/socket.io/index.ts', 'backend/sync/relay.ts', 'backend/privateNetwork/relay.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('allowRequest: socketOriginAdmission');
      expect(source).toContain('installMaintenanceSocketGuards(io)');
    }
  });
});
