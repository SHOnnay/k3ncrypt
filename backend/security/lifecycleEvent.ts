import { createPublicKey, verify } from 'crypto';
import type { BootstrapRequest, DeviceProofRequest, EnrollmentEvent, NetworkMembershipEvent } from '../../service/src/devices/trustProtocol';

export type LifecycleOperation = 'enroll' | 'activate' | 'revoke' | 'epoch-update';
export type SignedLifecycleEvent = { version: 1; eventId: string; accountIdentityReference: string; issuerDeviceId: string; issuerIdentityReference: string; targetDeviceId: string; targetIdentityReference: string; operation: LifecycleOperation; previousEpoch: number; nextEpoch: number; createdAt: number; expiresAt: number; signature: string };

const operations = new Set<LifecycleOperation>(['enroll', 'activate', 'revoke', 'epoch-update']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const b64 = /^[A-Za-z0-9_-]+$/;
const canonical = (event: Omit<SignedLifecycleEvent, 'signature'>): Buffer => Buffer.from(JSON.stringify(event));
// DER SubjectPublicKeyInfo prefix for a 32-byte raw Ed25519 public key.
const ed25519Spki = (raw: Buffer): Buffer => Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);

export const verifyLifecycleEvent = (event: SignedLifecycleEvent, issuerPublicKey: string, now = Date.now()): boolean => {
  const { signature, ...unsigned } = event ?? {} as SignedLifecycleEvent;
  if (!event || event.version !== 1 || !uuid.test(event.eventId) || !event.accountIdentityReference || !event.issuerDeviceId || !event.issuerIdentityReference || !event.targetDeviceId || !event.targetIdentityReference || !operations.has(event.operation) || !Number.isSafeInteger(event.previousEpoch) || !Number.isSafeInteger(event.nextEpoch) || event.nextEpoch !== event.previousEpoch + 1 || !Number.isSafeInteger(event.createdAt) || !Number.isSafeInteger(event.expiresAt) || event.createdAt > now || event.expiresAt < now || event.expiresAt - event.createdAt > 5 * 60_000 || !b64.test(issuerPublicKey) || !b64.test(signature)) return false;
  try {
    const key = Buffer.from(issuerPublicKey, 'base64url');
    const sig = Buffer.from(signature, 'base64url');
    return key.length === 32 && sig.length === 64 && verify(null, canonical(unsigned), createPublicKey({ key: ed25519Spki(key), format: 'der', type: 'spki' }), sig);
  } catch { return false; }
};

/** Verifies either new enrollment or proof-request control bytes with the stored Ed25519 key. */
export const verifyDeviceControlSignature = (value: EnrollmentEvent | DeviceProofRequest, publicKey: string): boolean => {
  const { signature, ...unsigned } = value;
  try { const key = Buffer.from(publicKey, 'base64url'); const sig = Buffer.from(signature, 'base64url'); return key.length === 32 && sig.length === 64 && verify(null, Buffer.from(JSON.stringify(unsigned)), createPublicKey({ key: ed25519Spki(key), format: 'der', type: 'spki' }), sig); } catch { return false; }
};

export const verifyBootstrapSignature = (value: BootstrapRequest, publicKey: string): boolean => {
  const { signature, ...unsigned } = value;
  try { const key = Buffer.from(publicKey, 'base64url'); const sig = Buffer.from(signature, 'base64url'); return key.length === 32 && sig.length === 64 && verify(null, Buffer.from(JSON.stringify(unsigned)), createPublicKey({ key: ed25519Spki(key), format: 'der', type: 'spki' }), sig); } catch { return false; }
};

export const verifyNetworkMembershipSignature = (value: NetworkMembershipEvent, publicKey: string, now = Date.now()): boolean => {
  const { signature, ...unsigned } = value ?? {} as NetworkMembershipEvent;
  if (!value || value.version !== 1 || !/^[0-9a-f-]{36}$/i.test(value.eventId) || !/^[0-9a-f-]{36}$/i.test(value.networkId) || !value.accountIdentityReference || !value.issuerDeviceId || !value.targetDeviceId || !value.issuerIdentityReference || !value.targetIdentityReference || !['add-member', 'remove-member', 'update-capability'].includes(value.operation) || !Number.isSafeInteger(value.previousEpoch) || !Number.isSafeInteger(value.nextEpoch) || value.nextEpoch !== value.previousEpoch + 1 || !Array.isArray(value.capabilities) || value.capabilities.some((item) => typeof item !== 'string' || item.length > 64) || value.createdAt > now || value.expiresAt < now || value.expiresAt - value.createdAt > 5 * 60_000) return false;
  try { const key = Buffer.from(publicKey, 'base64url'); const sig = Buffer.from(signature, 'base64url'); return key.length === 32 && sig.length === 64 && verify(null, Buffer.from(JSON.stringify(unsigned)), createPublicKey({ key: ed25519Spki(key), format: 'der', type: 'spki' }), sig); } catch { return false; }
};
