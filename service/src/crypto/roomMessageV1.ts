const DOMAIN = new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE\0');
const VERSION = 1;
const HEADER_LENGTH = DOMAIN.length + 1 + 1 + 16 + 2 + 2 + 16 + 4;
const CANONICAL_IDENTITY_REFERENCE_BYTES = 56;
export const ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES = 60 * 1024;
/** Leaves headroom in the existing 32 KiB relay JSON envelope limit after Olm/base64 framing. */
export const MAX_USER_MESSAGE_UTF8_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const ROOM_MESSAGE_V1_FEATURE = 'room-message-v1';
export const ROOM_MESSAGE_V1_DOMAIN = 'K3NCRYPT/ROOM-MESSAGE';

export type RoomMessageKind = 'text' | 'attachment-reference' | 'join-introduction';
const KIND_TO_BYTE: Record<RoomMessageKind, number> = {
    text: 1,
    'attachment-reference': 2,
    'join-introduction': 3,
};
const BYTE_TO_KIND = new Map(Object.entries(KIND_TO_BYTE).map(([kind, value]) => [value, kind as RoomMessageKind]));

export interface RoomMessageV1 {
    roomId: string;
    senderIdentityReference: string;
    recipientIdentityReference: string;
    eventId: string;
    kind: RoomMessageKind;
    payload: Uint8Array;
}

export interface RoomMessageExpectation {
    roomId: string;
    senderIdentityReference: string;
    recipientIdentityReference: string;
}

export type DecodedRoomMessage =
    | { version: 'legacy'; payload: Uint8Array }
    | ({ version: 'room-message-v1' } & RoomMessageV1);

const exactUuid = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
        throw new Error(`Room message ${field} is invalid.`);
    }
    return value;
};

const roomUuidBytes = (value: string): Uint8Array => {
    exactUuid(value, 'room ID');
    return Uint8Array.from(value.replace(/-/g, '').match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};

const identityBytes = (value: string, field: string): Uint8Array => {
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength !== CANONICAL_IDENTITY_REFERENCE_BYTES ||
        !/^K3 (?:[A-Z0-9_-]{4} ){10}[A-Z0-9_-]{3}$/.test(value)) {
        throw new Error(`Room message ${field} identity reference is invalid.`);
    }
    return encoder.encode(value);
};

const kindByte = (kind: RoomMessageKind): number => {
    const value = KIND_TO_BYTE[kind];
    if (!value) throw new Error('Room message payload kind is unsupported.');
    return value;
};

const validateKindPayload = (kind: RoomMessageKind, payload: Uint8Array): void => {
    if (!(payload instanceof Uint8Array) || payload.byteLength > ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES) throw new Error('Room message payload is invalid or too large.');
    if (kind === 'text') {
        try { decoder.decode(payload); } catch { throw new Error('Room message text is not valid UTF-8.'); }
        if (startsWith(payload, encoder.encode('k3ncrypt-file-')) ||
            startsWith(payload, new Uint8Array([0x00, 0x4b, 0x33, 0x4e, 0x43, 0x49, 0x01]))) {
            throw new Error('Room message payload kind does not match its content.');
        }
    } else if (kind === 'attachment-reference') {
        if (!startsWith(payload, encoder.encode('k3ncrypt-file-'))) throw new Error('Room message attachment reference kind is invalid.');
    } else if (kind === 'join-introduction') {
        if (!startsWith(payload, new Uint8Array([0x00, 0x4b, 0x33, 0x4e, 0x43, 0x49, 0x01]))) throw new Error('Room message introduction kind is invalid.');
    } else {
        throw new Error('Room message payload kind is unsupported.');
    }
};

const startsWith = (value: Uint8Array, prefix: Uint8Array): boolean =>
    value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);

const putU16 = (view: DataView, offset: number, value: number): void => view.setUint16(offset, value, false);
const putU32 = (view: DataView, offset: number, value: number): void => view.setUint32(offset, value, false);

/** Fixed field order, fixed UUID width, explicit UTF-8 lengths, and a final exact payload length. */
export const encodeRoomMessageV1 = (message: RoomMessageV1): Uint8Array => {
    const room = roomUuidBytes(message.roomId);
    const sender = identityBytes(message.senderIdentityReference, 'sender');
    const recipient = identityBytes(message.recipientIdentityReference, 'recipient');
    const event = roomUuidBytes(exactUuid(message.eventId, 'event ID'));
    const kind = kindByte(message.kind);
    validateKindPayload(message.kind, message.payload);
    if (sender.byteLength !== CANONICAL_IDENTITY_REFERENCE_BYTES || recipient.byteLength !== CANONICAL_IDENTITY_REFERENCE_BYTES) throw new Error('Room message identity reference is not canonical.');
    const output = new Uint8Array(HEADER_LENGTH + sender.byteLength + recipient.byteLength + message.payload.byteLength);
    let offset = 0;
    output.set(DOMAIN, offset); offset += DOMAIN.byteLength;
    output[offset++] = VERSION;
    output[offset++] = kind;
    output.set(room, offset); offset += room.byteLength;
    const view = new DataView(output.buffer);
    putU16(view, offset, sender.byteLength); offset += 2;
    output.set(sender, offset); offset += sender.byteLength;
    putU16(view, offset, recipient.byteLength); offset += 2;
    output.set(recipient, offset); offset += recipient.byteLength;
    output.set(event, offset); offset += event.byteLength;
    putU32(view, offset, message.payload.byteLength); offset += 4;
    output.set(message.payload, offset);
    return output;
};

/** Strictly validates all wrapper fields before returning opaque application bytes. */
export const decodeRoomMessage = (
    value: Uint8Array,
    expected: RoomMessageExpectation,
    options: { requireRoomMessageV1?: boolean } = {},
): DecodedRoomMessage => {
    if (!(value instanceof Uint8Array) || value.byteLength > ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES + HEADER_LENGTH + 2 * CANONICAL_IDENTITY_REFERENCE_BYTES) throw new Error('Room message is invalid or too large.');
    if (!startsWith(value, DOMAIN)) {
        if (options.requireRoomMessageV1) throw new Error('A room-bound message is required.');
        return { version: 'legacy', payload: value.slice() };
    }
    if (value.byteLength < HEADER_LENGTH || value[DOMAIN.byteLength] !== VERSION) throw new Error('Room message version is unsupported or malformed.');
    let offset = DOMAIN.byteLength + 1;
    const kind = BYTE_TO_KIND.get(value[offset++]);
    if (!kind) throw new Error('Room message payload kind is unsupported.');
    const roomBytes = value.slice(offset, offset + 16); offset += 16;
    const roomId = [...roomBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const senderLength = view.getUint16(offset, false); offset += 2;
    if (senderLength !== CANONICAL_IDENTITY_REFERENCE_BYTES || offset + senderLength + 2 > value.byteLength) throw new Error('Room message sender binding is malformed.');
    const senderIdentityReference = decoder.decode(value.subarray(offset, offset + senderLength)); offset += senderLength;
    const recipientLength = view.getUint16(offset, false); offset += 2;
    if (recipientLength !== CANONICAL_IDENTITY_REFERENCE_BYTES || offset + recipientLength + 20 > value.byteLength) throw new Error('Room message recipient binding is malformed.');
    const recipientIdentityReference = decoder.decode(value.subarray(offset, offset + recipientLength)); offset += recipientLength;
    const eventBytes = value.slice(offset, offset + 16); offset += 16;
    const eventId = [...eventBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const payloadLength = view.getUint32(offset, false); offset += 4;
    if (payloadLength > ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES || offset + payloadLength !== value.byteLength) throw new Error('Room message payload length is malformed.');
    // Authenticate the wrapper context before exposing or parsing application bytes.
    identityBytes(expected.senderIdentityReference, 'expected sender');
    identityBytes(expected.recipientIdentityReference, 'expected recipient');
    if (roomId !== exactUuid(expected.roomId, 'expected room ID') ||
        senderIdentityReference !== expected.senderIdentityReference ||
        recipientIdentityReference !== expected.recipientIdentityReference) {
        throw new Error('Room message participant or room binding mismatch.');
    }
    const payload = value.slice(offset, offset + payloadLength);
    validateKindPayload(kind, payload);
    identityBytes(senderIdentityReference, 'sender');
    identityBytes(recipientIdentityReference, 'recipient');
    return { version: 'room-message-v1', roomId, senderIdentityReference, recipientIdentityReference, eventId, kind, payload };
};

/** Stable replay identity includes the authenticated room, sender identity, and event ID. */
export const roomMessageEventId = async (roomId: string, senderIdentityReference: string, eventId: string): Promise<string> => {
    const room = roomUuidBytes(roomId);
    const sender = identityBytes(senderIdentityReference, 'sender');
    const event = roomUuidBytes(exactUuid(eventId, 'event ID'));
    const input = new Uint8Array(encoder.encode('K3NCRYPT/ROOM-MESSAGE-EVENT-ID\0').byteLength + 16 + 2 + sender.byteLength + 16);
    const domain = encoder.encode('K3NCRYPT/ROOM-MESSAGE-EVENT-ID\0');
    let offset = 0;
    input.set(domain, offset); offset += domain.byteLength;
    input.set(room, offset); offset += room.byteLength;
    new DataView(input.buffer).setUint16(offset, sender.byteLength, false); offset += 2;
    input.set(sender, offset); offset += sender.byteLength;
    input.set(event, offset);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    return `v1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

/** Detects reuse of one authenticated event ID for different content. */
export const roomMessageCommitment = async (canonicalWrapper: Uint8Array): Promise<string> => {
    const domain = encoder.encode('K3NCRYPT/ROOM-MESSAGE-COMMITMENT\0');
    const input = new Uint8Array(domain.byteLength + canonicalWrapper.byteLength);
    input.set(domain); input.set(canonicalWrapper, domain.byteLength);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    return `v1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};
