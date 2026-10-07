import { webcrypto, createHash } from 'crypto';
import { toBase64Url, fromBase64Url } from './base64url';
import { fingerprintVodozemacIdentity } from '../identity/vodozemacIdentity';
it('preserves fingerprint and base64 bytes in a real Node environment without window', async () => {
  expect(typeof window).toBe('undefined');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const bytes = Uint8Array.from([0, 255, 254, 253]); expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url')); expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  const identity = { curve25519: 'A'.repeat(43), ed25519: 'B'.repeat(43) };
  const hash = createHash('sha256').update(`k3ncrypt:vodozemac-identity:v1\0${identity.curve25519}\0${identity.ed25519}`).digest('base64url').toUpperCase().match(/.{1,4}/g)!.join(' ');
  expect(await fingerprintVodozemacIdentity(identity)).toBe(`K3 ${hash}`);
});
