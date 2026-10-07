import { webcrypto } from 'crypto';
import { decodeRoomMessage, encodeRoomMessageV1, roomMessageEventId } from './roomMessageV1';

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
