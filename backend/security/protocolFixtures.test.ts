import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, verify } from 'node:crypto';
import { verifyBootstrapSignature, verifyDeviceControlSignature, verifyLifecycleEvent } from './lifecycleEvent';
import type { BootstrapRequest, EnrollmentEvent } from '../../service/src/devices/trustProtocol';
import type { SignedLifecycleEvent } from './lifecycleEvent';

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'protocol-fixtures', 'v1', name), 'utf8')) as Record<string, unknown>;

describe('Phase 9 cross-platform protocol fixtures', () => {
  it('locks unpadded base64url and SHA-256 conventions', () => {
    const value = fixture('encoding.json').accepted as Record<string, string>;
    expect(createHash('sha256').update(value.utf8, 'utf8').digest('hex')).toBe(value.sha256Hex);
    expect(Buffer.from([1, 2, 3]).toString('base64url')).toBe(value.base64url);
  });

  it('contains a valid synthetic Ed25519 control signature and rejects a modified payload', () => {
    const value = fixture('control-signatures.json');
    const publicKey = Buffer.from(value.syntheticEd25519PublicKey as string, 'base64url');
    const accepted = value.accepted as Record<string, string>;
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const key = { key: Buffer.concat([spkiPrefix, publicKey]), format: 'der' as const, type: 'spki' as const };
    expect(verify(null, Buffer.from(accepted.canonicalPayload, 'utf8'), key, Buffer.from(accepted.signature, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from((value.modifiedField as Record<string, string>).canonicalPayload, 'utf8'), key, Buffer.from(accepted.signature, 'base64url'))).toBe(false);
  });

  it('keeps the modern encrypted envelope schema strict', () => {
    const value = fixture('encrypted-envelopes.json');
    const accepted = JSON.parse((value.accepted as Record<string, string>).serialized);
    expect(Object.keys(accepted)).toEqual(['version', 'strategy', 'data']);
    expect(accepted.version).toBe(2);
    expect(accepted.strategy).toBe('vodozemac-olm-v1');
    expect(Object.keys(accepted.data)).toEqual(['version', 'olmMessage']);
  });

  it('verifies the shared bootstrap, enrollment, and activation signatures and rejects field changes', () => {
    const value = fixture('device-lifecycle-events.json') as unknown as {
      publicVerificationKey: string;
      bootstrap: { canonicalPayload: string; signature: string };
      enrollment: { canonicalPayload: string; signature: string };
      activation: { canonicalPayload: string; signature: string };
    };
    const publicKey = value.publicVerificationKey as string;
    const bootstrap = { ...JSON.parse(value.bootstrap.canonicalPayload) as Record<string, unknown>, signature: value.bootstrap.signature } as BootstrapRequest;
    const enrollment = { ...JSON.parse(value.enrollment.canonicalPayload) as Record<string, unknown>, signature: value.enrollment.signature } as EnrollmentEvent;
    const activation = { ...JSON.parse(value.activation.canonicalPayload) as Record<string, unknown>, signature: value.activation.signature } as SignedLifecycleEvent;
    expect(verifyBootstrapSignature(bootstrap, publicKey)).toBe(true);
    expect(verifyDeviceControlSignature(enrollment, publicKey)).toBe(true);
    expect(verifyLifecycleEvent(activation, publicKey, 1_700_000_000_000)).toBe(true);
    expect(verifyBootstrapSignature({ ...bootstrap, deviceId: '66666666-6666-4666-8666-666666666666' }, publicKey)).toBe(false);
    expect(verifyDeviceControlSignature({ ...enrollment, targetDeviceId: '66666666-6666-4666-8666-666666666666' }, publicKey)).toBe(false);
    expect(verifyLifecycleEvent({ ...activation, nextEpoch: activation.nextEpoch + 1 }, publicKey, 1_700_000_000_000)).toBe(false);
  });
});
