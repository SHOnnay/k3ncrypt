import socketIOClient, { type Socket } from 'socket.io-client';
import { configContext } from '../configContext';
import type { CryptoChannel, EncryptedEnvelope, Transport, TransportConnectionState, TransportEnvelopeHandler, TransportManager } from '../core/contracts';
import type { DeviceProofCarrier, DeviceResourceContext } from '../devices/trustProtocol';
import type { DeviceProofOperation } from '../devices/deviceProofClient';

export const MUX_RELAY_PROTOCOL_VERSION = 1;
export const MUX_RELAY_MAX_ROOMS = 128;
export type MuxDeviceProofProvider = { acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> };
type RoomConfig = { roomId: string; localRoutingAddress: string; peerRoutingAddress: string; controlCapability: string; routingProof: string; protocolFeatures: string[] };
type RoomState = RoomConfig & { manager: MultiplexedRoomTransportManager; handler?: TransportEnvelopeHandler; nonce?: string; expiresAt?: number; peerFeatures: Set<string>; renewalTimer?: ReturnType<typeof setTimeout>; joining?: Promise<void> };
type Ack = Record<string, unknown> & { error?: string };

const ALLOWED_FEATURES = new Set(['join-introduction-v1', 'room-message-v1']);
const strictFeatures = (features: readonly string[]): string[] => {
  if (features.some((item) => !ALLOWED_FEATURES.has(item)) || new Set(features).size !== features.length) throw new Error('Unsupported mux protocol feature.');
  return [...features];
};

/** One authenticated device socket shared by immutable room transport handles. */
export class MultiplexedRelayConnection {
  private readonly socket: Socket;
  private proofProvider?: MuxDeviceProofProvider;
  private readonly rooms = new Map<string, RoomState>();
  private authenticatedGeneration?: string;
  private authenticating?: Promise<void>;
  private disposed = false;

  constructor(socket?: Socket) {
    this.socket = socket ?? socketIOClient(`${configContext().baseUrl}/`);
    this.socket.on('disconnect', () => {
      this.authenticatedGeneration = undefined;
      for (const room of this.rooms.values()) {
        if (room.renewalTimer) clearTimeout(room.renewalTimer);
        room.renewalTimer = undefined;
        room.nonce = undefined;
        room.expiresAt = undefined;
        room.peerFeatures.clear();
      }
    });
    this.socket.on('connect', () => { void this.restoreRooms(); });
    // Stage 1B installs per-room dispatch on this same socket. Stage 1A deliberately
    // keeps subscriptions inert until the room acceptance path is bound.
  }

  public setDeviceProofProvider(provider: MuxDeviceProofProvider | undefined): void { this.proofProvider = provider; }

  public forRoom(roomId: string, peerRoutingAddress: string): MultiplexedRoomTransportManager {
    if (!roomId || !peerRoutingAddress) throw new Error('A mux room requires immutable room and peer routing IDs.');
    return new MultiplexedRoomTransportManager(this, roomId, peerRoutingAddress);
  }

  public async start(): Promise<void> { if (this.disposed) throw new Error('Mux relay connection is closed.'); }

  public async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const roomId of [...this.rooms.keys()]) await this.unsubscribe(roomId).catch(() => undefined);
    this.socket.disconnect();
  }

  public connectionState(): TransportConnectionState {
    if (this.disposed) return 'stopped';
    return this.socket.connected ? 'connected' : 'connecting';
  }

  public createRoom(roomId: string, peerRoutingAddress: string, manager: MultiplexedRoomTransportManager): void {
    if (this.rooms.has(roomId)) throw new Error('A mux room handle already exists for this room.');
    if (this.rooms.size >= MUX_RELAY_MAX_ROOMS) throw new Error('Mux room subscription limit reached.');
    this.rooms.set(roomId, { roomId, peerRoutingAddress, manager, localRoutingAddress: '', controlCapability: '', routingProof: '', protocolFeatures: [], peerFeatures: new Set() });
  }

  public setHandler(roomId: string, handler: TransportEnvelopeHandler | undefined): void {
    const room = this.requireRoom(roomId);
    room.handler = handler;
  }

  public setFeatures(roomId: string, features: readonly string[]): void { this.requireRoom(roomId).protocolFeatures = strictFeatures(features); }

  public async subscribe(roomId: string, localRoutingAddress: string, controlCapability: string, routingProof?: string): Promise<void> {
    const room = this.requireRoom(roomId);
    if (!localRoutingAddress || !controlCapability || !routingProof) throw new Error('Mux room authorization is incomplete.');
    room.localRoutingAddress = localRoutingAddress;
    room.controlCapability = controlCapability;
    room.routingProof = routingProof;
    if (room.joining) return room.joining;
    room.joining = this.subscribeState(room);
    try { await room.joining; } finally { room.joining = undefined; }
  }

  public async unsubscribe(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.renewalTimer) clearTimeout(room.renewalTimer);
    room.renewalTimer = undefined;
    const generation = this.socket.id;
    if (this.socket.connected && generation && this.authenticatedGeneration === generation && room.nonce) {
      await this.emitAck('mux-unsubscribe', { roomId, connectionGeneration: generation, subscriptionNonce: room.nonce });
    }
    this.rooms.delete(roomId);
  }

  public peerSupportsFeature(roomId: string, feature: string): boolean { return this.requireRoom(roomId).peerFeatures.has(feature); }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.proofProvider) throw new Error('Mux device authorization is unavailable.');
    await this.waitForConnect();
    const generation = this.socket.id;
    if (!generation) throw new Error('Mux connection generation is unavailable.');
    if (this.authenticatedGeneration === generation) return;
    if (this.authenticating) { await this.authenticating; if (this.authenticatedGeneration === this.socket.id) return; }
    const operation = (async () => {
      const proof = await this.proofProvider!.acquire('relay:connect', { connectionGeneration: generation });
      const response = await this.emitAck('mux-authenticate', { connectionGeneration: generation, ...proof, proofOperation: 'relay:connect' });
      if (response.status !== 'authenticated' || response.connectionGeneration !== generation || this.socket.id !== generation) throw new Error('Mux device authentication rejected.');
      this.authenticatedGeneration = generation;
    })();
    this.authenticating = operation;
    try { await operation; } finally { if (this.authenticating === operation) this.authenticating = undefined; }
  }

  private async subscribeState(room: RoomState): Promise<void> {
    await this.ensureAuthenticated();
    const generation = this.socket.id;
    if (!generation || this.authenticatedGeneration !== generation) throw new Error('Mux connection generation changed.');
    const resource = { conversationId: room.roomId, routingAddress: room.localRoutingAddress, peerRoutingAddress: room.peerRoutingAddress, connectionGeneration: generation };
    const proof = await this.proofProvider!.acquire('relay:subscribe', resource);
    const response = await this.emitAck('mux-subscribe', {
      version: MUX_RELAY_PROTOCOL_VERSION,
      roomId: room.roomId,
      routingAddress: room.localRoutingAddress,
      peerRoutingAddress: room.peerRoutingAddress,
      controlCapability: room.controlCapability,
      routingProof: room.routingProof,
      connectionGeneration: generation,
      protocolFeatures: room.protocolFeatures,
      ...proof,
      proofOperation: 'relay:subscribe',
    });
    if (response.status !== 'subscribed' || response.roomId !== room.roomId || response.connectionGeneration !== generation || typeof response.subscriptionNonce !== 'string' || !Number.isSafeInteger(response.expiresAt) || this.socket.id !== generation) {
      throw new Error('Mux room subscription rejected.');
    }
    room.nonce = response.subscriptionNonce;
    room.expiresAt = response.expiresAt as number;
    room.peerFeatures = new Set(Array.isArray(response.peerFeatures) ? response.peerFeatures.filter((item): item is string => typeof item === 'string' && ALLOWED_FEATURES.has(item)) : []);
    this.scheduleRenewal(room);
  }

  private scheduleRenewal(room: RoomState): void {
    if (room.renewalTimer) clearTimeout(room.renewalTimer);
    const delay = Math.max(1_000, (room.expiresAt ?? Date.now()) - Date.now() - 60_000);
    room.renewalTimer = setTimeout(() => {
      void this.subscribe(room.roomId, room.localRoutingAddress, room.controlCapability, room.routingProof).catch(() => undefined);
    }, delay);
  }

  private async restoreRooms(): Promise<void> {
    this.authenticatedGeneration = undefined;
    if (this.disposed || this.rooms.size === 0 || !this.proofProvider) return;
    try {
      await this.ensureAuthenticated();
      // Serial resubscription avoids bursting the shared device-proof API and
      // keeps each room's membership/control checks independent.
      for (const room of this.rooms.values()) {
        if (!room.localRoutingAddress || !room.controlCapability || !room.routingProof) continue;
        await this.subscribeState(room).catch(() => undefined);
      }
    } catch { /* A later socket reconnect or explicit room connect retries. */ }
  }

  private requireRoom(roomId: string): RoomState {
    const value = this.rooms.get(roomId);
    if (!value) throw new Error('Mux room handle is closed.');
    return value;
  }

  private async waitForConnect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Mux relay connection timed out.')), 15_000);
      const onConnect = (): void => finish();
      const onError = (): void => finish(new Error('Mux relay connection failed.'));
      const finish = (error?: Error): void => {
        clearTimeout(timeout);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
        if (error) reject(error); else resolve();
      };
      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
      if (this.socket.connected) finish();
    });
  }

  private emitAck(event: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, payload, (response: Ack) => {
        if (!response || typeof response !== 'object' || response.error) reject(new Error('Mux relay operation rejected.'));
        else resolve(response);
      });
    });
  }
}

/** Immutable adapter expected by ModernConversation for one room only. */
export class MultiplexedRoomTransportManager implements TransportManager, Transport {
  private closed = false;

  constructor(private readonly connection: MultiplexedRelayConnection, readonly roomId: string, private readonly peerRoutingAddress: string) {
    this.connection.createRoom(roomId, peerRoutingAddress, this);
  }

  public async start(): Promise<void> { if (this.closed) throw new Error('Mux room handle is closed.'); await this.connection.start(); }
  public async stop(): Promise<void> { await this.close(); }
  public async close(): Promise<void> { if (this.closed) return; this.closed = true; await this.connection.unsubscribe(this.roomId); }
  public async join(roomId: string, routingAddress: string, controlCapability: string, routingProof?: string): Promise<void> {
    if (roomId !== this.roomId || this.closed) throw new Error('Mux room handle cannot change its bound room.');
    await this.start();
    await this.connection.subscribe(this.roomId, routingAddress, controlCapability, routingProof);
  }
  public connect(routingAddress: string, controlCapability: string, routingProof?: string): Promise<void> { return this.join(this.roomId, routingAddress, controlCapability, routingProof); }
  public async sendEnvelope(_channel: CryptoChannel, _envelope: EncryptedEnvelope, _recipientRoutingId?: string, _proofOperation?: string): Promise<{ id?: string; timestamp?: number }> {
    throw new Error('Mux room delivery is not enabled until room-scoped dispatch is installed.');
  }
  public activeTransport(): Transport { return this; }
  public connectionState(): TransportConnectionState { return this.connection.connectionState(); }
  public capabilities() { return { envelopes: true, blobs: false, localOnly: false }; }
  public readonly requiresRoomMessageV1 = true;
  public peerSupportsFeature(feature: string): boolean { return this.connection.peerSupportsFeature(this.roomId, feature); }
  public setProtocolFeatures(features: readonly string[]): void { this.connection.setFeatures(this.roomId, features); }
  public setDeviceProofProvider(provider: MuxDeviceProofProvider | undefined): void { this.connection.setDeviceProofProvider(provider); }
  public setEnvelopeHandler(handler: TransportEnvelopeHandler | undefined): void { this.connection.setHandler(this.roomId, handler); }
}
