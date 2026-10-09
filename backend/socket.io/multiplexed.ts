import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { Server } from 'socket.io';
import db from '../db';
import { LINK_COLLECTION, PREKEY_COLLECTION } from '../db/const';
import { authorizeRoomControl, isValidControlCapability, isValidRoomId } from '../security/controlCapability';
import { durableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import type { DeviceAuthorizationProof, DeviceOperation, DeviceResourceContext } from '../security/deviceTrust';
import getClientInstance from './clients';
import type { CustomSocket, WireEnvelope } from './index';
import { RateLimiter } from './rateLimiter';

import { muxRelayEnabled } from '../security/muxFeatureGate';
export { muxRelayEnabled } from '../security/muxFeatureGate';

export const MUX_PROTOCOL_VERSION = 1;
export const MUX_MAX_ROOM_SUBSCRIPTIONS = 128;
const PRODUCTION_MUX_SUBSCRIPTION_LEASE_MS = 5 * 60_000;
const testMuxLeaseEnabled = process.env.NODE_ENV === 'test' ||
  (process.env.NODE_ENV === 'development' && process.env.K3NCRYPT_MUX_MESSAGE_DELIVERY === 'true');
const testMuxLeaseMs = testMuxLeaseEnabled ? Number(process.env.K3NCRYPT_TEST_MUX_SUBSCRIPTION_LEASE_MS) : NaN;
export const MUX_SUBSCRIPTION_LEASE_MS = Number.isSafeInteger(testMuxLeaseMs) && testMuxLeaseMs >= 2_000 && testMuxLeaseMs <= PRODUCTION_MUX_SUBSCRIPTION_LEASE_MS
  ? testMuxLeaseMs : PRODUCTION_MUX_SUBSCRIPTION_LEASE_MS;
const PRODUCTION_MUX_MAILBOX_LEASE_MS = 30_000;
const muxMailboxLeaseMs = (): number => {
  const testLeaseMs = testMuxLeaseEnabled ? Number(process.env.K3NCRYPT_TEST_MUX_MAILBOX_LEASE_MS) : NaN;
  return Number.isSafeInteger(testLeaseMs) && testLeaseMs >= 100 && testLeaseMs <= PRODUCTION_MUX_MAILBOX_LEASE_MS
    ? testLeaseMs : PRODUCTION_MUX_MAILBOX_LEASE_MS;
};
const MUX_DELIVERY_ACK_MS = 10_000;
const MUX_MAILBOX_RETRY_MARGIN_MS = 25;
const MUX_OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MUX_MAX_OFFLINE_PER_MAILBOX = 64;
const MUX_MAX_ENVELOPE_BYTES = 32 * 1024;
const MUX_MAX_PENDING_OPERATIONS = 64;
const FEATURES = new Set(['join-introduction-v1', 'room-message-v1', 'room-call-signal-v2']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MuxRoomSubscription = {
  readonly version: 1;
  readonly roomId: string;
  readonly routingAddress: string;
  readonly peerRoutingAddress: string;
  readonly connectionGeneration: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly controlCapability: string;
  readonly routingProof: string;
  readonly protocolFeatures: readonly string[];
};

type ProofCarrier = {
  deviceAuthorizationProof: DeviceAuthorizationProof;
  proofNonce: string;
  proofOperation: DeviceOperation;
};

type MuxServer = Pick<Server, 'sockets'>;
type DeviceSocket = { socketId: string; generation: string; socket: CustomSocket };
const deviceSockets = new Map<string, DeviceSocket>();
type OperationQueue = { tail: Promise<void>; pending: number };
const operationQueues = new WeakMap<CustomSocket, OperationQueue>();
const subscriptionTimers = new WeakMap<CustomSocket, Map<string, ReturnType<typeof setTimeout>>>();
const muxRoomSockets = new Map<string, Map<string, CustomSocket>>();
type MailboxPump = { socket: CustomSocket; subscription: MuxRoomSubscription; running: boolean; requested: boolean; timer?: ReturnType<typeof setTimeout> };
const mailboxPumps = new Map<string, MailboxPump>();
const clients = getClientInstance();
const muxOperationRateLimiter = new RateLimiter({ capacity: 160, refillPerSecond: 20 });

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const deviceKey = (account: string, device: string): string => `${account}\0${device}`;
const mailboxPumpKey = (roomId: string, mailbox: string): string => `${roomId}\0${mailbox}`;
const isCurrentMuxSocket = (socket: CustomSocket): boolean => !!socket.accountIdentityReference && !!socket.deviceId &&
  deviceSockets.get(deviceKey(socket.accountIdentityReference, socket.deviceId))?.socketId === socket.id;
const enqueue = (socket: CustomSocket, operation: () => Promise<void>, ack: (response: Record<string, unknown>) => void, failure: string): void => {
  if (!muxRelayEnabled()) { ack({ error: failure }); return; }
  if (!muxOperationRateLimiter.consume(socket.id)) { ack({ error: failure, code: 'rate-limited', retryable: true }); return; }
  const queue = operationQueues.get(socket) ?? { tail: Promise.resolve(), pending: 0 };
  if (queue.pending >= MUX_MAX_PENDING_OPERATIONS) { ack({ error: failure, code: 'backpressure', retryable: true }); return; }
  queue.pending += 1;
  const next = queue.tail.then(async () => {
    try {
      if (!muxRelayEnabled()) { ack({ error: failure }); return; }
      await operation();
    } catch { ack({ error: failure }); }
    finally { queue.pending -= 1; }
  });
  queue.tail = next;
  operationQueues.set(socket, queue);
};
const validFeatures = (value: unknown): value is string[] => Array.isArray(value) && value.length <= FEATURES.size &&
  value.every((feature) => typeof feature === 'string' && FEATURES.has(feature)) && new Set(value).size === value.length;

const activeBoundDevice = async (socket: CustomSocket): Promise<boolean> => {
  if (!socket.deviceId || !socket.accountIdentityReference || !Number.isInteger(socket.deviceTrustEpoch)) return false;
  try {
    const database = db.getDatabase();
    if (!database) return false;
    const record = await new MongoDeviceTrustStore(database).read(socket.accountIdentityReference, socket.deviceId);
    const active = record?.state === 'active' && record.trustEpoch === socket.deviceTrustEpoch;
    if (!active) invalidateMuxDeviceSocket(socket);
    return active;
  } catch { return false; }
};

const verifyMuxCarrier = async (
  socket: CustomSocket,
  carrier: ProofCarrier,
  operation: DeviceOperation,
  resource: DeviceResourceContext,
  bind: boolean,
): Promise<boolean> => {
  if (!carrier || carrier.proofOperation !== operation || carrier.proofNonce !== carrier.deviceAuthorizationProof?.nonce) return false;
  const authority = durableDeviceTrustAuthority(db.getDatabase());
  if (!authority) return false;
  try {
    const record = await authority.verify(carrier.deviceAuthorizationProof, operation, resource);
    if (socket.deviceId && (socket.deviceId !== record.deviceId || socket.accountIdentityReference !== record.accountIdentityReference)) return false;
    if (bind) {
      socket.deviceId = record.deviceId;
      socket.accountIdentityReference = record.accountIdentityReference;
      socket.deviceTrustEpoch = record.trustEpoch;
    }
    return true;
  } catch { return false; }
};

const currentSubscription = async (socket: CustomSocket, roomId: string): Promise<MuxRoomSubscription | undefined> => {
  if (!muxRelayEnabled()) return undefined;
  const subscription = socket.muxSubscriptions?.get(roomId);
  if (!subscription || subscription.expiresAt <= Date.now() || subscription.connectionGeneration !== socket.muxConnectionGeneration ||
      subscription.connectionGeneration !== socket.id || !isCurrentMuxSocket(socket) || socket.connected === false ||
      !await activeBoundDevice(socket) || !await authorizeRoomControl(roomId, subscription.controlCapability) ||
      !await authorizeRoutingAddress(roomId, subscription.routingAddress, subscription.routingProof) ||
      !await currentRouteRecord(roomId, subscription.peerRoutingAddress) || !(await channelValid(roomId)).valid) return undefined;
  return subscription;
};

const messageDedupeKey = (roomId: string, mailbox: string, sender: string, envelope: WireEnvelope): string =>
  createHash('sha256').update(JSON.stringify({ roomId, mailbox, sender, envelope })).digest('hex');

const notifyMuxSender = (roomId: string, routingAddress: string, id: string, status: 'accepted' | 'rejected'): void => {
  const sender = muxRoomSockets.get(roomId)?.get(routingAddress);
  if (sender?.connected !== false) sender?.emit('mux-delivery-status', { version: MUX_PROTOCOL_VERSION, roomId, id, status });
};

type MailboxBatchResult = { status: 'drained' | 'inactive' | 'batch-limit' } | { status: 'retry'; retryAt: number };

const locallyOwnsSubscription = (socket: CustomSocket, subscription: MuxRoomSubscription): boolean =>
  socket.connected !== false && socket.muxSubscriptions?.get(subscription.roomId) === subscription &&
  subscription.expiresAt > Date.now() && subscription.connectionGeneration === socket.id && isCurrentMuxSocket(socket);

const deliverMuxMailboxBatch = async (socket: CustomSocket, subscription: MuxRoomSubscription): Promise<MailboxBatchResult> => {
  for (let count = 0; count < MUX_MAX_OFFLINE_PER_MAILBOX; count += 1) {
    const current = await currentSubscription(socket, subscription.roomId);
    if (!current || current.nonce !== subscription.nonce) return { status: 'inactive' };
    const claimId = randomUUID();
    const leaseUntil = Date.now() + muxMailboxLeaseMs();
    const message = await db.claimOfflineMessage<{ id: string; timestamp: number; sender: string; envelope: WireEnvelope; mailbox: string; channel: string; claimId: string }>(
      current.routingAddress, current.roomId, new Date(leaseUntil), claimId);
    if (!message) {
      const claimedUntil = await db.offlineMessageClaimUntil(current.routingAddress, current.roomId);
      if (claimedUntil) return { status: 'retry', retryAt: claimedUntil.getTime() + MUX_MAILBOX_RETRY_MARGIN_MS };
      // A competing worker may have ACKed the head between our FIFO lookup
      // and claim CAS. If another row is now available, retry the new head
      // instead of mistaking that lost race for an empty mailbox.
      const pending = await db.countOfflineMessages({ mailbox: current.routingAddress, channel: current.roomId });
      return pending > 0
        ? { status: 'retry', retryAt: Date.now() + MUX_MAILBOX_RETRY_MARGIN_MS }
        : { status: 'drained' };
    }
    // Revocation can commit while the durable claim is in flight. Recheck at
    // the emission boundary so a stale socket cannot receive newly claimed
    // content; leaving the claim leased preserves safe retry after expiry.
    const authorized = await currentSubscription(socket, current.roomId);
    if (!authorized || authorized.nonce !== current.nonce) {
      return locallyOwnsSubscription(socket, subscription)
        ? { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS }
        : { status: 'inactive' };
    }
    const response = await new Promise<Record<string, unknown> | undefined>((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), MUX_DELIVERY_ACK_MS);
      socket.emit('mux-envelope', {
        version: MUX_PROTOCOL_VERSION, roomId: current.roomId, id: message.id, timestamp: message.timestamp,
        senderRoutingAddress: message.sender, recipientRoutingAddress: current.routingAddress, envelope: message.envelope,
        claimId: message.claimId, connectionGeneration: current.connectionGeneration, subscriptionNonce: current.nonce,
      }, (ack: unknown) => { clearTimeout(timeout); resolve(ack && typeof ack === 'object' && !Array.isArray(ack) ? ack as Record<string, unknown> : undefined); });
    });
    const accepted = response?.outcome === 'accepted' && response.roomId === current.roomId && response.id === message.id &&
      response.claimId === message.claimId && response.connectionGeneration === current.connectionGeneration && response.subscriptionNonce === current.nonce;
    if (response?.outcome === 'permanent-rejection' &&
        (response.reasonClass === 'authenticated-invalid' || response.reasonClass === 'unsupported-message' || response.reasonClass === 'identity-changed') &&
        response.roomId === current.roomId && response.id === message.id && response.claimId === message.claimId &&
        response.connectionGeneration === current.connectionGeneration && response.subscriptionNonce === current.nonce) {
      if (!await currentSubscription(socket, current.roomId)) {
        return locallyOwnsSubscription(socket, subscription)
          ? { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS }
          : { status: 'inactive' };
      }
      const result = await db.rejectOfflineMessage(message.id, current.routingAddress, current.roomId, message.claimId,
        response.reasonClass as 'authenticated-invalid' | 'unsupported-message' | 'identity-changed');
      if (result === 'stale') return { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS };
      if (result === 'rejected') {
        notifyMuxSender(current.roomId, message.sender, message.id, 'rejected');
        if (response.reasonClass === 'identity-changed') socket.emit('mux-room-suspended', {
          version: MUX_PROTOCOL_VERSION, roomId: current.roomId, connectionGeneration: current.connectionGeneration, subscriptionNonce: current.nonce,
        });
      }
      continue;
    }
    if (!accepted) return { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS };
    if (!await currentSubscription(socket, current.roomId)) {
      return locallyOwnsSubscription(socket, subscription)
        ? { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS }
        : { status: 'inactive' };
    }
    if (!await db.ackOfflineMessage(message.id, current.routingAddress, current.roomId, message.claimId)) {
      return { status: 'retry', retryAt: leaseUntil + MUX_MAILBOX_RETRY_MARGIN_MS };
    }
    notifyMuxSender(current.roomId, message.sender, message.id, 'accepted');
  }
  return { status: 'batch-limit' };
};

const scheduleMailboxPump = (key: string, pump: MailboxPump, delayMs: number): void => {
  if (pump.timer) clearTimeout(pump.timer);
  pump.timer = setTimeout(() => {
    pump.timer = undefined;
    pump.requested = true;
    startMailboxPump(key, pump);
  }, Math.max(1, delayMs));
  pump.timer.unref?.();
};

const startMailboxPump = (key: string, pump: MailboxPump): void => {
  if (pump.running) return;
  pump.running = true;
  void (async () => {
    try {
      while (pump.requested) {
        pump.requested = false;
        let result: MailboxBatchResult;
        try { result = await deliverMuxMailboxBatch(pump.socket, pump.subscription); }
        catch { result = { status: 'retry', retryAt: Date.now() + muxMailboxLeaseMs() + MUX_MAILBOX_RETRY_MARGIN_MS }; }
        if (result.status === 'retry') {
          if (pump.requested) continue;
          if (locallyOwnsSubscription(pump.socket, pump.subscription)) scheduleMailboxPump(key, pump, result.retryAt - Date.now());
          return;
        }
        if (result.status === 'batch-limit') {
          if (pump.requested) continue;
          scheduleMailboxPump(key, pump, 1);
          return;
        }
        if (result.status === 'inactive' && !pump.requested) return;
      }
    } finally {
      pump.running = false;
      if (pump.requested) startMailboxPump(key, pump);
      else if (!pump.timer && mailboxPumps.get(key) === pump) mailboxPumps.delete(key);
    }
  })();
};

const requestMuxMailboxDelivery = (socket: CustomSocket, subscription: MuxRoomSubscription): void => {
  const key = mailboxPumpKey(subscription.roomId, subscription.routingAddress);
  const pump = mailboxPumps.get(key) ?? { socket, subscription, running: false, requested: false };
  if (pump.timer) { clearTimeout(pump.timer); pump.timer = undefined; }
  pump.socket = socket;
  pump.subscription = subscription;
  pump.requested = true;
  mailboxPumps.set(key, pump);
  startMailboxPump(key, pump);
};

const cancelMailboxPump = (socket: CustomSocket, roomId: string): void => {
  const subscription = socket.muxSubscriptions?.get(roomId);
  const key = mailboxPumpKey(roomId, subscription?.routingAddress ?? '');
  const pump = mailboxPumps.get(key);
  if (!pump || pump.socket !== socket) return;
  if (pump.timer) clearTimeout(pump.timer);
  pump.timer = undefined;
  pump.requested = false;
  if (!pump.running) mailboxPumps.delete(key);
};

const currentRouteRecord = async (roomId: string, address: string): Promise<boolean> => {
  const record = await db.findOneFromDB<{ expiresAt?: Date }>({ channel: roomId, address }, PREKEY_COLLECTION);
  return record?.expiresAt instanceof Date && record.expiresAt.getTime() > Date.now();
};

const authorizeRoutingAddress = async (roomId: string, address: string, proof: unknown): Promise<boolean> => {
  const record = await db.findOneFromDB<{ renewalProofHash?: string; expiresAt?: Date }>({ channel: roomId, address }, PREKEY_COLLECTION);
  if (!record || !(record.expiresAt instanceof Date) || record.expiresAt.getTime() <= Date.now() || typeof proof !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(proof) || !/^[0-9a-f]{64}$/.test(record.renewalProofHash ?? '')) return false;
  const supplied = createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest();
  const expected = Buffer.from(record.renewalProofHash!, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const removeSubscription = (socket: CustomSocket, subscription: MuxRoomSubscription): void => {
  if (socket.muxSubscriptions?.get(subscription.roomId) !== subscription) return;
  cancelMailboxPump(socket, subscription.roomId);
  socket.muxSubscriptions.delete(subscription.roomId);
  const timers = subscriptionTimers.get(socket);
  const timer = timers?.get(subscription.roomId);
  if (timer) clearTimeout(timer);
  timers?.delete(subscription.roomId);
  const roomSockets = muxRoomSockets.get(subscription.roomId);
  if (roomSockets?.get(subscription.routingAddress) === socket) roomSockets.delete(subscription.routingAddress);
  if (roomSockets?.size === 0) muxRoomSockets.delete(subscription.roomId);
};

const invalidateMuxDeviceSocket = (socket: CustomSocket): void => {
  const subscriptions = socket.muxSubscriptions;
  if (subscriptions) for (const subscription of [...subscriptions.values()]) removeSubscription(socket, subscription);
  if (socket.accountIdentityReference && socket.deviceId) {
    const key = deviceKey(socket.accountIdentityReference, socket.deviceId);
    if (deviceSockets.get(key)?.socketId === socket.id) deviceSockets.delete(key);
  }
  socket.disconnect(true);
};

/** Ejects the revoked device's live relay socket immediately after durable revocation. */
export const revokeMuxDeviceSubscriptions = (accountIdentityReference: string, deviceId: string): void => {
  const key = deviceKey(accountIdentityReference, deviceId);
  const current = deviceSockets.get(key);
  if (!current) return;
  deviceSockets.delete(key);
  invalidateMuxDeviceSocket(current.socket);
};

/** Counts legacy and mux routes together without putting mux sockets in the legacy delivery table. */
export const muxWouldExceedChannelCapacity = (routingAddress: string, roomId: string, capacity: number): boolean => {
  if (!routingAddress || !roomId || !Number.isInteger(capacity) || capacity < 1) return true;
  const routes = new Set(Object.keys(clients.getClientsByChannel(roomId)));
  for (const address of muxRoomSockets.get(roomId)?.keys() ?? []) routes.add(address);
  return routes.size >= capacity && !routes.has(routingAddress);
};

/** Returns whether a room currently has a live legacy delivery owner. Stale
 * routing entries are removed before the ownership decision is made. */
export const hasActiveLegacyRoomOwner = (roomId: string, io: MuxServer): boolean => {
  for (const [routingAddress, route] of Object.entries(clients.getClientsByChannel(roomId))) {
    const socket = io.sockets.sockets.get(route.sid) as CustomSocket | undefined;
    if (socket && socket.connected !== false && socket.userID === routingAddress && socket.channelID === roomId) return true;
    clients.deleteClient(routingAddress, roomId, route.sid);
  }
  return false;
};

/** Returns whether any live Mux subscription currently owns delivery in a room. */
export const hasActiveMuxRoomOwner = (roomId: string): boolean => {
  const roomSockets = muxRoomSockets.get(roomId);
  if (!roomSockets) return false;
  for (const [routingAddress, socket] of roomSockets) {
    const subscription = socket.muxSubscriptions?.get(roomId);
    if (socket.connected !== false && subscription?.roomId === roomId && subscription.routingAddress === routingAddress &&
        subscription.connectionGeneration === socket.id && isCurrentMuxSocket(socket)) return true;
    if (subscription) removeSubscription(socket, subscription);
    else roomSockets.delete(routingAddress);
  }
  if (roomSockets.size === 0) muxRoomSockets.delete(roomId);
  return false;
};

const scheduleSubscriptionExpiry = (socket: CustomSocket, subscription: MuxRoomSubscription): void => {
  const timers = subscriptionTimers.get(socket) ?? new Map<string, ReturnType<typeof setTimeout>>();
  subscriptionTimers.set(socket, timers);
  const previous = timers.get(subscription.roomId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    if (socket.muxSubscriptions?.get(subscription.roomId) === subscription && subscription.expiresAt <= Date.now()) {
      removeSubscription(socket, subscription);
    }
  }, Math.max(0, subscription.expiresAt - Date.now()));
  timer.unref?.();
  timers.set(subscription.roomId, timer);
};

/** Adds device-scoped authentication and immutable, room-scoped subscriptions to a socket. */
export const registerMultiplexedRelay = (socket: CustomSocket, io: MuxServer): void => {
  if (!muxRelayEnabled()) return;
  socket.on('mux-authenticate', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const generation = socket.id;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !exactKeys(body, ['connectionGeneration', 'deviceAuthorizationProof', 'proofNonce', 'proofOperation']) ||
        body.connectionGeneration !== generation || !await verifyMuxCarrier(socket, body as unknown as ProofCarrier, 'relay:connect', { connectionGeneration: generation }, true)) {
      ack({ error: 'Relay authentication rejected.' });
      socket.disconnect(true);
      return;
    }
    if (!socket.deviceId || !socket.accountIdentityReference) {
      ack({ error: 'Relay authentication rejected.' });
      socket.disconnect(true);
      return;
    }
    const key = deviceKey(socket.accountIdentityReference, socket.deviceId);
    const previous = deviceSockets.get(key);
    deviceSockets.set(key, { socketId: socket.id, generation, socket });
    socket.muxConnectionGeneration = generation;
    socket.muxSubscriptions ??= new Map();
    if (previous && previous.socketId !== socket.id) io.sockets.sockets.get(previous.socketId)?.disconnect(true);
    ack({ version: MUX_PROTOCOL_VERSION, status: 'authenticated', connectionGeneration: generation });
  }, ack, 'Relay authentication rejected.'));

  socket.on('mux-subscribe', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const generation = socket.muxConnectionGeneration;
    const roomId = body?.roomId;
    const routingAddress = body?.routingAddress;
    const peerRoutingAddress = body?.peerRoutingAddress;
    const resource: DeviceResourceContext = {
      conversationId: roomId as string,
      routingAddress: routingAddress as string,
      peerRoutingAddress: peerRoutingAddress as string,
      connectionGeneration: generation,
    };
    const reject = (): void => ack({ error: 'Room subscription rejected.' });
    if (!generation || generation !== socket.id || !body || typeof body !== 'object' || Array.isArray(body) ||
        !exactKeys(body, ['connectionGeneration', 'controlCapability', 'deviceAuthorizationProof', 'peerRoutingAddress', 'proofNonce', 'proofOperation', 'protocolFeatures', 'roomId', 'routingAddress', 'routingProof', 'version']) ||
        body.version !== MUX_PROTOCOL_VERSION || body.connectionGeneration !== generation || !isValidRoomId(roomId) ||
        !isValidRoomId(routingAddress) || !isValidRoomId(peerRoutingAddress) || routingAddress === peerRoutingAddress || !isValidControlCapability(body.controlCapability) ||
        typeof body.routingProof !== 'string' || !validFeatures(body.protocolFeatures) || !await activeBoundDevice(socket) || !isCurrentMuxSocket(socket)) {
      reject();
      return;
    }
    if (!await authorizeRoomControl(roomId, body.controlCapability) ||
        !await authorizeRoutingAddress(roomId, routingAddress, body.routingProof) ||
        !await currentRouteRecord(roomId, peerRoutingAddress)) {
      reject();
      return;
    }
    const { valid } = await channelValid(roomId);
    if (!valid) { reject(); return; }
    const subscriptions = socket.muxSubscriptions ??= new Map();
    if (!subscriptions.has(roomId) && subscriptions.size >= MUX_MAX_ROOM_SUBSCRIPTIONS) { reject(); return; }
    if (!await verifyMuxCarrier(socket, body as unknown as ProofCarrier, 'relay:subscribe', resource, false) || !await activeBoundDevice(socket) ||
        !isCurrentMuxSocket(socket) || socket.connected === false || socket.muxConnectionGeneration !== generation) {
      reject();
      return;
    }
    // A room uses one delivery plane at a time. Do not let a Mux subscription
    // coexist with a live legacy room listener; the durable mailbox remains
    // the handoff path after the incumbent transport disconnects.
    if (hasActiveLegacyRoomOwner(roomId, io)) { reject(); return; }
    if (muxWouldExceedChannelCapacity(routingAddress, roomId, 2)) { reject(); return; }
    const existingRouteSocket = muxRoomSockets.get(roomId)?.get(routingAddress);
    if (existingRouteSocket && existingRouteSocket !== socket && existingRouteSocket.connected !== false) { reject(); return; }
    const proof = body.deviceAuthorizationProof as DeviceAuthorizationProof;
    const next: MuxRoomSubscription = Object.freeze({
      version: MUX_PROTOCOL_VERSION,
      roomId,
      routingAddress,
      peerRoutingAddress,
      connectionGeneration: generation,
      nonce: proof.nonce,
      expiresAt: Math.min(proof.expiresAt, Date.now() + MUX_SUBSCRIPTION_LEASE_MS),
      controlCapability: body.controlCapability,
      routingProof: body.routingProof,
      protocolFeatures: Object.freeze([...body.protocolFeatures as string[]]),
    });
    const previous = subscriptions.get(roomId);
    if (previous) removeSubscription(socket, previous);
    subscriptions.set(roomId, next);
    const roomSockets = muxRoomSockets.get(roomId) ?? new Map<string, CustomSocket>();
    muxRoomSockets.set(roomId, roomSockets);
    roomSockets.set(routingAddress, socket);
    scheduleSubscriptionExpiry(socket, next);
    const peer = roomSockets.get(peerRoutingAddress) ?? (() => {
      const peerSid = clients.getSIDByIDs(peerRoutingAddress, roomId)?.sid;
      return peerSid ? io.sockets.sockets.get(peerSid) as CustomSocket | undefined : undefined;
    })();
    const peerMux = peer?.muxSubscriptions?.get(roomId);
    const peerFeatures = peerMux?.routingAddress === peerRoutingAddress && peerMux.peerRoutingAddress === routingAddress
      ? peerMux.protocolFeatures
      : peer && peer.userID === peerRoutingAddress && peer.channelID === roomId ? peer.protocolFeatures ?? [] : [];
    // A subscription may arrive after the other endpoint subscribed. Notify
    // that already-subscribed endpoint so its room capability view converges;
    // otherwise feature negotiation depends on which device subscribed first.
    if (peerMux?.routingAddress === peerRoutingAddress && peerMux.peerRoutingAddress === routingAddress && peer) {
      peer.emit('mux-peer-subscription', {
        version: MUX_PROTOCOL_VERSION,
        roomId,
        connectionGeneration: peerMux.connectionGeneration,
        subscriptionNonce: peerMux.nonce,
        peerRoutingAddress: routingAddress,
        peerFeatures: next.protocolFeatures,
      });
    }
    ack({ version: MUX_PROTOCOL_VERSION, status: 'subscribed', roomId, connectionGeneration: generation,
      subscriptionNonce: next.nonce, expiresAt: next.expiresAt, peerFeatures });
  }, ack, 'Room subscription rejected.'));

  socket.on('mux-unsubscribe', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const roomId = body?.roomId;
    const subscription = typeof roomId === 'string' ? socket.muxSubscriptions?.get(roomId) : undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !exactKeys(body, ['connectionGeneration', 'roomId', 'subscriptionNonce']) ||
        !subscription || body.connectionGeneration !== socket.muxConnectionGeneration || body.connectionGeneration !== socket.id ||
        body.subscriptionNonce !== subscription.nonce || !await activeBoundDevice(socket) || !isCurrentMuxSocket(socket)) {
      ack({ error: 'Room unsubscribe rejected.' });
      return;
    }
    removeSubscription(socket, subscription);
    ack({ status: 'unsubscribed', roomId, connectionGeneration: socket.id });
  }, ack, 'Room unsubscribe rejected.'));

  socket.on('mux-send-message', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const roomId = body?.roomId;
    const subscription = typeof roomId === 'string' ? await currentSubscription(socket, roomId) : undefined;
    const reject = (): void => ack({ error: 'Multiplexed message rejected.' });
    if (!muxRelayEnabled() || !body || typeof body !== 'object' || Array.isArray(body) ||
        !exactKeys(body, ['deviceAuthorizationProof', 'envelope', 'proofNonce', 'proofOperation', 'roomId', 'version']) || body.version !== MUX_PROTOCOL_VERSION ||
        !subscription || !subscription.protocolFeatures.includes('room-message-v1') || !socket.muxConnectionGeneration ||
        !body.envelope || typeof body.envelope !== 'object' || Array.isArray(body.envelope) || !Number.isSafeInteger((body.envelope as WireEnvelope).version) ||
        typeof (body.envelope as WireEnvelope).strategy !== 'string' || !('data' in (body.envelope as object)) ||
        Buffer.byteLength(JSON.stringify(body.envelope)) > MUX_MAX_ENVELOPE_BYTES) {
      reject();
      return;
    }
    const resource: DeviceResourceContext = {
      conversationId: subscription.roomId,
      routingAddress: subscription.routingAddress,
      peerRoutingAddress: subscription.peerRoutingAddress,
      connectionGeneration: subscription.connectionGeneration,
    };
    if (!await verifyMuxCarrier(socket, body as unknown as ProofCarrier, 'relay:message', resource, false) ||
        !await currentSubscription(socket, subscription.roomId)) {
      reject();
      return;
    }
    const timestamp = Date.now();
    const id = randomUUID();
    try {
      db.cleanupExpiredOfflineMessages();
      if (process.env.NODE_ENV === 'production' && !db.persistentStorageReady()) throw new Error('OFFLINE_DELIVERY_UNAVAILABLE');
      const stored = await db.storeOfflineMessage({
        id,
        dedupeKey: messageDedupeKey(subscription.roomId, subscription.peerRoutingAddress, subscription.routingAddress, body.envelope as WireEnvelope),
        channel: subscription.roomId,
        mailbox: subscription.peerRoutingAddress,
        sender: subscription.routingAddress,
        envelope: body.envelope as WireEnvelope,
        state: 'active',
        timestamp,
        expiresAt: new Date(timestamp + MUX_OFFLINE_TTL_MS),
      });
      if (stored.state === 'rejected') {
        notifyMuxSender(subscription.roomId, subscription.routingAddress, stored.id as string, 'rejected');
        ack({ id: stored.id, timestamp: stored.timestamp, terminalRejection: true });
        return;
      }
      ack({ version: MUX_PROTOCOL_VERSION, status: 'stored', id: stored.id, timestamp: stored.timestamp });
      const recipient = muxRoomSockets.get(subscription.roomId)?.get(subscription.peerRoutingAddress);
      const peerSubscription = recipient?.muxSubscriptions?.get(subscription.roomId);
      if (recipient && peerSubscription?.peerRoutingAddress === subscription.routingAddress && peerSubscription.protocolFeatures.includes('room-message-v1')) {
        requestMuxMailboxDelivery(recipient, peerSubscription);
      }
    } catch {
      reject();
    }
  }, ack, 'Multiplexed message rejected.'));

  socket.on('mux-send-signal', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const roomId = body?.roomId;
    const subscription = typeof roomId === 'string' ? await currentSubscription(socket, roomId) : undefined;
    const reject = (): void => ack({ error: 'Multiplexed call signal rejected.' });
    const envelope = body?.envelope as WireEnvelope | undefined;
    if (!muxRelayEnabled() || !body || typeof body !== 'object' || Array.isArray(body) ||
        !exactKeys(body, ['deviceAuthorizationProof', 'envelope', 'proofNonce', 'proofOperation', 'roomId', 'version']) || body.version !== MUX_PROTOCOL_VERSION ||
        body.proofOperation !== 'relay:signal' || !subscription || !subscription.protocolFeatures.includes('room-call-signal-v2') ||
        !envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Number.isSafeInteger(envelope.version) || envelope.version < 1 || envelope.version > 16 ||
        typeof envelope.strategy !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(envelope.strategy) || envelope.data === undefined || envelope.data === null ||
        Buffer.byteLength(JSON.stringify(envelope)) > MUX_MAX_ENVELOPE_BYTES || !socket.muxConnectionGeneration) {
      reject();
      return;
    }
    const resource: DeviceResourceContext = {
      conversationId: subscription.roomId,
      routingAddress: subscription.routingAddress,
      peerRoutingAddress: subscription.peerRoutingAddress,
      connectionGeneration: subscription.connectionGeneration,
    };
    if (!await verifyMuxCarrier(socket, body as unknown as ProofCarrier, 'relay:signal', resource, false) ||
        !await currentSubscription(socket, subscription.roomId)) {
      reject();
      return;
    }
    const recipient = muxRoomSockets.get(subscription.roomId)?.get(subscription.peerRoutingAddress);
    const peerSubscription = recipient?.muxSubscriptions?.get(subscription.roomId);
    if (!recipient || !peerSubscription || peerSubscription.peerRoutingAddress !== subscription.routingAddress ||
        !peerSubscription.protocolFeatures.includes('room-call-signal-v2') ||
        (await currentSubscription(recipient, subscription.roomId))?.nonce !== peerSubscription.nonce) {
      reject();
      return;
    }
    recipient.emit('mux-call-signal', {
      version: MUX_PROTOCOL_VERSION,
      roomId: subscription.roomId,
      senderRoutingAddress: subscription.routingAddress,
      recipientRoutingAddress: peerSubscription.routingAddress,
      connectionGeneration: peerSubscription.connectionGeneration,
      subscriptionNonce: peerSubscription.nonce,
      envelope,
    });
    ack({ version: MUX_PROTOCOL_VERSION, status: 'routed', roomId: subscription.roomId });
  }, ack, 'Multiplexed call signal rejected.'));

  socket.on('mux-mailbox-replay', (payload: unknown, ack: (response: Record<string, unknown>) => void = () => undefined) => enqueue(socket, async () => {
    const body = payload as Record<string, unknown> | null;
    const roomId = body?.roomId;
    const subscription = typeof roomId === 'string' ? await currentSubscription(socket, roomId) : undefined;
    if (!muxRelayEnabled() || !body || typeof body !== 'object' || Array.isArray(body) ||
        !exactKeys(body, ['connectionGeneration', 'roomId', 'subscriptionNonce', 'version']) || body.version !== MUX_PROTOCOL_VERSION || !subscription ||
        body.connectionGeneration !== subscription.connectionGeneration || body.subscriptionNonce !== subscription.nonce || !subscription.protocolFeatures.includes('room-message-v1')) {
      ack({ error: 'Multiplexed mailbox replay rejected.' });
      return;
    }
    ack({ version: MUX_PROTOCOL_VERSION, status: 'accepted', roomId });
    requestMuxMailboxDelivery(socket, subscription);
  }, ack, 'Multiplexed mailbox replay rejected.'));

  socket.on('disconnect', () => {
    muxOperationRateLimiter.reset(socket.id);
    const subscriptions = socket.muxSubscriptions;
    if (subscriptions) for (const subscription of subscriptions.values()) removeSubscription(socket, subscription);
    const timers = subscriptionTimers.get(socket);
    if (timers) for (const timer of timers.values()) clearTimeout(timer);
    timers?.clear();
    if (socket.accountIdentityReference && socket.deviceId) {
      const key = deviceKey(socket.accountIdentityReference, socket.deviceId);
      if (deviceSockets.get(key)?.socketId === socket.id) deviceSockets.delete(key);
    }
    socket.muxConnectionGeneration = undefined;
  });
};

// Imported lazily through this local helper to avoid a listeners <-> mux module cycle.
const channelValid = async (roomId: string): Promise<{ valid: boolean }> => {
  const room = await db.findOneFromDB<{ deleted?: boolean; expired?: boolean }>({ hash: roomId }, LINK_COLLECTION);
  return { valid: !!room && !room.deleted && !room.expired };
};

// Exposed for unit tests; IDs and capabilities are never logged.
export const testOnlyResetMuxDeviceRegistry = (): void => {
  deviceSockets.clear(); muxRoomSockets.clear();
  for (const pump of mailboxPumps.values()) if (pump.timer) clearTimeout(pump.timer);
  mailboxPumps.clear();
};
export const testOnlyFreshSubscriptionNonce = (): string => randomUUID();
