import { setupErrorMessage } from './setupError';

describe('safe setup error feedback', () => {
  it('explains a bounded retry delay for rate limiting without mentioning a passphrase', () => {
    const error = Object.assign(new Error('private response body'), { status: 429, retryAfterMs: 2_100 });
    const message = setupErrorMessage(error, 'contact');
    expect(message).toContain('3 seconds');
    expect(message).not.toMatch(/passphrase|private response body/i);
  });

  it('does not trust unreasonable or missing retry intervals', () => {
    expect(setupErrorMessage(Object.assign(new Error(), { status: 429, retryAfterMs: 10_000_000 }), 'invitation'))
      .toContain('Wait a moment');
    expect(setupErrorMessage(Object.assign(new Error(), { status: 429 }), 'contact'))
      .toContain('Wait a moment');
  });

  // Bug: a locked profile accepting an invitation showed new-account rules ("Choose a passphrase
  // with at least 12 characters") when the existing passphrase was blank, short or wrong.
  it('asks for the existing passphrase when unlocking an existing account, never new-account rules', () => {
    for (const error of [new Error('A passphrase or password must contain between 12 and 1024 characters.'), new Error('Invalid unlock secret'), new Error('Invalid unlock secret or corrupted secure-storage metadata.')]) {
      const message = setupErrorMessage(error, 'join', { existingAccount: true });
      expect(message).toBe('That passphrase did not unlock this device. Enter the passphrase you already use here.');
      expect(message).not.toMatch(/choose|at least 12/i);
    }
  });

  it('shows passphrase guidance only for the explicit local minimum-length error', () => {
    expect(setupErrorMessage(new Error('A passphrase or password must contain between 12 and 1024 characters.'), 'contact'))
      .toContain('at least 12 characters');
    expect(setupErrorMessage(new Error('request failed'), 'contact'))
      .not.toMatch(/passphrase|12 characters/i);
  });

  it('keeps invitation expiry and local storage failures understandable', () => {
    expect(setupErrorMessage(Object.assign(new Error(), { status: 410 }), 'join')).toContain('expired');
    expect(setupErrorMessage(Object.assign(new Error(), { name: 'QuotaExceededError' }), 'contact')).toContain('secure storage');
  });

  it('does not reflect untrusted response text in generic failures', () => {
    const message = setupErrorMessage(new Error('room capability: secret'), 'join');
    expect(message).not.toContain('secret');
    expect(message).toContain('Check the invitation');
  });
});
