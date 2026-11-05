import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeVerificationQrPayload, deriveHumanVerificationCode, encodeVerificationQrPayload } from './verificationFoundation';

// A0: the same fixture file is read by Kotlin (SharedComparisonFixtureTest), so both clients must agree.
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/relationship-comparison.json'), 'utf8'));

describe('shared comparison fixture', () => {
  it('derives the shared 30-digit numbers in both directions', async () => {
    for (const vector of fixture.vectors) {
      expect(await deriveHumanVerificationCode(vector.own, vector.peer)).toBe(vector.number);
      expect(await deriveHumanVerificationCode(vector.peer, vector.own)).toBe(vector.number);
    }
  });
  it('encodes and decodes the shared QR payload', () => {
    expect(encodeVerificationQrPayload(fixture.qr.fingerprint)).toBe(fixture.qr.payload);
    expect(decodeVerificationQrPayload(fixture.qr.payload).fingerprint).toBe(fixture.qr.fingerprint);
  });
});
