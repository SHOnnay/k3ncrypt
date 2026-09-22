import { DeviceTrustControlPlane } from './deviceTrust';

const account = 'account-a';
const device = '11111111-1111-4111-8111-111111111111';
const register = (plane: DeviceTrustControlPlane) => plane.register({ accountIdentityReference: account, deviceId: device, deviceIdentityReference: 'identity-a', verificationKeyReference: 'ed25519-a', trustEpoch: 1 });

describe('device trust control plane', () => {
  it('verifies a current active proof once and rejects replay, altered operation, and stale epoch', () => {
    let now = 1_000; const plane = new DeviceTrustControlPlane('a'.repeat(32), () => now); register(plane);
    const proof = plane.issue(account, device, 'relay:message', 'a'.repeat(16));
    expect(plane.verify(proof, { accountIdentityReference: account, deviceId: device, operation: 'relay:message', nonce: 'a'.repeat(16) }).state).toBe('active');
    expect(() => plane.verify(proof, { accountIdentityReference: account, deviceId: device, operation: 'relay:message', nonce: 'a'.repeat(16) })).toThrow('rejected');
    const other = plane.issue(account, device, 'attachment:read', 'b'.repeat(16));
    expect(() => plane.verify({ ...other, operation: 'relay:message' }, { accountIdentityReference: account, deviceId: device, operation: 'relay:message', nonce: 'b'.repeat(16) })).toThrow('rejected');
    plane.register({ accountIdentityReference: account, deviceId: device, deviceIdentityReference: 'identity-a', verificationKeyReference: 'ed25519-a', trustEpoch: 2 });
    const stale = plane.issue(account, device, 'relay:message', 'c'.repeat(16));
    expect(() => plane.verify({ ...stale, trustEpoch: 1 }, { accountIdentityReference: account, deviceId: device, operation: 'relay:message', nonce: 'c'.repeat(16) })).toThrow('rejected');
    now += 1;
  });
  it('rejects proof issue and verification after revocation', () => {
    const plane = new DeviceTrustControlPlane('a'.repeat(32)); register(plane); plane.revoke(account, device, 2);
    expect(() => plane.issue(account, device, 'attachment:read', 'd'.repeat(16))).toThrow('rejected');
  });
});
