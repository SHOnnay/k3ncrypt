const mockSocket = {
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
};

const socketIOClient = jest.fn((..._args: unknown[]) => mockSocket);

jest.mock('socket.io-client', () => ({
    __esModule: true,
    default: (...args: unknown[]) => socketIOClient(...args),
}));

jest.mock('../configContext', () => ({
    configContext: () => ({ baseUrl: 'http://localhost:3000' }),
}));

import { SocketIoRelayTransport, SubscriptionType } from './socket';

const createLogger = (): any => {
    const logger: any = {
        log: jest.fn(),
        withInvocationId: jest.fn(() => logger),
        createChild: jest.fn(() => createLogger()),
    };
    return logger;
};

const handlerFor = (event: string): ((...args: unknown[]) => void) => {
    const registration = mockSocket.on.mock.calls.find(([name]) => name === event);
    if (!registration) {
        throw new Error(`No handler registered for "${event}"`);
    }
    return registration[1] as (...args: unknown[]) => void;
};

describe('SocketInstance', () => {
    let logger: any;
    let subscription: SubscriptionType;
    const subscriptionContext = () => subscription;
    let onEnvelope: jest.Mock;
    const createInstance = () => new SocketIoRelayTransport(subscriptionContext, logger, onEnvelope);

    beforeEach(() => {
        jest.clearAllMocks();
        logger = createLogger();
        subscription = new Map();
        onEnvelope = jest.fn().mockResolvedValue(true);
    });

    describe('constructor', () => {
        it('connects to the base url provided by configContext', () => {
            createInstance();
            expect(socketIOClient).toHaveBeenCalledWith('http://localhost:3000/');
        });

        it('registers a listener for each of the six wire events', () => {
            createInstance();
            const registeredEvents = mockSocket.on.mock.calls.map(([name]) => name);
            expect(registeredEvents).toEqual(
                expect.arrayContaining([
                    'limit-reached',
                    'delivered',
                    'on-alice-join',
                    'on-alice-disconnect',
                    'chat-message',
                    'webrtc-session-description',
                ]),
            );
            expect(mockSocket.on).toHaveBeenCalledTimes(6);
        });
    });

    describe('incoming events (unencrypted, no processing needed)', () => {
        it('forwards the event to a subscribed callback', () => {
            const callback = jest.fn();
            subscription.set('on-alice-join', new Set([callback]));
            createInstance();

            handlerFor('on-alice-join')(null);

            expect(callback).toHaveBeenCalledWith(null);
        });

        it('ignores events that have no subscribers', () => {
            createInstance();
            expect(() => handlerFor('delivered')('payload')).not.toThrow();
        });

        it('notifies every callback subscribed to the same event', () => {
            const first = jest.fn();
            const second = jest.fn();
            subscription.set('limit-reached', new Set([first, second]));
            createInstance();

            handlerFor('limit-reached')(null);

            expect(first).toHaveBeenCalled();
            expect(second).toHaveBeenCalled();
        });
    });

    describe('incoming chat-message (still-encrypted, routed to onRawChatMessage)', () => {
        it('hands an opaque transport envelope to the acceptance handler', async () => {
            createInstance();
            const raw = { id: 'message-1', timestamp: 123, sender: 'alice', envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } };

            handlerFor('chat-message')(raw);
            await Promise.resolve();

            expect(onEnvelope).toHaveBeenCalledWith({
                channel: 'message',
                envelope: raw.envelope,
                messageId: raw.id,
                senderRoutingId: raw.sender,
                timestamp: raw.timestamp,
            });
        });

        it('acknowledges only after authentication/protocol acceptance resolves true', async () => {
            let accept: (accepted: boolean) => void = () => undefined;
            onEnvelope.mockReturnValue(new Promise<boolean>((resolve) => { accept = resolve; }));
            createInstance();

            handlerFor('chat-message')({ id: 'msg-1', timestamp: 1, sender: 'alice', envelope: {} });
            expect(mockSocket.emit).not.toHaveBeenCalledWith('received', expect.anything());

            accept(true);
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSocket.emit).toHaveBeenCalledWith('received', { id: 'msg-1' });
        });

        it('does not acknowledge rejected or malformed ciphertext', async () => {
            onEnvelope.mockResolvedValue(false);
            createInstance();

            handlerFor('chat-message')({ id: 'msg-2', timestamp: 1, sender: 'alice', envelope: {} });
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSocket.emit).not.toHaveBeenCalledWith('received', expect.anything());
        });
    });

    describe('incoming webrtc-session-description (still-encrypted, routed to onRawWebrtcSignal)', () => {
        it('hands the raw envelope to onRawWebrtcSignal', () => {
            createInstance();
            const raw = { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } };

            handlerFor('webrtc-session-description')(raw);

            expect(onEnvelope).toHaveBeenCalledWith({ channel: 'signaling', envelope: raw.envelope });
        });
    });

    describe('joinChat()', () => {
        it('emits "chat-join" with only channelID/userID — no key material', () => {
            const payload = { channelID: 'chan-1', userID: 'alice' };
            createInstance().join(payload.channelID, payload.userID);
            expect(mockSocket.emit).toHaveBeenCalledWith('chat-join', payload);
        });
    });

    describe('sendEnvelope(message)', () => {
        it('emits "chat-message" with the envelope and resolves with the ack payload', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ id: 5, timestamp: 999 }));
            const instance = createInstance();

            const result = await instance.sendEnvelope('message', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat-message', { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } }, expect.any(Function));
            expect(result).toEqual({ id: 5, timestamp: 999 });
        });

        it('rejects when the server ack carries an error', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ error: 'Rate limit exceeded' }));
            const instance = createInstance();

            await expect(instance.sendEnvelope('message', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } })).rejects.toThrow('Rate limit exceeded');
        });
    });

    describe('sendEnvelope(signaling)', () => {
        it('emits "webrtc-signal" with the envelope', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ status: 'ok' }));
            const instance = createInstance();

            await instance.sendEnvelope('signaling', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } });

            expect(mockSocket.emit).toHaveBeenCalledWith('webrtc-signal', { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } }, expect.any(Function));
        });

        it('rejects when the server ack carries an error', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ error: 'No receiver is in the channel' }));
            const instance = createInstance();

            await expect(instance.sendEnvelope('signaling', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } })).rejects.toThrow('No receiver is in the channel');
        });
    });

    describe('stop()', () => {
        it('disconnects the socket', async () => {
            await createInstance().stop();
            expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
        });
    });
});
