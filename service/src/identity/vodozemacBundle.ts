import { fromBase64Url, toBase64Url } from '../crypto/base64url';
import type { VodozemacAccountHandle, VodozemacPublicIdentity } from './vodozemacIdentity';

export const VODOZEMAC_BUNDLE_VERSION = 1 as const;
export const VODOZEMAC_BUNDLE_PROTOCOL = 'vodozemac-olm-v1' as const;
const MAX_BUNDLE_BYTES = 32 * 1024;
const MAX_ONE_TIME_KEYS = 100;

export interface VodozemacPublicKeyMaterial {
    readonly id: string;
    readonly key: string;
}

export interface VodozemacPublicBundle {
    readonly version: 1;
    readonly protocol: typeof VODOZEMAC_BUNDLE_PROTOCOL;
    readonly identity: VodozemacPublicIdentity;
    readonly oneTimeKeys: readonly VodozemacPublicKeyMaterial[];
    readonly fallbackKey?: VodozemacPublicKeyMaterial;
}

const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean =>
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

const validKey = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    try {
        const decoded = fromBase64Url(value);
        return decoded.byteLength === 32 && toBase64Url(decoded) === value;
    } catch {
        return false;
    }
};

const canonicalPublicKey = (value: string): string => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const parseIdentity = (value: unknown): VodozemacPublicIdentity => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !exactKeys(value as Record<string, unknown>, ['curve25519', 'ed25519'])) {
        throw new Error('Malformed vodozemac public identity.');
    }
    const identity = value as VodozemacPublicIdentity;
    if (!validKey(identity.curve25519) || !validKey(identity.ed25519)) {
        throw new Error('Malformed vodozemac public identity.');
    }
    return identity;
};

const parseKey = (value: unknown): VodozemacPublicKeyMaterial => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !exactKeys(value as Record<string, unknown>, ['id', 'key'])) {
        throw new Error('Malformed vodozemac one-time key.');
    }
    const material = value as VodozemacPublicKeyMaterial;
    if (typeof material.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(material.id) || !validKey(material.key)) {
        throw new Error('Malformed vodozemac one-time key.');
    }
    return material;
};

export const validateVodozemacPublicBundle = (value: unknown): VodozemacPublicBundle => {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_BUNDLE_BYTES || !value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Vodozemac public bundle is too large or malformed.');
    }
    const bundle = value as Record<string, unknown>;
    if (!exactKeys(bundle, ['fallbackKey', 'identity', 'oneTimeKeys', 'protocol', 'version']) &&
        !exactKeys(bundle, ['identity', 'oneTimeKeys', 'protocol', 'version'])) {
        throw new Error('Malformed vodozemac public bundle.');
    }
    if (bundle.version !== VODOZEMAC_BUNDLE_VERSION || bundle.protocol !== VODOZEMAC_BUNDLE_PROTOCOL ||
        !Array.isArray(bundle.oneTimeKeys) || bundle.oneTimeKeys.length > MAX_ONE_TIME_KEYS) {
        throw new Error('Unsupported vodozemac public bundle.');
    }
    const oneTimeKeys = bundle.oneTimeKeys.map(parseKey);
    const ids = new Set(oneTimeKeys.map((key) => key.id));
    if (ids.size !== oneTimeKeys.length) throw new Error('Duplicate vodozemac one-time key id.');
    const fallbackKey = bundle.fallbackKey === undefined ? undefined : parseKey(bundle.fallbackKey);
    if (fallbackKey && ids.has(fallbackKey.id)) throw new Error('Duplicate vodozemac fallback key id.');
    return {
        version: 1,
        protocol: VODOZEMAC_BUNDLE_PROTOCOL,
        identity: parseIdentity(bundle.identity),
        oneTimeKeys,
        ...(fallbackKey ? { fallbackKey } : {}),
    };
};

const keyId = async (key: string, kind: 'otk' | 'fallback'): Promise<string> => {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(`k3ncrypt:${kind}:v1\0${key}`),
    ));
    return `${kind}-${toBase64Url(digest).slice(0, 22)}`;
};

/** Builds public material only; no account pickle or private key crosses this API. */
export const createVodozemacPublicBundle = async (
    account: VodozemacAccountHandle,
): Promise<VodozemacPublicBundle> => {
    const accountIdentity = JSON.parse(account.identityKeys()) as VodozemacPublicIdentity;
    const identity = parseIdentity({ curve25519: canonicalPublicKey(accountIdentity.curve25519), ed25519: canonicalPublicKey(accountIdentity.ed25519) });
    const keys = (account.availableOneTimeKeys?.() ?? []).map(canonicalPublicKey);
    const oneTimeKeys = await Promise.all(keys.map(async (key) => ({ id: await keyId(key, 'otk'), key })));
    const fallbackValue = account.fallbackKey?.();
    const fallback = fallbackValue ? canonicalPublicKey(fallbackValue) : undefined;
    const fallbackKey = fallback ? { id: await keyId(fallback, 'fallback'), key: fallback } : undefined;
    return validateVodozemacPublicBundle({
        version: 1,
        protocol: VODOZEMAC_BUNDLE_PROTOCOL,
        identity,
        oneTimeKeys,
        ...(fallbackKey ? { fallbackKey } : {}),
    });
};
