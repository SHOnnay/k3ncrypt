export type Ack = (response: Record<string, unknown>) => void;
const noop: Ack = () => undefined;

/** A client-chosen acknowledgement is untrusted input: only a real function is ever called. */
export const safeAck = (value: unknown): Ack => {
  if (typeof value !== 'function') return noop;
  return (response) => {
    try { (value as Ack)(response); } catch { /* A client callback failure must never reach the relay. */ }
  };
};

type SocketLike = { on(event: string, listener: (...args: unknown[]) => unknown): unknown };

/**
 * Registers a relay event whose handler can never crash the process. Every
 * synchronous throw and asynchronous rejection fails closed for that request
 * only: the client receives a generic error and the event payload is not logged.
 */
export const onSafe = <P>(socket: SocketLike, event: string, handler: (payload: P, ack: Ack) => unknown): void => {
  // Returns a promise that always settles fulfilled; Socket.IO ignores it, callers may await it.
  socket.on(event, (payload: unknown, rawAck: unknown): Promise<void> => {
    const ack = safeAck(rawAck);
    const fail = () => { console.error(`Relay ${event} handler failed.`); ack({ error: 'Request failed.' }); };
    return Promise.resolve().then(() => handler(payload as P, ack)).then(() => undefined, fail);
  });
};
