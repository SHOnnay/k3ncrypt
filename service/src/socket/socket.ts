/** Backward-compatible exports for consumers of the former socket module. */
export {
    SocketIoRelayTransport,
    SocketIoRelayTransport as SocketInstance,
} from '../transports/socketIoRelayTransport';
export type {
    RawChatMessage,
    RawSignalMessage,
    SocketListenerType,
    SubscriptionType,
} from '../transports/socketIoRelayTransport';
