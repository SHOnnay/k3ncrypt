import type { IncomingMessage } from 'http';
import { RateLimiter } from './rateLimiter';

/**
 * M3e: bounds for socket events that previously had no limiter, and for concurrent sockets.
 * RC1: the real bound is per proven device (checked at chat-join, once the device proof is
 * verified); an Android phone holds up to 8 room sockets (1 open + 7 background). The per-address
 * ceiling only stops anonymous connection floods: a family or a carrier NAT shares one IP.
 */
export const MAX_SOCKETS_PER_ADDRESS = 64;
export const MAX_SOCKETS_PER_DEVICE = 10;
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

/** Concurrent-slot counter: admit returns a release function, or undefined when the key is at its cap. */
const slotCounter = (cap: number) => {
  const open = new Map<string, number>();
  return (key: string): (() => void) | undefined => {
    const count = open.get(key) ?? 0;
    if (count >= cap) return undefined;
    open.set(key, count + 1);
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = (open.get(key) ?? 1) - 1;
      if (next <= 0) open.delete(key); else open.set(key, next);
    };
  };
};
export const admitSocket = slotCounter(MAX_SOCKETS_PER_ADDRESS);
export const admitDeviceSocket = slotCounter(MAX_SOCKETS_PER_DEVICE);
