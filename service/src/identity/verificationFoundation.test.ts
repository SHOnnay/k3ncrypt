import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeVerificationQrPayload, encodeVerificationQrPayload, verificationQrMatches, verificationStateForContact } from './verificationFoundation';

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

// M1c gate: the in-person check QR must be byte-identical across platforms. Android has no
// consumer yet (protocol-fixtures/v1/verification-qr.json), so Android contacts skip QR.
describe('verification QR protocol fixture', () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/verification-qr.json'), 'utf8'));
    it('web encodes exactly the fixture text and matches only that fingerprint', () => {
        expect(encodeVerificationQrPayload(fixture.accepted.fingerprint)).toBe(fixture.accepted.qrText);
        expect(verificationQrMatches(fixture.accepted.qrText, fixture.accepted.fingerprint)).toBe(true);
    });
    it.each(fixture.rejected.map((item: { case: string; qrText: string }) => [item.case, item.qrText]))('rejects %s', (_case, qrText) => {
        expect(verificationQrMatches(qrText as string, fixture.accepted.fingerprint)).toBe(false);
    });
    it('uses the same fingerprint as the shared identity fixture', () => {
        const identity = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/identity-fingerprints.json'), 'utf8'));
        expect(fixture.accepted.fingerprint).toBe(identity.accepted.fingerprint);
    });
});
