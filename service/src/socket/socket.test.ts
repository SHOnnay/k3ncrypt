const mockSocket = {
    connected: true,
    on: jest.fn(),
    off: jest.fn(),
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

beforeAll(() => {
    (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
});

afterAll(() => {
    delete (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__;
});

const createLogger = (): any => {
    const logger: any = {
        log: jest.fn(),
        withInvocationId: jest.fn(() => logger),
        createChild: jest.fn(() => createLogger()),
    };
    return logger;
};

const handlerFor = (event: string): ((...args: unknown[]) => void) => {
    const registrations = mockSocket.on.mock.calls.filter(([name]) => name === event);
    if (!registrations.length) {
        throw new Error(`No handler registered for "${event}"`);
    }
    return (...args: unknown[]) => {
        for (const registration of registrations) (registration[1] as (...args: unknown[]) => void)(...args);
    };
};

describe('SocketInstance', () => {
    let logger: any;
    let subscription: SubscriptionType;
    const subscriptionContext = () => subscription;
    let onEnvelope: jest.Mock;
    const createInstance = () => new SocketIoRelayTransport(subscriptionContext, logger, onEnvelope);
    const joinTestRoom = async (instance: SocketIoRelayTransport): Promise<void> => {
        mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
            if (event === 'chat-join') ack?.({ status: 'accepted' });
        });
        await instance.join('room-a', 'alice', 'control-capability');
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket.connected = true;
        logger = createLogger();
        subscription = new Map();
        onEnvelope = jest.fn().mockResolvedValue(true);
    });

    describe('constructor', () => {
        it('connects to the base url provided by configContext', () => {
            createInstance();
            expect(socketIOClient).toHaveBeenCalledWith('http://localhost:3000/');
        });

        it('registers wire events and the authenticated reconnect handler', () => {
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
                    'connect',
                ]),
            );
            expect(mockSocket.on).toHaveBeenCalledTimes(8);
        });

        it('rejoins with a fresh proof before requesting mailbox replay after reconnect', async () => {
            const instance = createInstance();
            const acquire = jest.fn().mockResolvedValue({ deviceAuthorizationProof: {}, proofNonce: 'test-nonce' });
            instance.setDeviceProofProvider({ acquire });
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join' || event === 'mailbox-replay') ack?.({ status: 'accepted' });
            });
            await instance.join('room', 'route', 'capability');
            mockSocket.emit.mockClear();

            mockSocket.connected = false;
            handlerFor('disconnect')();
            expect(await instance.testOnlyRelayRegistration()).toMatchObject({ connected: false, joinAcknowledged: false });
            mockSocket.connected = true;
            handlerFor('connect')();
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(acquire).toHaveBeenCalledTimes(2);
            expect(mockSocket.emit.mock.calls.map(([event]) => event)).toEqual(['chat-join', 'mailbox-replay']);
            expect(await instance.testOnlyRelayRegistration()).toMatchObject({ connected: true, joinAcknowledged: true });
        });

        it('restores a persisted conversation through a fresh transport after browser reload', async () => {
            const instance = createInstance();
            const acquire = jest.fn().mockResolvedValue({ deviceAuthorizationProof: {}, proofNonce: 'fresh-nonce' });
            instance.setDeviceProofProvider({ acquire });
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join') ack?.({ status: 'accepted' });
            });

            // A page reload creates a new transport with no in-memory join
            // descriptor. Restoring the encrypted conversation calls join()
            // with its persisted descriptor and reacquires authorization.
            await instance.join('persisted-room', 'persisted-route', 'capability', 'routing-proof');

            expect(acquire).toHaveBeenCalledWith('relay:message', { conversationId: 'persisted-room' });
            expect(mockSocket.emit).toHaveBeenCalledWith('chat-join', expect.objectContaining({
                channelID: 'persisted-room',
                userID: 'persisted-route',
                controlCapability: 'capability',
                routingProof: 'routing-proof',
            }), expect.any(Function));
            expect(await instance.testOnlyRelayRegistration()).toMatchObject({ connected: true, joinAcknowledged: true });
        });

        it('advertises join-introduction support and uses only the peer features from the join acknowledgement', async () => {
            const instance = createInstance();
            instance.setProtocolFeatures(['join-introduction-v1']);
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join') ack?.({ status: 'accepted', peerFeatures: ['join-introduction-v1'] });
            });

            await instance.join('room', 'route', 'capability');

            expect(mockSocket.emit).toHaveBeenCalledWith('chat-join', expect.objectContaining({
                protocolFeatures: ['join-introduction-v1'],
            }), expect.any(Function));
            expect(instance.peerSupportsFeature('join-introduction-v1')).toBe(true);
            expect(instance.peerSupportsFeature('unrecognized-feature')).toBe(false);
        });

        it('keeps peers without introduction capability on the legacy first-message path', async () => {
            const instance = createInstance();
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join') ack?.({ status: 'accepted' });
            });

            await instance.join('room', 'route', 'capability');

            expect(instance.peerSupportsFeature('join-introduction-v1')).toBe(false);
        });

        it('waits for a socket connection before obtaining and sending the join proof', async () => {
            const instance = createInstance();
            const acquire = jest.fn().mockResolvedValue({ deviceAuthorizationProof: {}, proofNonce: 'fresh-nonce' });
            instance.setDeviceProofProvider({ acquire });
            mockSocket.connected = false;
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join') ack?.({ status: 'accepted' });
            });

            const joining = instance.join('room', 'route', 'capability');
            await Promise.resolve();
            expect(acquire).not.toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalledWith('chat-join', expect.anything(), expect.any(Function));

            mockSocket.connected = true;
            handlerFor('connect')();
            await joining;

            expect(acquire).toHaveBeenCalledTimes(1);
            expect(mockSocket.emit).toHaveBeenCalledWith('chat-join', expect.anything(), expect.any(Function));
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

        it('updates negotiated peer features from authenticated presence metadata', () => {
            const instance = createInstance();
            const callback = jest.fn();
            subscription.set('on-alice-join', new Set([callback]));

            handlerFor('on-alice-join')({ protocolFeatures: ['join-introduction-v1'] });

            expect(instance.peerSupportsFeature('join-introduction-v1')).toBe(true);
            expect(callback).toHaveBeenCalledWith({ protocolFeatures: ['join-introduction-v1'] });
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
            const instance = createInstance();
            await joinTestRoom(instance);
            const raw = { id: 'message-1', timestamp: 123, sender: 'alice', envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } };

            handlerFor('chat-message')(raw);
            await Promise.resolve();

            expect(onEnvelope).toHaveBeenCalledWith({
                conversationId: 'room-a',
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
            const instance = createInstance();
            await joinTestRoom(instance);

            handlerFor('chat-message')({ id: 'msg-1', timestamp: 1, sender: 'alice', envelope: {} });
            expect(mockSocket.emit).not.toHaveBeenCalledWith('received', expect.anything());

            accept(true);
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSocket.emit).toHaveBeenCalledWith('received', { id: 'msg-1' });
        });

        it('does not acknowledge rejected or malformed ciphertext', async () => {
            onEnvelope.mockResolvedValue(false);
            const instance = createInstance();
            await joinTestRoom(instance);

            handlerFor('chat-message')({ id: 'msg-2', timestamp: 1, sender: 'alice', envelope: {} });
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSocket.emit).not.toHaveBeenCalledWith('received', expect.anything());
        });
    });

    describe('incoming webrtc-session-description (still-encrypted, routed to onRawWebrtcSignal)', () => {
        it('hands the raw envelope to onRawWebrtcSignal', async () => {
            const instance = createInstance();
            await joinTestRoom(instance);
            const raw = { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } };

            handlerFor('webrtc-session-description')(raw);

            expect(onEnvelope).toHaveBeenCalledWith({ conversationId: 'room-a', channel: 'signaling', envelope: raw.envelope });
        });
    });

    describe('joinChat()', () => {
        it('emits "chat-join" with the room control capability but no message key', async () => {
            const payload = { channelID: 'chan-1', userID: 'alice', controlCapability: 'control-capability' };
            await createInstance().join(payload.channelID, payload.userID, payload.controlCapability);
            expect(mockSocket.emit).toHaveBeenCalledWith('chat-join', payload, expect.any(Function));
        });

        it('requires a fresh acknowledged join when switching conversations on one socket', async () => {
            const instance = createInstance();
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join' || event === 'mailbox-replay') ack?.({ status: 'accepted' });
            });
            await instance.join('room-a', 'route-a', 'capability');
            await instance.join('room-b', 'route-b', 'capability');
            await instance.requestMailboxReplay();
            expect(mockSocket.emit.mock.calls.filter(([event]) => event === 'chat-join').map(([, payload]) => (payload as { channelID: string }).channelID)).toEqual(['room-a', 'room-b']);
            expect(await instance.testOnlyRelayRegistration()).toMatchObject({ joinAcknowledged: true });
        });

        it('rejects replay when a switched conversation join is not acknowledged', async () => {
            const instance = createInstance();
            mockSocket.emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
                if (event === 'chat-join') ack?.(mockSocket.emit.mock.calls.filter(([name]) => name === 'chat-join').length === 1 ? { status: 'accepted' } : { error: 'join rejected' });
            });
            await instance.join('room-a', 'route-a', 'capability');
            await expect(instance.join('room-b', 'route-b', 'capability')).rejects.toThrow();
            await expect(instance.requestMailboxReplay()).rejects.toThrow('Authenticated relay channel join');
        });
    });

    describe('sendEnvelope(message)', () => {
        it('obtains and carries one fresh scoped proof for a protected message operation', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack?.({ id: 5, timestamp: 999 }));
            const instance = createInstance();
            const carrier = { deviceAuthorizationProof: { version: 1 as const, proofId: 'proof', accountIdentityReference: 'account', deviceId: 'device', deviceIdentityReference: 'identity', operation: 'relay:message', trustEpoch: 1, nonce: 'nonce', issuedAt: 1, expiresAt: Date.now() + 30_000, signature: 'signature' }, proofNonce: 'nonce' };
            const acquire = jest.fn().mockResolvedValue(carrier);
            instance.setDeviceProofProvider({ acquire });
            await instance.join('room', 'route', 'capability');

            await instance.sendEnvelope('message', { version: 1, strategy: 'test-strategy', data: {} });

            expect(acquire).toHaveBeenNthCalledWith(2, 'relay:message', { conversationId: 'room' });
            expect(mockSocket.emit).toHaveBeenCalledWith('chat-message', { envelope: { version: 1, strategy: 'test-strategy', data: {} }, ...carrier, proofOperation: 'relay:message' }, expect.any(Function));
        });

        it('emits "chat-message" with the envelope and resolves with the ack payload', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ id: 5, timestamp: 999 }));
            const instance = createInstance();
            await instance.join('room', 'route', 'capability');

            const result = await instance.sendEnvelope('message', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } });

            expect(mockSocket.emit).toHaveBeenCalledWith('chat-message', { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } }, expect.any(Function));
            expect(result).toEqual({ id: 5, timestamp: 999 });
        });

        it('rejects when the server ack carries an error', async () => {
            mockSocket.emit.mockImplementation((event, _payload, ack) => ack(event === 'chat-join' ? { status: 'accepted' } : { error: 'Rate limit exceeded' }));
            const instance = createInstance();
            await instance.join('room', 'route', 'capability');

            await expect(instance.sendEnvelope('message', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } })).rejects.toThrow('Rate limit exceeded');
        });
    });

    describe('sendEnvelope(signaling)', () => {
        it('emits "webrtc-signal" with the envelope', async () => {
            mockSocket.emit.mockImplementation((_event, _payload, ack) => ack({ status: 'ok' }));
            const instance = createInstance();
            await instance.join('room', 'route', 'capability');

            await instance.sendEnvelope('signaling', { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } });

            expect(mockSocket.emit).toHaveBeenCalledWith('webrtc-signal', { envelope: { version: 1, strategy: 'test-strategy', data: { iv: 'i', ct: 'c' } } }, expect.any(Function));
        });

        it('rejects when the server ack carries an error', async () => {
            mockSocket.emit.mockImplementation((event, _payload, ack) => ack(event === 'chat-join' ? { status: 'accepted' } : { error: 'No receiver is in the channel' }));
            const instance = createInstance();
            await instance.join('room', 'route', 'capability');

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
