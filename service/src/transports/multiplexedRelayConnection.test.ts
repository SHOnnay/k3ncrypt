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
    if (event === 'mux-subscribe') ack?.({ version: 1, status: 'subscribed', roomId: payload.roomId, connectionGeneration: payload.connectionGeneration, subscriptionNonce: payload.proofNonce, expiresAt: Date.now() + 300_000, peerFeatures: ['room-message-v1'] });
    if (event === 'mux-unsubscribe') ack?.({ status: 'unsubscribed', roomId: payload.roomId, connectionGeneration: payload.connectionGeneration });
    return this;
  }
  trigger(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
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
});
