import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import type { DeviceProofRequest } from '../../service/src/devices/trustProtocol';
import type { DeviceLifecycleRecord } from './deviceTrust';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from './durableDeviceTrust';

describe('device proof request clock skew', () => {
  const now = 1_800_000_000_000;
  const accountIdentityReference = 'account-test';
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const deviceIdentityReference = 'device-identity-test';
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
  const lifecycle: DeviceLifecycleRecord = {
    accountIdentityReference,
    deviceId,
    deviceIdentityReference,
    verificationKeyReference: publicKey,
    state: 'active',
    trustEpoch: 4,
    createdAt: now - 10_000,
    lastTrustUpdate: now - 1_000,
  };

  const makeAuthority = () => {
    const store = {
      read: jest.fn(async () => lifecycle),
      readAnyDevice: jest.fn(async () => lifecycle),
      consume: jest.fn(async () => true),
    } as unknown as MongoDeviceTrustStore;
    return new DurableDeviceTrustAuthority(store, 'p'.repeat(32), () => now);
  };

  const signedRequest = (createdAt: number, expiresAt = createdAt + 30_000): DeviceProofRequest => {
    const unsigned = {
      version: 1 as const,
      requestId: randomUUID(),
      accountIdentityReference,
      deviceId,
      deviceIdentityReference,
      operation: 'relay:signal',
      nonce: randomUUID().replace(/-/g, ''),
      epoch: 4,
      resource: { conversationId: 'conversation-test' },
      createdAt,
      expiresAt,
    };
    return { ...unsigned, signature: sign(null, Buffer.from(JSON.stringify(unsigned)), pair.privateKey).toString('base64url') };
  };

  it('accepts a valid signed request when the client clock is slightly ahead', async () => {
    const proof = await makeAuthority().issue(signedRequest(now + 2_000));
    expect(proof.operation).toBe('relay:signal');
    expect(proof.expiresAt).toBe(now + 30_000);
  });

  it('rejects a request outside the bounded future clock tolerance', async () => {
    await expect(makeAuthority().issue(signedRequest(now + 5_001))).rejects.toThrow('Device proof request rejected.');
  });

  it('continues rejecting requests already expired at server receipt', async () => {
    await expect(makeAuthority().issue(signedRequest(now - 40_000, now - 1)))
      .rejects.toThrow('Device proof request rejected.');
  });

  it('continues rejecting devices without lifecycle state', async () => {
    const store = {
      read: jest.fn(async () => undefined),
      readAnyDevice: jest.fn(async () => undefined),
      consume: jest.fn(async () => true),
    } as unknown as MongoDeviceTrustStore;
    await expect(new DurableDeviceTrustAuthority(store, 'p'.repeat(32), () => now).issue(signedRequest(now)))
      .rejects.toThrow('Device proof request rejected.');
  });
});
