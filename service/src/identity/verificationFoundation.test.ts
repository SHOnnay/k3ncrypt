import { decodeVerificationQrPayload, encodeVerificationQrPayload, verificationStateForContact } from './verificationFoundation';

describe('verification foundation', () => {
  const fingerprint = 'K3 ABCD EFGH_IJKL';

  it('encodes a deterministic public-only payload', () => {
    const encoded = encodeVerificationQrPayload(fingerprint);
    expect(encoded).toBe('{"version":1,"algorithm":"vodozemac","fingerprint":"K3 ABCD EFGH_IJKL"}');
    expect(decodeVerificationQrPayload(encoded)).toEqual({ version: 1, algorithm: 'vodozemac', fingerprint });
  });

  it('rejects malformed, reordered, or over-broad payloads', () => {
    expect(() => decodeVerificationQrPayload('{"fingerprint":"K3 ABCD","algorithm":"vodozemac","version":1}')).toThrow();
    expect(() => decodeVerificationQrPayload('{"version":1,"algorithm":"vodozemac","fingerprint":"K3 ABCD","privateKey":"secret"}')).toThrow();
    expect(() => encodeVerificationQrPayload('not-a-fingerprint')).toThrow();
  });

  it('represents identity changes as pending review instead of trusted', () => {
    expect(verificationStateForContact({ verification: 'verified', changeStatus: 'unchanged' })).toBe('verified');
    expect(verificationStateForContact({ verification: 'unverified', changeStatus: 'changed-pending-review' })).toBe('changed-pending-review');
  });
});

describe('human comparison and QR match', () => {
  it('uses the complete ordered identities, deterministically, with a fixed domain', async () => {
    const { deriveHumanVerificationCode } = await import('./verificationFoundation');
    const left = 'K3 ' + 'A'.repeat(43); const right = 'K3 ' + 'B'.repeat(43);
    const forward = await deriveHumanVerificationCode(left, right);
    expect(forward).toBe(await deriveHumanVerificationCode(right, left));
    expect(forward).toMatch(/^\d{5}( · \d{5}){5}$/);
    expect(await deriveHumanVerificationCode(left, 'K3 ' + 'C'.repeat(43))).not.toBe(forward);
    const { createHash } = await import('crypto');
    const digest = createHash('sha256').update('k3ncrypt:relationship-comparison:v1\0' + JSON.stringify([left, right])).digest();
    expect(forward).toBe(Array.from({ length: 6 }, (_, i) => String(digest.readUInt16BE(i * 2)).padStart(5, '0')).join(' · '));
  });
  it('rejects a QR for another identity without making any verification decision', async () => {
    const { verificationQrMatches } = await import('./verificationFoundation');
    const peer = 'K3 ABCD EFGH_IJKL';
    expect(verificationQrMatches(encodeVerificationQrPayload(peer), peer)).toBe(true);
    expect(verificationQrMatches(encodeVerificationQrPayload('K3 OTHER IDENTITY'), peer)).toBe(false);
    expect(verificationQrMatches('{"version":2}', peer)).toBe(false);
  });
});
