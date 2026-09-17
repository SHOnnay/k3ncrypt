import { isValidWireEnvelope } from './listeners';

describe('relay wire-envelope schema', () => {
  it('accepts bounded opaque versioned envelopes', () => {
    expect(isValidWireEnvelope({ version: 1, strategy: 'aes-256-gcm-hkdf-v1', data: { ciphertext: 'opaque' } })).toBe(true);
    expect(isValidWireEnvelope({ version: 2, strategy: 'vodozemac-olm-v1', data: { olmMessage: 'opaque' } })).toBe(true);
  });

  it.each([
    null,
    {},
    { version: 0, strategy: 'x', data: {} },
    { version: 1.5, strategy: 'x', data: {} },
    { version: 1, strategy: '<script>', data: {} },
    { version: 1, strategy: 'x', data: null },
    { version: 1, strategy: 'x', data: {}, critical: true },
  ])('rejects malformed and unknown-critical-field input', (value) => {
    expect(isValidWireEnvelope(value)).toBe(false);
  });
});
