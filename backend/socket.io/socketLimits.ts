import type { IncomingMessage } from 'http';
import { RateLimiter } from './rateLimiter';

/**
 * M3e: bounds for socket events that previously had no limiter, and for concurrent sockets
 * per client address. A family shares one home IP: each device holds a few sockets.
 */
export const MAX_SOCKETS_PER_ADDRESS = 20;
/** chat-join and mailbox-replay: room admission and mailbox scans hit the database. */
export const controlEventLimiter = new RateLimiter({ capacity: 10, refillPerSecond: 1 });
/** received / recipient-rejected: one per delivered message; a 64-message replay must fit. */
export const deliveryAckLimiter = new RateLimiter({ capacity: 128, refillPerSecond: 20 });

/**
 * Same rule as Express `trust proxy 1`: with K3NCRYPT_TRUST_PROXY=true the nearest proxy's
 * appended X-Forwarded-For entry is the client; otherwise the TCP peer. Spoofed entries a client
 * prepends are ignored.
 */
export const clientAddress = (request: IncomingMessage): string => {
  if (process.env.K3NCRYPT_TRUST_PROXY === 'true') {
    const forwarded = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = value?.split(',').map((item) => item.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return request.socket.remoteAddress ?? 'unknown';
};

const openByAddress = new Map<string, number>();
/** Returns a release function, or undefined when the address is at its cap. */
export const admitSocket = (address: string): (() => void) | undefined => {
  const open = openByAddress.get(address) ?? 0;
  if (open >= MAX_SOCKETS_PER_ADDRESS) return undefined;
  openByAddress.set(address, open + 1);
  let released = false;
  return () => {
    if (released) return; released = true;
    const next = (openByAddress.get(address) ?? 1) - 1;
    if (next <= 0) openByAddress.delete(address); else openByAddress.set(address, next);
  };
};
