import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export type DeviceOperation = 'relay:message' | 'relay:signal' | 'attachment:create' | 'attachment:write' | 'attachment:read' | 'attachment:delete' | 'private-network:relay' | 'bridge:authorize' | 'device-control';
export type DeviceResourceContext = { conversationId?: string; networkId?: string; attachmentId?: string; bridgeRouteId?: string };
export type DeviceLifecycleRecord = { accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; verificationKeyReference: string; state: 'pending' | 'active' | 'revoked'; trustEpoch: number; createdAt: number; revokedAt?: number; lastTrustUpdate: number };
export type DeviceAuthorizationProof = { version: 1; proofId: string; accountIdentityReference: string; deviceId: string; deviceIdentityReference: string; operation: DeviceOperation; trustEpoch: number; nonce: string; resource?: DeviceResourceContext; issuedAt: number; expiresAt: number; signature: string };

const operation = new Set<DeviceOperation>(['relay:message', 'relay:signal', 'attachment:create', 'attachment:write', 'attachment:read', 'attachment:delete', 'private-network:relay', 'bridge:authorize', 'device-control']);
const canonical = (proof: Omit<DeviceAuthorizationProof, 'signature'>): string => JSON.stringify(proof);
const fail = (): never => { throw new Error('Device authorization rejected.'); };
const equal = (left: string, right: string): boolean => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };

/**
 * Minimal backend-verifiable lifecycle authority. It stores public device metadata
 * only; proofs are server signatures over a current, short-lived lifecycle view.
 */
export class DeviceTrustControlPlane {
  private readonly records = new Map<string, DeviceLifecycleRecord>();
  private readonly nonces = new Map<string, number>();
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) { if (secret.length < 32) throw new Error('Device trust proof secret is unavailable.'); }
  private key(account: string, device: string): string { return `${account}:${device}`; }
  private sign(unsigned: Omit<DeviceAuthorizationProof, 'signature'>): string { return createHmac('sha256', this.secret).update(`k3ncrypt-device-proof-v1\0${canonical(unsigned)}`).digest('base64url'); }
  register(input: Omit<DeviceLifecycleRecord, 'state' | 'createdAt' | 'lastTrustUpdate' | 'revokedAt'>): DeviceLifecycleRecord {
    if (!input.accountIdentityReference || !input.deviceId || !input.deviceIdentityReference || !input.verificationKeyReference || !Number.isSafeInteger(input.trustEpoch) || input.trustEpoch < 0) fail();
    const key = this.key(input.accountIdentityReference, input.deviceId); const existing = this.records.get(key);
    if (existing?.state === 'revoked' || (existing && (existing.deviceIdentityReference !== input.deviceIdentityReference || existing.verificationKeyReference !== input.verificationKeyReference || input.trustEpoch < existing.trustEpoch))) fail();
    const record: DeviceLifecycleRecord = { ...input, state: 'active', createdAt: existing?.createdAt ?? this.now(), lastTrustUpdate: this.now() };
    this.records.set(key, record); return { ...record };
  }
  revoke(accountIdentityReference: string, deviceId: string, trustEpoch: number): DeviceLifecycleRecord {
    const key = this.key(accountIdentityReference, deviceId); const record = this.records.get(key);
    if (!record || record.state !== 'active' || !Number.isSafeInteger(trustEpoch) || trustEpoch <= record.trustEpoch) fail();
    const next = { ...record, state: 'revoked' as const, trustEpoch, revokedAt: this.now(), lastTrustUpdate: this.now() }; this.records.set(key, next); return { ...next };
  }
  issue(accountIdentityReference: string, deviceId: string, operationName: DeviceOperation, nonce: string, ttlMs = 30_000): DeviceAuthorizationProof {
    const record = this.records.get(this.key(accountIdentityReference, deviceId));
    if (!record || record.state !== 'active' || !operation.has(operationName) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000) fail();
    const unsigned = { version: 1 as const, proofId: randomUUID(), accountIdentityReference, deviceId, deviceIdentityReference: record.deviceIdentityReference, operation: operationName, trustEpoch: record.trustEpoch, nonce, issuedAt: this.now(), expiresAt: this.now() + ttlMs };
    return { ...unsigned, signature: this.sign(unsigned) };
  }
  verify(proof: DeviceAuthorizationProof, expected: { accountIdentityReference: string; deviceId: string; operation: DeviceOperation; nonce: string }, consume = true): DeviceLifecycleRecord {
    const { signature, ...unsigned } = proof ?? {} as DeviceAuthorizationProof;
    if (!proof || proof.version !== 1 || !operation.has(proof.operation) || proof.accountIdentityReference !== expected.accountIdentityReference || proof.deviceId !== expected.deviceId || proof.operation !== expected.operation || proof.nonce !== expected.nonce || proof.expiresAt <= this.now() || proof.issuedAt > this.now() || !equal(signature ?? '', this.sign(unsigned))) fail();
    const record = this.records.get(this.key(proof.accountIdentityReference, proof.deviceId));
    if (!record || record.state !== 'active' || record.trustEpoch !== proof.trustEpoch || record.deviceIdentityReference !== proof.deviceIdentityReference) fail();
    for (const [key, expiry] of this.nonces) if (expiry <= this.now()) this.nonces.delete(key);
    const nonceKey = `${proof.proofId}:${proof.nonce}`; if (consume && this.nonces.has(nonceKey)) fail(); if (consume) this.nonces.set(nonceKey, proof.expiresAt);
    return { ...record };
  }
}

let controlPlane: DeviceTrustControlPlane | undefined;
export const deviceTrustControlPlane = (): DeviceTrustControlPlane => {
  if (!controlPlane) controlPlane = new DeviceTrustControlPlane(process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'development-device-trust-proof-secret-32bytes'));
  return controlPlane;
};
