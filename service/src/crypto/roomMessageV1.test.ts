import { webcrypto } from 'crypto';
import { decodeRoomMessage, encodeRoomMessageV1, MAX_USER_MESSAGE_UTF8_BYTES, ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES, roomMessageEventId } from './roomMessageV1';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const identityA = `K3 ${Array(10).fill('ABCD').join(' ')} EFG`;
const identityB = `K3 ${Array(10).fill('BCDE').join(' ')} FGH`;
const text = new TextEncoder().encode('hello');
const bound = (roomId = roomA) => encodeRoomMessageV1({ roomId, senderIdentityReference: identityA,
    recipientIdentityReference: identityB, eventId: eventA, kind: 'text', payload: text });
const expected = { roomId: roomA, senderIdentityReference: identityA, recipientIdentityReference: identityB };

describe('ROOM_MESSAGE_V1 canonical authenticated wrapper', () => {
    it('round-trips deterministically using the fixed canonical representation', () => {
        const first = bound();
        expect(bound()).toEqual(first);
        expect(decodeRoomMessage(first, expected)).toEqual({ version: 'room-message-v1', roomId: roomA,
            senderIdentityReference: identityA, recipientIdentityReference: identityB, eventId: eventA, kind: 'text', payload: text });
    });

    it('rejects wrong room, participant, unknown version, truncated header, and trailing bytes', () => {
        expect(() => decodeRoomMessage(bound(roomB), expected)).toThrow('binding mismatch');
        expect(() => decodeRoomMessage(bound(), { ...expected, recipientIdentityReference: identityA })).toThrow('binding mismatch');
        const unknownVersion = bound(); unknownVersion['K3NCRYPT/ROOM-MESSAGE\0'.length] = 2;
        expect(() => decodeRoomMessage(unknownVersion, expected)).toThrow('version');
        expect(() => decodeRoomMessage(new Uint8Array([1, 2]), expected)).not.toThrow();
        expect(() => decodeRoomMessage(bound().slice(0, -1), expected)).toThrow();
        expect(() => decodeRoomMessage(new Uint8Array([...bound(), 0]), expected)).toThrow();
    });

    it('rejects modified room bytes and kind/content confusion', () => {
        const modified = bound(); modified[ 'K3NCRYPT/ROOM-MESSAGE\0'.length + 2 ] ^= 1;
        expect(() => decodeRoomMessage(modified, expected)).toThrow('binding mismatch');
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA,
            recipientIdentityReference: identityB, eventId: eventA, kind: 'text',
            payload: new TextEncoder().encode('k3ncrypt-file-invalid') })).toThrow('kind');
    });

    it('rejects every truncation and one-byte mutations of each encoded length field', () => {
        const frame = bound();
        for (let end = 0; end < frame.byteLength; end++) {
            expect(() => decodeRoomMessage(frame.slice(0, end), expected, { requireRoomMessageV1: true })).toThrow();
        }
        const domainLength = new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE\0').byteLength;
        const senderLengthOffset = domainLength + 2 + 16;
        const recipientLengthOffset = senderLengthOffset + 2 + new TextEncoder().encode(identityA).byteLength;
        const payloadLengthOffset = recipientLengthOffset + 2 + new TextEncoder().encode(identityB).byteLength + 16;
        for (const [offset, value] of [[senderLengthOffset, 55], [senderLengthOffset, 57], [recipientLengthOffset, 55],
            [recipientLengthOffset, 57], [payloadLengthOffset, text.byteLength - 1], [payloadLengthOffset, text.byteLength + 1]] as const) {
            const changed = frame.slice();
            if (offset === payloadLengthOffset) new DataView(changed.buffer).setUint32(offset, value, false);
            else new DataView(changed.buffer).setUint16(offset, value, false);
            expect(() => decodeRoomMessage(changed, expected, { requireRoomMessageV1: true })).toThrow();
        }
        for (const offset of [senderLengthOffset, senderLengthOffset + 1, recipientLengthOffset, recipientLengthOffset + 1,
            payloadLengthOffset, payloadLengthOffset + 1, payloadLengthOffset + 2, payloadLengthOffset + 3]) {
            const changed = frame.slice(); changed[offset] ^= 1;
            expect(() => decodeRoomMessage(changed, expected, { requireRoomMessageV1: true })).toThrow();
        }
        const invalidUtf8 = frame.slice();
        invalidUtf8[senderLengthOffset + 2] = 0xff;
        expect(() => decodeRoomMessage(invalidUtf8, expected, { requireRoomMessageV1: true })).toThrow();
        const badKind = frame.slice(); badKind[domainLength + 1] = 0xff;
        expect(() => decodeRoomMessage(badKind, expected, { requireRoomMessageV1: true })).toThrow();
    });

    it('rejects noncanonical identities, invalid UUID inputs, and over-limit payloads', () => {
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: `${identityA} `, recipientIdentityReference: identityB,
            eventId: eventA, kind: 'text', payload: text })).toThrow('identity reference');
        const overLimitIdentity = bound();
        const senderLengthOffset = new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE\0').byteLength + 2 + 16;
        new DataView(overLimitIdentity.buffer).setUint16(senderLengthOffset, 129, false);
        expect(() => decodeRoomMessage(overLimitIdentity, expected, { requireRoomMessageV1: true })).toThrow('sender binding');
        expect(() => encodeRoomMessageV1({ roomId: roomA.toUpperCase(), senderIdentityReference: identityA, recipientIdentityReference: identityB,
            eventId: eventA, kind: 'text', payload: text })).toThrow('room ID');
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA, recipientIdentityReference: identityB,
            eventId: 'not-a-uuid', kind: 'text', payload: text })).toThrow('event ID');
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA, recipientIdentityReference: identityB,
            eventId: eventA, kind: 'text', payload: new Uint8Array(ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES + 1) })).toThrow('too large');
        expect(MAX_USER_MESSAGE_UTF8_BYTES).toBe(16 * 1024);
    });

    it('accepts the exact V1 payload ceiling of 61,440 bytes', () => {
        const maximum = new Uint8Array(ROOM_MESSAGE_V1_MAX_PAYLOAD_BYTES);
        const encoded = encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA,
            recipientIdentityReference: identityB, eventId: eventA, kind: 'text', payload: maximum });
        const decoded = decodeRoomMessage(encoded, expected);
        expect(decoded.version).toBe('room-message-v1');
        if (decoded.version === 'room-message-v1') expect(decoded.payload.byteLength).toBe(61_440);
    });

    it('does not reinterpret domain-like legacy text as V1 or silently expose malformed file/control marker text', () => {
        const legacyText = new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE is part of my message');
        expect(decodeRoomMessage(legacyText, expected)).toEqual({ version: 'legacy', payload: legacyText });
        expect(() => decodeRoomMessage(new TextEncoder().encode('K3NCRYPT/ROOM-MESSAGE\0plain text'), expected)).toThrow();
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA, recipientIdentityReference: identityB,
            eventId: eventA, kind: 'text', payload: new TextEncoder().encode('k3ncrypt-file-not-a-reference') })).toThrow('kind');
        expect(() => encodeRoomMessageV1({ roomId: roomA, senderIdentityReference: identityA, recipientIdentityReference: identityB,
            eventId: eventA, kind: 'text', payload: new Uint8Array([0, 0x4b, 0x33, 0x4e, 0x43, 0x49, 1, 0x7b]) })).toThrow('kind');
    });

    it('keeps legacy unbound decoding compatible while a mux-required path fails closed', () => {
        expect(decodeRoomMessage(text, expected)).toEqual({ version: 'legacy', payload: text });
        expect(() => decodeRoomMessage(text, expected, { requireRoomMessageV1: true })).toThrow('required');
    });

    it('scopes event replay keys by room and sender identity', async () => {
        const id = await roomMessageEventId(roomA, identityA, eventA);
        expect(id).toMatch(/^v1:[0-9a-f]{64}$/);
        expect(await roomMessageEventId(roomA, identityA, eventA)).toBe(id);
        expect(await roomMessageEventId(roomB, identityA, eventA)).not.toBe(id);
        expect(await roomMessageEventId(roomA, identityB, eventA)).not.toBe(id);
    });
});
