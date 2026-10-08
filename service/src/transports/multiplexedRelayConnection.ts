import socketIOClient, { type Socket } from 'socket.io-client';
import { configContext } from '../configContext';
import type { CryptoChannel, EncryptedEnvelope, InboundTransportDecision, Transport, TransportConnectionState, TransportDeliveryStatusHandler, TransportEnvelopeHandler, TransportManager, TransportSendResult } from '../core/contracts';
import type { DeviceProofCarrier, DeviceResourceContext } from '../devices/trustProtocol';
import type { DeviceProofOperation } from '../devices/deviceProofClient';
import { testDiagnosticsEnabled } from '../utils/testDiagnostics';
import { ROOM_CALL_SIGNAL_V2_FEATURE } from '../calls/callSecurityPolicy';

export const MUX_RELAY_PROTOCOL_VERSION = 1;
export const MUX_RELAY_MAX_ROOMS = 128;
export type MuxDeviceProofProvider = { acquire(operation: DeviceProofOperation, resource?: DeviceResourceContext): Promise<DeviceProofCarrier> };
type RoomConfig = { roomId: string; localRoutingAddress: string; peerRoutingAddress: string; controlCapability: string; routingProof: string; protocolFeatures: string[] };
type RoomState = RoomConfig & { manager: MultiplexedRoomTransportManager; handler?: TransportEnvelopeHandler; nonce?: string; expiresAt?: number; peerFeatures: Set<string>; renewalTimer?: ReturnType<typeof setTimeout>; joining?: Promise<void> };
type Ack = Record<string, unknown> & { error?: string };

const ALLOWED_FEATURES = new Set(['join-introduction-v1', 'room-message-v1', ROOM_CALL_SIGNAL_V2_FEATURE]);
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
  private readonly diagnostics = { sendAttempts: 0, storedMessages: 0, receivedFrames: 0, acceptedFrames: 0, retryableFrames: 0, acceptedStatuses: 0, rejectedStatuses: 0, subscriptionProofAcquisitions: 0, subscriptionRenewals: 0 };

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
    this.socket.on('mux-envelope', (frame: unknown, ack?: (response: Record<string, unknown>) => void) => { void this.acceptEnvelope(frame, ack); });
    this.socket.on('mux-call-signal', (frame: unknown) => { void this.acceptCallSignal(frame); });
    this.socket.on('mux-peer-subscription', (payload: unknown) => this.acceptPeerSubscription(payload));
    this.socket.on('mux-delivery-status', (payload: unknown) => this.acceptDeliveryStatus(payload));
    this.socket.on('mux-room-suspended', (payload: unknown) => { void this.acceptRoomSuspended(payload); });
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

  public currentGeneration(): string | undefined {
    return this.socket.connected && this.authenticatedGeneration === this.socket.id ? this.socket.id : undefined;
  }

  public testOnlySnapshot(): { connected: boolean; authenticated: boolean; socketCount: number; roomSubscriptionCount: number; sendAttempts: number; storedMessages: number; receivedFrames: number; acceptedFrames: number; retryableFrames: number; acceptedStatuses: number; rejectedStatuses: number; subscriptionProofAcquisitions: number; subscriptionRenewals: number } {
    if (!testDiagnosticsEnabled()) throw new Error('Test-only diagnostics are disabled.');
    return { connected: this.socket.connected, authenticated: this.currentGeneration() !== undefined, socketCount: 1,
      roomSubscriptionCount: [...this.rooms.values()].filter((room) => !!room.nonce && (room.expiresAt ?? 0) > Date.now()).length, ...this.diagnostics };
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

  public setDeliveryStatusHandler(roomId: string, handler: TransportDeliveryStatusHandler | undefined): void {
    this.requireRoom(roomId).manager.setDeliveryStatusHandler(handler);
  }

  public setFeatures(roomId: string, features: readonly string[]): void {
    // Stage 1B intentionally admits only established ROOM_MESSAGE_V1 rooms.
    // Signed introductions remain on the legacy invitation path until their freshness window is enforced.
    this.requireRoom(roomId).protocolFeatures = strictFeatures(features.filter((feature) => feature !== 'join-introduction-v1'));
  }

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
    this.diagnostics.subscriptionProofAcquisitions += 1;
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
    await this.emitAck('mux-mailbox-replay', { version: MUX_RELAY_PROTOCOL_VERSION, roomId: room.roomId, connectionGeneration: generation, subscriptionNonce: room.nonce });
  }

  public sendEnvelope(roomId: string, channel: CryptoChannel, envelope: EncryptedEnvelope): Promise<{ id?: string; timestamp?: number; terminalRejection?: true }> {
    const room = this.requireRoom(roomId);
    if (channel === 'signaling') return this.sendCallSignal(room, envelope);
    if (!room.manager.requiresRoomMessageV1 || !room.peerFeatures.has('room-message-v1')) throw new Error('The peer has not negotiated room-message-v1 over the multiplexed relay.');
    return this.sendMuxEnvelope(room, envelope);
  }

  private async sendCallSignal(room: RoomState, envelope: EncryptedEnvelope): Promise<TransportSendResult> {
    if (!room.peerFeatures.has(ROOM_CALL_SIGNAL_V2_FEATURE)) throw new Error('The peer has not negotiated authenticated room call signaling over the multiplexed relay.');
    await this.ensureAuthenticated();
    const generation = this.socket.id;
    if (!generation || generation !== this.authenticatedGeneration || !room.nonce || !room.expiresAt || room.expiresAt <= Date.now() || !this.proofProvider) {
      throw new Error('An active room subscription is required before call signaling.');
    }
    const resource = { conversationId: room.roomId, routingAddress: room.localRoutingAddress,
      peerRoutingAddress: room.peerRoutingAddress, connectionGeneration: generation };
    const proof = await this.proofProvider.acquire('relay:signal', resource);
    const response = await this.emitAck('mux-send-signal', {
      version: MUX_RELAY_PROTOCOL_VERSION, roomId: room.roomId, envelope,
      ...proof, proofOperation: 'relay:signal',
    });
    if (response.status !== 'routed' || response.roomId !== room.roomId) throw new Error('Mux relay did not route the encrypted call signal.');
    return {};
  }

  private async acceptCallSignal(frame: unknown): Promise<void> {
    const body = frame as Record<string, unknown> | null;
    const room = body && typeof body.roomId === 'string' ? this.rooms.get(body.roomId) : undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !room || !room.handler ||
        Object.keys(body).sort().join('\0') !== ['connectionGeneration', 'envelope', 'recipientRoutingAddress', 'roomId', 'senderRoutingAddress', 'subscriptionNonce', 'version'].sort().join('\0') ||
        body.version !== MUX_RELAY_PROTOCOL_VERSION || body.roomId !== room.roomId ||
        body.recipientRoutingAddress !== room.localRoutingAddress || body.senderRoutingAddress !== room.peerRoutingAddress ||
        body.connectionGeneration !== this.socket.id || body.connectionGeneration !== this.authenticatedGeneration ||
        body.connectionGeneration !== room.manager.currentGeneration() || body.subscriptionNonce !== room.nonce ||
        !room.expiresAt || room.expiresAt <= Date.now() || !room.peerFeatures.has(ROOM_CALL_SIGNAL_V2_FEATURE) ||
        !body.envelope || typeof body.envelope !== 'object' || Array.isArray(body.envelope)) return;
    try {
      await room.handler({ conversationId: room.roomId, channel: 'signaling', envelope: body.envelope as EncryptedEnvelope,
        senderRoutingId: room.peerRoutingAddress });
    } catch { /* AuthenticatedCallSignalTransport owns the safe call failure state. */ }
  }

  private async sendMuxEnvelope(room: RoomState, envelope: EncryptedEnvelope): Promise<{ id?: string; timestamp?: number; terminalRejection?: true }> {
    this.diagnostics.sendAttempts += 1;
    await this.ensureAuthenticated();
    const generation = this.socket.id;
    if (!generation || generation !== this.authenticatedGeneration || !room.nonce || !room.expiresAt || room.expiresAt <= Date.now()) throw new Error('An active room subscription is required before sending.');
    if (!this.proofProvider) throw new Error('Mux device authorization is unavailable.');
    const proof = await this.proofProvider.acquire('relay:message', {
      conversationId: room.roomId,
      routingAddress: room.localRoutingAddress,
      peerRoutingAddress: room.peerRoutingAddress,
      connectionGeneration: generation,
    });
    const response = await this.emitAck('mux-send-message', {
      version: MUX_RELAY_PROTOCOL_VERSION,
      roomId: room.roomId,
      envelope,
      ...proof,
      proofOperation: 'relay:message',
    });
    if (response.terminalRejection === true && typeof response.id === 'string' && Number.isSafeInteger(response.timestamp)) {
      return { id: response.id, timestamp: response.timestamp as number, terminalRejection: true };
    }
    if (response.status !== 'stored' || typeof response.id !== 'string' || !Number.isSafeInteger(response.timestamp)) throw new Error('Mux relay did not durably accept the encrypted envelope.');
    this.diagnostics.storedMessages += 1;
    return { id: response.id, timestamp: response.timestamp as number, ...(response.terminalRejection === true ? { terminalRejection: true } : {}) };
  }

  private async acceptEnvelope(frame: unknown, ack?: (response: Record<string, unknown>) => void): Promise<void> {
    const body = frame as Record<string, unknown> | null;
    const room = body && typeof body.roomId === 'string' ? this.rooms.get(body.roomId) : undefined;
    this.diagnostics.receivedFrames += 1;
    const failure = (outcome: 'retryable' | 'permanent-rejection', reasonClass?: string): void => {
      if (!room || !body) return;
      ack?.({ outcome, ...(reasonClass ? { reasonClass } : {}), roomId: room.roomId, id: body.id,
        claimId: body.claimId, connectionGeneration: body.connectionGeneration, subscriptionNonce: body.subscriptionNonce });
    };
    if (!body || typeof body !== 'object' || Array.isArray(body) || !room || !room.handler ||
        Object.keys(body).sort().join('\0') !== ['claimId', 'connectionGeneration', 'envelope', 'id', 'recipientRoutingAddress', 'roomId', 'senderRoutingAddress', 'subscriptionNonce', 'timestamp', 'version'].sort().join('\0') ||
        body.version !== MUX_RELAY_PROTOCOL_VERSION || body.roomId !== room.roomId || body.recipientRoutingAddress !== room.localRoutingAddress ||
        body.senderRoutingAddress !== room.peerRoutingAddress || body.connectionGeneration !== this.socket.id ||
        body.connectionGeneration !== this.authenticatedGeneration || body.connectionGeneration !== room.manager.currentGeneration() ||
        body.subscriptionNonce !== room.nonce || !room.expiresAt || room.expiresAt <= Date.now() ||
        typeof body.id !== 'string' || typeof body.claimId !== 'string' || !Number.isSafeInteger(body.timestamp) ||
        !room.peerFeatures.has('room-message-v1') || !body.envelope || typeof body.envelope !== 'object' || Array.isArray(body.envelope)) {
      this.diagnostics.retryableFrames += 1;
      failure('retryable');
      return;
    }
    try {
      const result = await room.handler({ conversationId: room.roomId, channel: 'message', envelope: body.envelope as EncryptedEnvelope,
        messageId: body.id as string, senderRoutingId: room.peerRoutingAddress, timestamp: body.timestamp as number,
        mailboxClaimId: body.claimId as string });
      const decision: InboundTransportDecision = typeof result === 'boolean' ? (result ? { outcome: 'accepted' } : { outcome: 'retryable' }) : result;
      if (decision.outcome === 'permanent-rejection') failure('permanent-rejection', decision.reasonClass);
      else if (decision.outcome === 'accepted') {
        this.diagnostics.acceptedFrames += 1;
        ack?.({ outcome: 'accepted', roomId: room.roomId, id: body.id, claimId: body.claimId,
          connectionGeneration: body.connectionGeneration, subscriptionNonce: body.subscriptionNonce });
      } else { this.diagnostics.retryableFrames += 1; failure('retryable'); }
    } catch { this.diagnostics.retryableFrames += 1; failure('retryable'); }
  }

  private acceptDeliveryStatus(payload: unknown): void {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const body = payload as Record<string, unknown>;
    if (Object.keys(body).sort().join('\0') !== ['id', 'roomId', 'status', 'version'].sort().join('\0') || body.version !== MUX_RELAY_PROTOCOL_VERSION ||
        typeof body.roomId !== 'string' || typeof body.id !== 'string' || (body.status !== 'accepted' && body.status !== 'rejected')) return;
    const room = this.rooms.get(body.roomId);
    if (!room) return;
    if (body.status === 'accepted') this.diagnostics.acceptedStatuses += 1;
    else this.diagnostics.rejectedStatuses += 1;
    room.manager.dispatchDeliveryStatus(body.id, body.status);
  }

  private acceptPeerSubscription(payload: unknown): void {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const body = payload as Record<string, unknown>;
    if (Object.keys(body).sort().join('\0') !== ['connectionGeneration', 'peerFeatures', 'peerRoutingAddress', 'roomId', 'subscriptionNonce', 'version'].sort().join('\0') ||
        body.version !== MUX_RELAY_PROTOCOL_VERSION || typeof body.roomId !== 'string' || typeof body.connectionGeneration !== 'string' ||
        typeof body.subscriptionNonce !== 'string' || typeof body.peerRoutingAddress !== 'string' || !Array.isArray(body.peerFeatures) ||
        body.peerFeatures.some((feature) => typeof feature !== 'string' || !ALLOWED_FEATURES.has(feature)) || new Set(body.peerFeatures).size !== body.peerFeatures.length) return;
    const room = this.rooms.get(body.roomId);
    if (!room || body.connectionGeneration !== this.socket.id || body.connectionGeneration !== this.authenticatedGeneration ||
        body.subscriptionNonce !== room.nonce || body.peerRoutingAddress !== room.peerRoutingAddress || !room.expiresAt || room.expiresAt <= Date.now()) return;
    room.peerFeatures = new Set(body.peerFeatures as string[]);
  }

  private async acceptRoomSuspended(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const body = payload as Record<string, unknown>;
    if (Object.keys(body).sort().join('\0') !== ['connectionGeneration', 'roomId', 'subscriptionNonce', 'version'].sort().join('\0') ||
        body.version !== MUX_RELAY_PROTOCOL_VERSION || typeof body.roomId !== 'string' || typeof body.connectionGeneration !== 'string' || typeof body.subscriptionNonce !== 'string') return;
    const room = this.rooms.get(body.roomId);
    if (!room || body.connectionGeneration !== this.socket.id || body.connectionGeneration !== this.authenticatedGeneration || body.subscriptionNonce !== room.nonce) return;
    await this.unsubscribe(room.roomId).catch(() => undefined);
  }

  private scheduleRenewal(room: RoomState): void {
    if (room.renewalTimer) clearTimeout(room.renewalTimer);
    const delay = Math.max(1_000, (room.expiresAt ?? Date.now()) - Date.now() - 60_000);
    room.renewalTimer = setTimeout(() => {
      if (room.expiresAt && room.expiresAt > Date.now()) this.diagnostics.subscriptionRenewals += 1;
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
  private deliveryStatusHandler?: TransportDeliveryStatusHandler;

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
  public async sendEnvelope(channel: CryptoChannel, envelope: EncryptedEnvelope, recipientRoutingId?: string, _proofOperation?: string): Promise<TransportSendResult> {
    if (recipientRoutingId && recipientRoutingId !== this.peerRoutingAddress) throw new Error('Mux room recipient does not match its immutable peer route.');
    return this.connection.sendEnvelope(this.roomId, channel, envelope);
  }
  public activeTransport(): Transport { return this; }
  public connectionState(): TransportConnectionState { return this.connection.connectionState(); }
  public capabilities() { return { envelopes: true, blobs: false, localOnly: false }; }
  public readonly requiresRoomMessageV1 = true;
  public peerSupportsFeature(feature: string): boolean { return this.connection.peerSupportsFeature(this.roomId, feature); }
  public setProtocolFeatures(features: readonly string[]): void { this.connection.setFeatures(this.roomId, features); }
  public setDeviceProofProvider(provider: MuxDeviceProofProvider | undefined): void { this.connection.setDeviceProofProvider(provider); }
  public setEnvelopeHandler(handler: TransportEnvelopeHandler | undefined): void { this.connection.setHandler(this.roomId, handler); }
  public setDeliveryStatusHandler(handler: TransportDeliveryStatusHandler | undefined): void { this.deliveryStatusHandler = handler; }
  public dispatchDeliveryStatus(eventId: string, status: 'accepted' | 'rejected'): void { this.deliveryStatusHandler?.(eventId, status); }
  public currentGeneration(): string | undefined { return this.connection.currentGeneration(); }
}
