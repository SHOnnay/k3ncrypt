import type { RequestHandler } from 'express';
import type { Server, Socket } from 'socket.io';

const MAINTENANCE_ENV = 'K3NCRYPT_MAINTENANCE_MODE';
const RETRY_AFTER_SECONDS = '60';

/** Missing/false means normal operation. Any other configured value fails closed. */
export const maintenanceModeEnabled = (): boolean => {
  const configured = process.env[MAINTENANCE_ENV];
  return configured !== undefined && configured !== 'false';
};

/** Permit only explicit non-mutating probes while maintenance is active. */
export const maintenanceHttpGate: RequestHandler = (request, response, next) => {
  if (!maintenanceModeEnabled()) return next();
  const safeProbe = (request.method === 'GET' || request.method === 'HEAD') &&
    (request.path === '/api/health' || request.path === '/api/ready');
  if (safeProbe) return next();
  response.setHeader('Retry-After', RETRY_AFTER_SECONDS);
  return response.status(503).json({ error: 'maintenance' });
};

/** Defense in depth for sockets that have already completed the transport handshake. */
export const installMaintenanceSocketGuards = (io: Server): void => {
  io.use((_socket, next) => {
    if (maintenanceModeEnabled()) return next(new Error('maintenance'));
    next();
  });
  io.on('connection', (socket: Socket) => {
    socket.use((_packet, next) => {
      if (!maintenanceModeEnabled()) return next();
      next(new Error('maintenance'));
      socket.disconnect(true);
    });
  });
};
