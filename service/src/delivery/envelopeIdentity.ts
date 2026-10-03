import type { EncryptedEnvelope } from '../core/contracts';

const DOMAIN = new TextEncoder().encode('k3ncrypt/envelope-id/v1');
const encoder = new TextEncoder();

const encodeScalarString = (value: string, field: string): Uint8Array => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${field} is not valid Unicode.`);
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new Error(`${field} is not valid Unicode.`);
        }
    }
    return encoder.encode(value);
};

const u32be = (length: number): Uint8Array => {
    if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) throw new Error('Envelope identity input is too large.');
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, length, false);
    return bytes;
};

/** Extracts the exact ciphertext string only after the existing envelope-shape validation. */
export const validatedOlmMessage = (envelope: EncryptedEnvelope): string => {
    if (!envelope || envelope.version !== 2 || envelope.strategy !== 'vodozemac-olm-v1' ||
        !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
        throw new Error('Unsupported modern message.');
    }
    const data = envelope.data as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'olmMessage,version' || data.version !== 1 ||
        typeof data.olmMessage !== 'string' || data.olmMessage.length < 1 || data.olmMessage.length > 192 * 1024) {
        throw new Error('Malformed modern message.');
    }
    return data.olmMessage;
};

/** Local correlation/deduplication identifier. It is not authentication or a wire receipt. */
export const envelopeId = async (conversationId: string, olmMessage: string): Promise<string> => {
    const conversation = encodeScalarString(conversationId, 'Conversation identifier');
    const ciphertext = encodeScalarString(olmMessage, 'Ciphertext');
    const input = new Uint8Array(DOMAIN.length + 4 + conversation.length + 4 + ciphertext.length);
    let offset = 0;
    input.set(DOMAIN, offset); offset += DOMAIN.length;
    input.set(u32be(conversation.length), offset); offset += 4;
    input.set(conversation, offset); offset += conversation.length;
    input.set(u32be(ciphertext.length), offset); offset += 4;
    input.set(ciphertext, offset);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    return `v1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const envelopeIdForEnvelope = async (conversationId: string, envelope: EncryptedEnvelope): Promise<string> =>
    envelopeId(conversationId, validatedOlmMessage(envelope));
