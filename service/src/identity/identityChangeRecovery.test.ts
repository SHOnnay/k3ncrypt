import { identityRecoveryOutcome } from './identityChangeRecovery';

describe('identity change recovery', () => {
  it('never treats review or rejection as trust', () => {
    expect(identityRecoveryOutcome('verify-again')).toBe('review-required');
    expect(identityRecoveryOutcome('reject-change')).toBe('rejected-unverified');
  });

  it('offers an explicit blocking outcome', () => {
    expect(identityRecoveryOutcome('block-conversation')).toBe('conversation-blocked');
  });
});
