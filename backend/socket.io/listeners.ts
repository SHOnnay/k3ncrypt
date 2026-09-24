import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import getClientInstance from "./clients";
import channelValid from "../api/chatHash/utils/validateChannel";
import { socketEmit, SOCKET_TOPIC, CustomSocket, WireEnvelope } from "./index";
import { RateLimiter } from "./rateLimiter";
import { authorizeRoomControl, isValidControlCapability, isValidRoomId } from '../security/controlCapability';
import db from '../db';
import { PREKEY_COLLECTION } from '../db/const';
import { durableDeviceTrustAuthority } from '../security/durableDeviceTrust';
import type { DeviceAuthorizationProof, DeviceOperation } from '../security/deviceTrust';

const clients = getClientInstance();

/** Generous enough for SDP/ICE candidates and chat text, but bounds abusive payloads. */
export const MAX_ENVELOPE_BYTES = 32 * 1024;
export const MAX_OFFLINE_PER_MAILBOX = 64;
export const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_LEASE_MS = 30 * 1000;
const OFFLINE_REPLAY_ACK_MS = 10 * 1000;
const LIVE_DELIVERY_ACK_MS = 5 * 1000;
/** Burst of 40 messages, refilling at 10/s — plenty for normal signaling/chat traffic. */
const rateLimiter = new RateLimiter({ capacity: 40, refillPerSecond: 10 });

type Ack = (response: Record<string, unknown>) => void;
const noop: Ack = () => undefined;
const traceDelivery = (stage: string, reached: boolean): void => {
  if (process.env.NODE_ENV !== 'production' && process.env.K3NCRYPT_TEST_ONLY_DIAGNOSTICS === 'true') console.info(`delivery-stage ${stage}=${reached}`);
};
const routingProofHash = (proof: string): Buffer => createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${proof}`).digest();

export const authorizeRoutingAddress = async (channel: string, address: string, proof: unknown): Promise<boolean> => {
  const record = await db.findOneFromDB<{ renewalProofHash?: string; expiresAt?: Date }>({ channel, address }, PREKEY_COLLECTION);
  if (!record) return false;
  if (!(record.expiresAt instanceof Date) || record.expiresAt.getTime() <= Date.now() || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) || !/^[0-9a-f]{64}$/.test(record.renewalProofHash ?? '')) return false;
  return timingSafeEqual(routingProofHash(proof), Buffer.from(record.renewalProofHash!, 'hex'));
};

const isPayloadTooLarge = (payload: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? {})) > MAX_ENVELOPE_BYTES;
  } catch {
    return true;
  }
};

const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

export const isValidWireEnvelope = (value: unknown): value is WireEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !exactKeys(value as Record<string, unknown>, ['version', 'strategy', 'data'])) {
    return false;
  }
  const envelope = value as WireEnvelope;
  return Number.isInteger(envelope.version) && envelope.version >= 1 && envelope.version <= 16 &&
    typeof envelope.strategy === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(envelope.strategy) &&
    envelope.data !== undefined && envelope.data !== null;
};

type ProofCarrier = { deviceAuthorizationProof: DeviceAuthorizationProof; proofNonce: string; proofOperation?: DeviceOperation };
const validCarrier = (value: unknown): value is ProofCarrier => !!value && typeof value === 'object' &&
  !!(value as ProofCarrier).deviceAuthorizationProof && typeof (value as ProofCarrier).proofNonce === 'string' &&
  (value as ProofCarrier).proofNonce === (value as ProofCarrier).deviceAuthorizationProof.nonce;
const validEnvelopePayload = (payload: unknown): payload is { envelope: WireEnvelope; recipientRoutingId?: string } & ProofCarrier =>
  !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
  (exactKeys(payload as Record<string, unknown>, ['envelope', 'deviceAuthorizationProof', 'proofNonce', 'proofOperation']) || exactKeys(payload as Record<string, unknown>, ['envelope', 'recipientRoutingId', 'deviceAuthorizationProof', 'proofNonce', 'proofOperation'])) &&
  isValidWireEnvelope((payload as { envelope?: unknown }).envelope) &&
  ((payload as { recipientRoutingId?: unknown }).recipientRoutingId === undefined || isValidRoomId((payload as { recipientRoutingId?: unknown }).recipientRoutingId)) && validCarrier(payload) && typeof (payload as ProofCarrier).proofOperation === 'string';

const verifyCarrier = async (socket: CustomSocket, carrier: ProofCarrier, operation: DeviceOperation, bind = false): Promise<boolean> => {
  const authority = durableDeviceTrustAuthority(db.getDatabase());
  if (!authority) return false;
  try {
    const record = await authority.verify(carrier.deviceAuthorizationProof, operation);
    if (record.deviceId !== carrier.deviceAuthorizationProof.deviceId ||
        (socket.deviceId && socket.deviceId !== record.deviceId) ||
        (socket.accountIdentityReference && socket.accountIdentityReference !== record.accountIdentityReference)) return false;
    if (bind) { socket.deviceId = record.deviceId; socket.accountIdentityReference = record.accountIdentityReference; }
    return true;
  } catch { return false; }
};

const envelopeDedupeKey = (channel: string, mailbox: string, sender: string, envelope: WireEnvelope): string =>
  createHash('sha256').update(JSON.stringify({ channel, mailbox, sender, envelope })).digest('hex');

const retainUndeliveredEnvelope = async (
  channel: string,
  mailbox: string,
  sender: string,
  envelope: WireEnvelope,
  id: string,
  timestamp: number,
): Promise<{ id: string; timestamp: number }> => {
  if (process.env.NODE_ENV === 'production' && !db.persistentStorageReady()) throw new Error('OFFLINE_DELIVERY_UNAVAILABLE');
  db.cleanupExpiredOfflineMessages();
  const stored = await db.storeOfflineMessage({
    id,
    dedupeKey: envelopeDedupeKey(channel, mailbox, sender, envelope),
    channel,
    mailbox,
    sender,
    envelope,
    timestamp,
    expiresAt: new Date(timestamp + OFFLINE_TTL_MS),
  });
  if (await db.countOfflineMessages({ channel, mailbox }) > MAX_OFFLINE_PER_MAILBOX) {
    await db.ackOfflineMessage(stored.id, mailbox, channel);
    throw new Error('MAILBOX_QUOTA');
  }
  return { id: stored.id, timestamp: stored.timestamp };
};

const deliverOffline = async (socket: CustomSocket): Promise<void> => {
  if (!socket.userID || !socket.channelID) return;
  db.cleanupExpiredOfflineMessages();
  for (let count = 0; count < MAX_OFFLINE_PER_MAILBOX; count += 1) {
    const message = await db.claimOfflineMessage<{ id: string; timestamp: number; sender: string; envelope: WireEnvelope; mailbox: string; channel: string }>(
      socket.userID, socket.channelID, new Date(Date.now() + OFFLINE_LEASE_MS));
    if (!message) return;
    const accepted = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), OFFLINE_REPLAY_ACK_MS);
      socket.emit(SOCKET_TOPIC.CHAT_MESSAGE, { id: message.id, timestamp: message.timestamp, sender: message.sender, envelope: message.envelope }, (response?: { accepted?: unknown }) => {
        clearTimeout(timeout);
        resolve(response?.accepted === true);
      });
    });
    traceDelivery('mailbox-replay-accepted', accepted);
    if (!accepted) return;
    await db.ackOfflineMessage(message.id, socket.userID, socket.channelID);
    traceDelivery('mailbox-deleted-after-ack', true);
  }
};

/**
 * Resolves the socket id of "the other participant" in `socket`'s channel,
 * using the identity bound to the socket at `chat-join` time — never a
 * client-supplied `sender`/`channel` field. This is what makes the relay
 * "opaque and bound to the socket/room": a connected client can only ever
 * act as itself, and only within the room it actually joined.
 */
const findPeerSid = (socket: CustomSocket): string | undefined => {
  if (!socket.userID || !socket.channelID) {
    return undefined;
  }
  const receiverId = clients.getReceiverIDBySenderID(socket.userID, socket.channelID);
  return receiverId ? clients.getSIDByIDs(receiverId, socket.channelID)?.sid : undefined;
};

const connectionListener = (socket: CustomSocket, io) => {
  socket.on("chat-join", async (data, ack: Ack = noop) => {
    const rejectJoin = (error: string, code: string) => ack(process.env.NODE_ENV === 'production' ? { error } : { error, code });
    const { userID, channelID, controlCapability, routingProof, deviceAuthorizationProof, proofNonce } = data || {};
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !Object.keys(data).every((key) => ['userID', 'channelID', 'controlCapability', 'routingProof', 'deviceAuthorizationProof', 'proofNonce'].includes(key)) ||
        !['userID', 'channelID', 'controlCapability', 'deviceAuthorizationProof', 'proofNonce'].every((key) => key in data) || !validCarrier({ deviceAuthorizationProof, proofNonce }) ||
        !isValidRoomId(userID) ||
        !isValidRoomId(channelID) || !isValidControlCapability(controlCapability)) {
      console.error("Rejected malformed channel join");
      rejectJoin('Channel join rejected.', 'malformed-request');
      return;
    }

    if (!await authorizeRoomControl(channelID, controlCapability)) {
      console.error('Rejected unauthorized channel join');
      rejectJoin('Channel join rejected.', 'room-control');
      return;
    }
    if (!await authorizeRoutingAddress(channelID, userID, routingProof)) {
      console.error('Rejected unauthorized routing identity');
      rejectJoin('Channel join rejected.', 'routing-authorization');
      return;
    }
    if (!await verifyCarrier(socket, { deviceAuthorizationProof, proofNonce }, 'relay:message', true)) {
      console.error('Rejected device authorization proof');
      rejectJoin('Device authorization rejected.', 'device-proof');
      socket.disconnect();
      return;
    }
    const { valid } = await channelValid(channelID);
    if (!valid) {
      console.error("Rejected invalid channel join");
      rejectJoin('Channel join rejected.', 'invalid-channel');
      return;
    }
    const usersInChannel = clients.getClientsByChannel(channelID) || {};
    const userCount = Object.keys(usersInChannel).length;

    if (userCount === 2) {
      socketEmit<SOCKET_TOPIC.LIMIT_REACHED>(SOCKET_TOPIC.LIMIT_REACHED, socket.id, null);
      rejectJoin('Channel is full.', 'channel-full');
      socket.disconnect();
      return;
    }

    clients.setClientToChannel(userID, channelID, socket.id);
    socket.channelID = channelID;
    socket.userID = userID;
    traceDelivery('relay-join-ready', true);

    // Notify the other participant. The independent room-control capability
    // was consumed for authorization above; message-encryption keys never
    // reach this relay.
    const receiverId = clients.getReceiverIDBySenderID(userID, channelID);
    const receiver = receiverId && clients.getSIDByIDs(receiverId, channelID);
    if (receiver) {
      socketEmit<SOCKET_TOPIC.ON_ALICE_JOIN>(SOCKET_TOPIC.ON_ALICE_JOIN, receiver.sid, null);
    }
    ack({ status: 'accepted' });
  });

  socket.on('mailbox-replay', async (_payload: unknown, ack: Ack = noop) => {
    if (!socket.userID || !socket.channelID || !socket.deviceId || !socket.accountIdentityReference) {
      ack({ error: 'Mailbox replay rejected.' });
      return;
    }
    await deliverOffline(socket as CustomSocket);
    ack({ status: 'accepted' });
  });

  socket.on("chat-message", async (payload: { envelope: WireEnvelope; recipientRoutingId?: string } & ProofCarrier, ack: Ack = noop) => {
    if (!socket.userID || !socket.channelID) {
      ack({ error: "Join a channel before sending messages." });
      return;
    }
    if (!rateLimiter.consume(socket.id)) {
      ack({ error: "Rate limit exceeded." });
      return;
    }
    if (isPayloadTooLarge(payload) || !validEnvelopePayload(payload)) {
      ack({ error: "Invalid or oversized encrypted envelope." });
      return;
    }
    if (payload.proofOperation !== 'relay:message' || payload.deviceAuthorizationProof.resource?.conversationId !== socket.channelID || !await verifyCarrier(socket, payload, 'relay:message')) { ack({ error: 'Device authorization rejected.' }); return; }
    const receiverSid = findPeerSid(socket);
    traceDelivery('target-route-found', !!receiverSid);
    if (!receiverSid) {
      const id = randomUUID();
      const timestamp = Date.now();
      const mailbox = payload.recipientRoutingId;
      if (!mailbox) { ack({ error: "No receiver is in the channel." }); return; }
      try {
        const existing = await retainUndeliveredEnvelope(socket.channelID, mailbox, socket.userID, payload.envelope, id, timestamp);
        traceDelivery('envelope-stored', true);
        ack({ id: existing.id, timestamp: existing.timestamp, stored: true });
      } catch (error) { ack({ error: error instanceof Error && error.message === 'MAILBOX_QUOTA' ? "Mailbox quota exceeded." : "Message could not be queued." }); }
      return;
    }

    const id = randomUUID();
    const timestamp = Date.now();
    traceDelivery('envelope-stored', false);
    traceDelivery('socket-dispatch-attempted', true);
    const receiverSocket = io.sockets.sockets.get(receiverSid);
    if (!receiverSocket) {
      traceDelivery('socket-dispatch-success', false);
      ack({ error: 'Receiver is unavailable.' });
      return;
    }
    const delivered = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), LIVE_DELIVERY_ACK_MS);
      receiverSocket.emit(SOCKET_TOPIC.CHAT_MESSAGE, {
        id,
        timestamp,
        sender: socket.userID,
        envelope: payload.envelope,
      }, (response?: { accepted?: unknown }) => {
        clearTimeout(timeout);
        resolve(response?.accepted === true);
      });
    });
    traceDelivery('socket-dispatch-success', delivered);
    if (delivered) {
      ack({ id, timestamp });
      return;
    }

    // A live client can decline before peer verification, or its ACK can be
    // lost. Retain the same opaque envelope for authenticated mailbox replay.
    const receiverId = clients.getReceiverIDBySenderID(socket.userID, socket.channelID);
    if (!receiverId) { ack({ error: 'Receiver is unavailable.' }); return; }
    try {
      const stored = await retainUndeliveredEnvelope(socket.channelID, receiverId, socket.userID, payload.envelope, id, timestamp);
      traceDelivery('envelope-stored', true);
      ack({ ...stored, stored: true });
    } catch (error) {
      ack({ error: error instanceof Error && error.message === 'MAILBOX_QUOTA' ? 'Mailbox quota exceeded.' : 'Message could not be queued.' });
    }
  });

  socket.on("webrtc-signal", async (payload: { envelope: WireEnvelope } & ProofCarrier, ack: Ack = noop) => {
    if (!socket.userID || !socket.channelID) {
      ack({ error: "Join a channel before signaling." });
      return;
    }
    if (!rateLimiter.consume(socket.id)) {
      ack({ error: "Rate limit exceeded." });
      return;
    }
    if (isPayloadTooLarge(payload) || !validEnvelopePayload(payload)) {
      ack({ error: "Invalid or oversized encrypted envelope." });
      return;
    }
    if (payload.proofOperation !== 'relay:signal' && payload.proofOperation !== 'device-control') { ack({ error: 'Device authorization rejected.' }); return; }
    if (payload.deviceAuthorizationProof.resource?.conversationId !== socket.channelID) { ack({ error: 'Device authorization rejected.' }); return; }
    if (!await verifyCarrier(socket, payload, payload.proofOperation)) { ack({ error: 'Device authorization rejected.' }); return; }
    const receiverSid = findPeerSid(socket);
    if (!receiverSid) {
      ack({ error: "No receiver is in the channel." });
      return;
    }

    socketEmit<SOCKET_TOPIC.WEBRTC_SESSION_DESCRIPTION>(SOCKET_TOPIC.WEBRTC_SESSION_DESCRIPTION, receiverSid, {
      envelope: payload?.envelope,
    });
    ack({ status: "ok" });
  });

  socket.on("received", async (payload: { id?: unknown }) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !exactKeys(payload, ['id']) || !isValidRoomId(payload.id)) {
      return;
    }
    const { id } = payload as { id: string };
    await db.ackOfflineMessage(id, socket.userID, socket.channelID);
    const receiverSid = findPeerSid(socket);
    if (receiverSid) {
      socketEmit<SOCKET_TOPIC.DELIVERED>(SOCKET_TOPIC.DELIVERED, receiverSid, id);
    }
  });

  socket.on("disconnect", () => {
    const { channelID, userID } = socket;
    rateLimiter.reset(socket.id);
    if (!(channelID && userID)) {
      return;
    }
    try {
      const receiver = findPeerSid(socket);
      clients.deleteClient(userID, channelID);
      if (receiver) {
        socketEmit<SOCKET_TOPIC.ON_ALICE_DISCONNECTED>(SOCKET_TOPIC.ON_ALICE_DISCONNECTED, receiver, null);
      }
    } catch {
      console.warn('Socket cleanup failed');
    }
  });

  socket.emit(SOCKET_TOPIC.MESSAGE, "ping!");
};

export default connectionListener;
