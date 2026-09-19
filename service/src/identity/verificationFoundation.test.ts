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
