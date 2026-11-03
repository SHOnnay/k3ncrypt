import { contactDisplayName, unlockProgressCopy } from './copy';

describe('contact labels', () => {
  it('uses a stable short conversation suffix for generic labels', () => {
    expect(contactDisplayName('Private contact', '12345678-1234-1234-1234-12345678abcd')).toBe('Contact · ABCD');
    expect(contactDisplayName('Contact', '87654321-1234-1234-1234-12345678ef01')).toBe('Contact · EF01');
  });

  it('preserves a local nickname as the primary label', () => {
    expect(contactDisplayName('Mira', '12345678-1234-1234-1234-12345678abcd')).toBe('Mira');
  });
});

// UX A11: unlocking shows where it is, in plain words.
it('describes each unlock phase in plain words', () => {
  expect(unlockProgressCopy('unlocking')).toEqual({ label: 'Unlocking your private space…', step: 1, of: 3 });
  expect(unlockProgressCopy('opening')).toEqual({ label: 'Opening your chats…', step: 2, of: 3 });
  expect(unlockProgressCopy('connecting')).toEqual({ label: 'Connecting securely…', step: 3, of: 3 });
});
