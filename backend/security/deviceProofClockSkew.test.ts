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
    const consumed = new Set<string>();
    const store = {
      read: jest.fn(async () => lifecycle),
      readAnyDevice: jest.fn(async () => lifecycle),
      consume: jest.fn(async (id: string) => { if (consumed.has(id)) return false; consumed.add(id); return true; }),
    } as unknown as MongoDeviceTrustStore;
    return { authority: new DurableDeviceTrustAuthority(store, 'p'.repeat(32), () => now), consumed };
  };

  const signedRequest = (
    createdAt: number,
    expiresAt = createdAt + 30_000,
    operation: DeviceProofRequest['operation'] = 'relay:signal',
    resource: DeviceProofRequest['resource'] = { conversationId: 'conversation-test' },
    requestId = randomUUID(),
    proofNonce = randomUUID().replace(/-/g, ''),
  ): DeviceProofRequest => {
    const unsigned = {
      version: 1 as const,
      requestId,
      accountIdentityReference,
      deviceId,
      deviceIdentityReference,
      operation,
      nonce: proofNonce,
      epoch: 4,
      resource,
      createdAt,
      expiresAt,
    };
    return { ...unsigned, signature: sign(null, Buffer.from(JSON.stringify(unsigned)), pair.privateKey).toString('base64url') };
  };

  it('accepts a valid signed request when the client clock is slightly ahead', async () => {
    const proof = await makeAuthority().authority.issue(signedRequest(now + 2_000));
    expect(proof.operation).toBe('relay:signal');
    expect(proof.expiresAt).toBe(now + 30_000);
  });

  it('rejects a request outside the bounded future clock tolerance', async () => {
    await expect(makeAuthority().authority.issue(signedRequest(now + 5_001))).rejects.toThrow('Device proof request rejected.');
  });

  it('continues rejecting requests already expired at server receipt', async () => {
    await expect(makeAuthority().authority.issue(signedRequest(now - 40_000, now - 1)))
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

  it('issues room and generation-bound mux proofs once with bounded leases', async () => {
    const roomId = '22222222-2222-4222-8222-222222222222';
    const routingAddress = '33333333-3333-4333-8333-333333333333';
    const peerRoutingAddress = '44444444-4444-4444-8444-444444444444';
    const generation = 'socket-generation-a';
    const resource = { conversationId: roomId, routingAddress, peerRoutingAddress, connectionGeneration: generation };
    const { authority } = makeAuthority();
    const request = signedRequest(now, now + 5 * 60_000, 'relay:subscribe', resource);
    const proof = await authority.issue(request);
    expect(proof.expiresAt).toBe(now + 5 * 60_000);
    await expect(authority.verify(proof, 'relay:subscribe', resource)).resolves.toMatchObject({ deviceId, state: 'active' });
    await expect(authority.verify(proof, 'relay:subscribe', resource)).rejects.toThrow('Device proof rejected.');

    const replayWithFreshRequest = signedRequest(now, now + 5 * 60_000, 'relay:subscribe', resource, randomUUID(), request.nonce);
    await expect(authority.issue(replayWithFreshRequest)).rejects.toThrow('Device proof request rejected.');
    const wrongGeneration = signedRequest(now, now + 5 * 60_000, 'relay:subscribe', { ...resource, connectionGeneration: 'stale-generation' });
    const wrongGenerationProof = await authority.issue(wrongGeneration);
    await expect(authority.verify(wrongGenerationProof, 'relay:subscribe', resource)).rejects.toThrow('Device proof rejected.');
  });

  it('rejects mux proofs with missing, extra, or overlong subscription resources', async () => {
    const { authority } = makeAuthority();
    const invalidResources = [
      { connectionGeneration: 'socket-generation-a' },
      { conversationId: 'conversation-a', routingAddress: 'route-a', peerRoutingAddress: 'route-b', connectionGeneration: 'socket-generation-a', extra: true },
      { conversationId: '22222222-2222-4222-8222-222222222222', routingAddress: '33333333-3333-4333-8333-333333333333', peerRoutingAddress: '44444444-4444-4444-8444-444444444444', connectionGeneration: 'x'.repeat(129) },
    ];
    for (const resource of invalidResources) {
      const request = signedRequest(now, now + 5 * 60_000, 'relay:subscribe', resource);
      await expect(authority.issue(request)).rejects.toThrow('Device proof request rejected.');
    }
  });
});
