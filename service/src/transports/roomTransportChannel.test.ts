import type { EncryptedEnvelope, Transport, TransportManager } from '../core/contracts';
import { RoomTransportChannel } from './roomTransportChannel';

const makeManager = () => {
    const transport = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), join: jest.fn(async () => undefined), sendEnvelope: jest.fn(async () => ({ id: 'relay-id' })), connectionState: () => 'connected' as const, capabilities: () => ({ envelopes: true, blobs: false, localOnly: false }) } as unknown as Transport;
    const manager: TransportManager = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), join: jest.fn(async () => undefined), sendEnvelope: jest.fn(async () => ({ id: 'relay-id' })), activeTransport: () => transport };
    return { manager, transport };
};

it('connects and sends only through its immutable room binding', async () => {
    const { manager } = makeManager();
    const room = new RoomTransportChannel('room-a', manager);
    await room.connect('peer-a', 'capability-a', 'routing-proof-a');
    const envelope: EncryptedEnvelope = { version: 1, strategy: 'test', data: 'opaque' };
    await room.sendEnvelope('message', envelope, 'peer-a');
    expect(manager.join).toHaveBeenCalledWith('room-a', 'peer-a', 'capability-a', 'routing-proof-a');
    expect(manager.sendEnvelope).toHaveBeenCalledWith('message', envelope, 'peer-a', undefined);
    expect(() => room.join('room-b', 'peer-b', 'capability-b')).toThrow('different room');
});

it('refuses operations after close', async () => {
    const { manager } = makeManager();
    const room = new RoomTransportChannel('room-a', manager);
    await room.close();
    await expect(room.connect('peer-a', 'capability-a')).rejects.toThrow('closed');
    expect(() => room.sendEnvelope('message', { version: 1, strategy: 'test', data: 'opaque' })).toThrow('closed');
});
