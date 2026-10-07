import { contactDisplayName } from './copy';

describe('contact labels', () => {
  it('uses a stable short conversation suffix for generic labels', () => {
    expect(contactDisplayName('Private contact', '12345678-1234-1234-1234-12345678abcd')).toBe('Contact · ABCD');
    expect(contactDisplayName('Contact', '87654321-1234-1234-1234-12345678ef01')).toBe('Contact · EF01');
  });

  it('preserves a local nickname as the primary label', () => {
    expect(contactDisplayName('Mira', '12345678-1234-1234-1234-12345678abcd')).toBe('Mira');
  });
});
