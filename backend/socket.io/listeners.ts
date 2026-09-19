import { createHash, randomUUID } from 'crypto';
import getClientInstance from "./clients";
import channelValid from "../api/chatHash/utils/validateChannel";
import { socketEmit, SOCKET_TOPIC, CustomSocket, WireEnvelope } from "./index";
import { RateLimiter } from "./rateLimiter";
import { authorizeRoomControl, isValidControlCapability, isValidRoomId } from '../security/controlCapability';
import db from '../db';

const clients = getClientInstance();

/** Generous enough for SDP/ICE candidates and chat text, but bounds abusive payloads. */
export const MAX_ENVELOPE_BYTES = 32 * 1024;
export const MAX_OFFLINE_PER_MAILBOX = 64;
export const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_LEASE_MS = 30 * 1000;
/** Burst of 40 messages, refilling at 10/s — plenty for normal signaling/chat traffic. */
const rateLimiter = new RateLimiter({ capacity: 40, refillPerSecond: 10 });

type Ack = (response: Record<string, unknown>) => void;
const noop: Ack = () => undefined;

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

const validEnvelopePayload = (payload: unknown): payload is { envelope: WireEnvelope; recipientRoutingId?: string } =>
  !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
  (exactKeys(payload as Record<string, unknown>, ['envelope']) || exactKeys(payload as Record<string, unknown>, ['envelope', 'recipientRoutingId'])) &&
  isValidWireEnvelope((payload as { envelope?: unknown }).envelope) &&
  ((payload as { recipientRoutingId?: unknown }).recipientRoutingId === undefined || isValidRoomId((payload as { recipientRoutingId?: unknown }).recipientRoutingId));

const envelopeDedupeKey = (channel: string, mailbox: string, sender: string, envelope: WireEnvelope): string =>
  createHash('sha256').update(JSON.stringify({ channel, mailbox, sender, envelope })).digest('hex');

const deliverOffline = async (socket: CustomSocket): Promise<void> => {
  if (!socket.userID || !socket.channelID) return;
  db.cleanupExpiredOfflineMessages();
  for (let count = 0; count < MAX_OFFLINE_PER_MAILBOX; count += 1) {
    const message = await db.claimOfflineMessage<{ id: string; timestamp: number; sender: string; envelope: WireEnvelope; mailbox: string; channel: string }>(
      socket.userID, socket.channelID, new Date(Date.now() + OFFLINE_LEASE_MS));
    if (!message) return;
    socket.emit(SOCKET_TOPIC.CHAT_MESSAGE, { id: message.id, timestamp: message.timestamp, sender: message.sender, envelope: message.envelope });
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
  socket.on("chat-join", async (data) => {
    const { userID, channelID, controlCapability } = data || {};
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !exactKeys(data, ['userID', 'channelID', 'controlCapability']) ||
        !isValidRoomId(userID) ||
        !isValidRoomId(channelID) || !isValidControlCapability(controlCapability)) {
      console.error("Rejected malformed channel join");
      return;
    }

    if (!await authorizeRoomControl(channelID, controlCapability)) {
      console.error('Rejected unauthorized channel join');
      return;
    }
    const { valid } = await channelValid(channelID);
    if (!valid) {
      console.error("Rejected invalid channel join");
      return;
    }
    const usersInChannel = clients.getClientsByChannel(channelID) || {};
    const userCount = Object.keys(usersInChannel).length;

    if (userCount === 2) {
      socketEmit<SOCKET_TOPIC.LIMIT_REACHED>(SOCKET_TOPIC.LIMIT_REACHED, socket.id, null);
      socket.disconnect();
      return;
    }

    clients.setClientToChannel(userID, channelID, socket.id);
    socket.channelID = channelID;
    socket.userID = userID;

    // Notify the other participant. The independent room-control capability
    // was consumed for authorization above; message-encryption keys never
    // reach this relay.
    const receiverId = clients.getReceiverIDBySenderID(userID, channelID);
    const receiver = receiverId && clients.getSIDByIDs(receiverId, channelID);
    if (receiver) {
      socketEmit<SOCKET_TOPIC.ON_ALICE_JOIN>(SOCKET_TOPIC.ON_ALICE_JOIN, receiver.sid, null);
    }
    await deliverOffline(socket as CustomSocket);
  });

  socket.on("chat-message", async (payload: { envelope: WireEnvelope; recipientRoutingId?: string }, ack: Ack = noop) => {
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
    const receiverSid = findPeerSid(socket);
    if (!receiverSid) {
      if (process.env.NODE_ENV === 'production' && !db.persistentStorageReady()) { ack({ error: "Offline delivery is unavailable." }); return; }
      db.cleanupExpiredOfflineMessages();
      const id = randomUUID();
      const timestamp = Date.now();
      const mailbox = payload.recipientRoutingId;
      if (!mailbox) { ack({ error: "No receiver is in the channel." }); return; }
      const dedupeKey = envelopeDedupeKey(socket.channelID, mailbox, socket.userID, payload.envelope);
      try {
        const existing = await db.storeOfflineMessage({ id, dedupeKey, channel: socket.channelID, mailbox, sender: socket.userID, envelope: payload.envelope, timestamp, expiresAt: new Date(timestamp + OFFLINE_TTL_MS) });
        if (await db.countOfflineMessages({ channel: socket.channelID, mailbox }) > MAX_OFFLINE_PER_MAILBOX) { await db.ackOfflineMessage(existing.id, mailbox, socket.channelID); ack({ error: "Mailbox quota exceeded." }); return; }
        ack({ id: existing.id, timestamp: existing.timestamp, stored: true });
      } catch { ack({ error: "Message could not be queued." }); }
      return;
    }

    const id = randomUUID();
    const timestamp = Date.now();
    socketEmit<SOCKET_TOPIC.CHAT_MESSAGE>(SOCKET_TOPIC.CHAT_MESSAGE, receiverSid, {
      id,
      timestamp,
      sender: socket.userID,
      envelope: payload?.envelope,
    });
    ack({ id, timestamp });
  });

  socket.on("webrtc-signal", (payload: { envelope: WireEnvelope }, ack: Ack = noop) => {
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
