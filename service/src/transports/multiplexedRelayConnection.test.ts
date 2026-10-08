import type { Socket } from 'socket.io-client';
import { MultiplexedRelayConnection } from './multiplexedRelayConnection';
import type { DeviceProofOperation } from '../devices/deviceProofClient';
import type { DeviceResourceContext } from '../devices/trustProtocol';

class FakeSocket {
  connected = true;
  id = 'socket-generation-a';
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();
  readonly events: Array<{ event: string; payload: any }> = [];
  readonly disconnect = jest.fn(() => { this.connected = false; });
  on(event: string, listener: (...args: any[]) => void): this { const items = this.listeners.get(event) ?? new Set(); items.add(listener); this.listeners.set(event, items); return this; }
  off(event: string, listener: (...args: any[]) => void): this { this.listeners.get(event)?.delete(listener); return this; }
  emit(event: string, payload: any, ack?: (response: any) => void): this {
    this.events.push({ event, payload });
    if (event === 'mux-authenticate') ack?.({ version: 1, status: 'authenticated', connectionGeneration: payload.connectionGeneration });
    if (event === 'mux-subscribe') ack?.({ version: 1, status: 'subscribed', roomId: payload.roomId, connectionGeneration: payload.connectionGeneration, subscriptionNonce: payload.proofNonce, expiresAt: Date.now() + 300_000, peerFeatures: ['room-message-v1', 'room-call-signal-v2'] });
    if (event === 'mux-mailbox-replay') ack?.({ version: 1, status: 'accepted', roomId: payload.roomId });
    if (event === 'mux-send-message') ack?.({ version: 1, status: 'stored', id: 'message-id', timestamp: 123 });
    if (event === 'mux-send-signal') ack?.({ version: 1, status: 'routed', roomId: payload.roomId });
    if (event === 'mux-unsubscribe') ack?.({ status: 'unsubscribed', roomId: payload.roomId, connectionGeneration: payload.connectionGeneration });
    return this;
  }
  trigger(event: string, ...args: unknown[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
}

const proofProvider = () => {
  const requests: Array<{ operation: DeviceProofOperation; resource?: DeviceResourceContext }> = [];
  return {
    requests,
    acquire: jest.fn(async (operation: DeviceProofOperation, resource?: DeviceResourceContext) => {
      requests.push({ operation, resource });
      return { proofNonce: `nonce-${requests.length}`, deviceAuthorizationProof: { nonce: `nonce-${requests.length}` } } as never;
    }),
  };
};

const room = (suffix: string): string => `11111111-1111-4111-8111-${suffix.repeat(12)}`;

describe('multiplexed relay connection Stage 1A', () => {
  it('authenticates once and creates two independently bound room subscriptions on one socket', async () => {
    const socket = new FakeSocket();
    const connection = new MultiplexedRelayConnection(socket as unknown as Socket);
    const proofs = proofProvider();
    const roomA = room('1'); const roomB = room('2');
    const managerA = connection.forRoom(roomA, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const managerB = connection.forRoom(roomB, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    managerA.setDeviceProofProvider(proofs);
    managerB.setDeviceProofProvider(proofs);
    managerA.setProtocolFeatures(['room-message-v1']);
    managerB.setProtocolFeatures(['room-message-v1']);

    await managerA.join(roomA, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'control-a', 'routing-proof-a');
    await managerB.join(roomB, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'control-b', 'routing-proof-b');

    expect(socket.events.filter(({ event }) => event === 'mux-authenticate')).toHaveLength(1);
    expect(socket.events.filter(({ event }) => event === 'mux-subscribe').map(({ payload }) => payload.roomId)).toEqual([roomA, roomB]);
    const subscriptions = socket.events.filter(({ event }) => event === 'mux-subscribe').map(({ payload }) => payload);
    expect(subscriptions[0]).toMatchObject({ connectionGeneration: socket.id, roomId: roomA, routingAddress: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', peerRoutingAddress: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', proofOperation: 'relay:subscribe' });
    expect(subscriptions[1]).toMatchObject({ connectionGeneration: socket.id, roomId: roomB, routingAddress: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', peerRoutingAddress: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', proofOperation: 'relay:subscribe' });
    expect(proofs.requests).toEqual([
      { operation: 'relay:connect', resource: { connectionGeneration: socket.id } },
      { operation: 'relay:subscribe', resource: { conversationId: roomA, routingAddress: subscriptions[0].routingAddress, peerRoutingAddress: subscriptions[0].peerRoutingAddress, connectionGeneration: socket.id } },
      { operation: 'relay:subscribe', resource: { conversationId: roomB, routingAddress: subscriptions[1].routingAddress, peerRoutingAddress: subscriptions[1].peerRoutingAddress, connectionGeneration: socket.id } },
    ]);
    expect(managerA.peerSupportsFeature('room-message-v1')).toBe(true);
    await managerA.close();
    await managerB.close();
    await connection.close();
  });

  it('uses a new authentication proof and resubscribes each room after socket generation changes', async () => {
    const socket = new FakeSocket();
    const connection = new MultiplexedRelayConnection(socket as unknown as Socket);
    const proofs = proofProvider();
    const managerA = connection.forRoom(room('3'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const managerB = connection.forRoom(room('4'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    managerA.setDeviceProofProvider(proofs); managerB.setDeviceProofProvider(proofs);
    await managerA.join(room('3'), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'control-a', 'route-a');
    await managerB.join(room('4'), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'control-b', 'route-b');

    socket.connected = false; socket.trigger('disconnect');
    expect(managerA.peerSupportsFeature('room-message-v1')).toBe(false);
    socket.id = 'socket-generation-b'; socket.connected = true; socket.trigger('connect');
    await new Promise<void>((resolve) => setImmediate(resolve));

    const authEvents = socket.events.filter(({ event }) => event === 'mux-authenticate');
    const subscribeEvents = socket.events.filter(({ event }) => event === 'mux-subscribe');
    expect(authEvents.map(({ payload }) => payload.connectionGeneration)).toEqual(['socket-generation-a', 'socket-generation-b']);
    expect(subscribeEvents.slice(2).map(({ payload }) => payload.connectionGeneration)).toEqual(['socket-generation-b', 'socket-generation-b']);
    expect(proofs.requests.filter(({ operation }) => operation === 'relay:connect')).toHaveLength(2);
    expect(managerA.peerSupportsFeature('room-message-v1')).toBe(true);
    await connection.close();
  });

  it('updates an existing room when the peer subscribes after initial negotiation', async () => {
    const socket = new FakeSocket();
    const connection = new MultiplexedRelayConnection(socket as unknown as Socket);
    const proofs = proofProvider();
    const roomId = room('7');
    const peer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const manager = connection.forRoom(roomId, peer);
    manager.setDeviceProofProvider(proofs);
    manager.setProtocolFeatures(['room-message-v1']);
    await manager.join(roomId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'control', 'route-proof');
    expect(manager.peerSupportsFeature('room-message-v1')).toBe(true);
    const subscription = socket.events.find(({ event }) => event === 'mux-subscribe')!.payload;
    const peerJoined = { version: 1, roomId, connectionGeneration: socket.id, subscriptionNonce: subscription.proofNonce,
      peerRoutingAddress: peer, peerFeatures: [] };
    socket.trigger('mux-peer-subscription', { ...peerJoined, subscriptionNonce: 'stale-nonce' });
    expect(manager.peerSupportsFeature('room-message-v1')).toBe(true);
    socket.trigger('mux-peer-subscription', peerJoined);
    expect(manager.peerSupportsFeature('room-message-v1')).toBe(false);
    socket.trigger('mux-peer-subscription', { ...peerJoined, peerFeatures: ['room-message-v1'] });
    expect(manager.peerSupportsFeature('room-message-v1')).toBe(true);
    await connection.close();
  });

  it('sends only explicit room-bound V1 envelopes and routes acceptance to that room handler', async () => {
    const socket = new FakeSocket();
    const connection = new MultiplexedRelayConnection(socket as unknown as Socket);
    const proofs = proofProvider();
    const roomId = room('5');
    const peer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const local = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const manager = connection.forRoom(roomId, peer);
    manager.setDeviceProofProvider(proofs);
    manager.setProtocolFeatures(['join-introduction-v1', 'room-message-v1']);
    await manager.join(roomId, local, 'control', 'routing-proof');

    const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { opaque: true } };
    await expect(manager.sendEnvelope('message', envelope, peer)).resolves.toEqual({ id: 'message-id', timestamp: 123 });
    const send = socket.events.find(({ event }) => event === 'mux-send-message')!;
    expect(send.payload).toMatchObject({ version: 1, roomId, envelope, proofOperation: 'relay:message' });
    expect(proofs.requests[proofs.requests.length - 1]).toEqual({ operation: 'relay:message', resource: { conversationId: roomId, routingAddress: local, peerRoutingAddress: peer, connectionGeneration: socket.id } });
    await expect(manager.sendEnvelope('message', envelope, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rejects.toThrow('immutable peer route');
    await expect(manager.sendEnvelope('signaling', envelope, peer)).resolves.toEqual({});
    const signal = socket.events.find(({ event }) => event === 'mux-send-signal')!;
    expect(signal.payload).toMatchObject({ version: 1, roomId, envelope, proofOperation: 'relay:signal' });
    expect(proofs.requests[proofs.requests.length - 1]).toEqual({ operation: 'relay:signal', resource: { conversationId: roomId, routingAddress: local, peerRoutingAddress: peer, connectionGeneration: socket.id } });

    const receive = jest.fn(async () => ({ outcome: 'accepted' as const }));
    manager.setEnvelopeHandler(receive);
    const sub = socket.events.find(({ event }) => event === 'mux-subscribe')!.payload;
    socket.trigger('mux-call-signal', { version: 1, roomId, senderRoutingAddress: peer, recipientRoutingAddress: local,
      connectionGeneration: socket.id, subscriptionNonce: sub.proofNonce, envelope });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receive).toHaveBeenCalledWith({ conversationId: roomId, channel: 'signaling', envelope, senderRoutingId: peer });
    receive.mockClear();
    const frame = { version: 1, roomId, id: 'incoming-id', timestamp: 456, senderRoutingAddress: peer, recipientRoutingAddress: local,
      envelope, claimId: 'claim-id', connectionGeneration: socket.id, subscriptionNonce: sub.proofNonce };
    const acceptedAck = jest.fn();
    socket.trigger('mux-envelope', { ...frame, roomId: room('6') }, acceptedAck);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
    expect(acceptedAck).not.toHaveBeenCalled();

    const wrongRouteAck = jest.fn();
    socket.trigger('mux-envelope', { ...frame, senderRoutingAddress: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, wrongRouteAck);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
    expect(wrongRouteAck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'retryable', roomId, id: frame.id }));

    const goodAck = jest.fn();
    socket.trigger('mux-envelope', frame, goodAck);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ conversationId: roomId, senderRoutingId: peer, messageId: frame.id }));
    expect(goodAck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'accepted', roomId, id: frame.id, claimId: frame.claimId,
      connectionGeneration: socket.id, subscriptionNonce: sub.proofNonce }));
    await connection.close();
  });
});
