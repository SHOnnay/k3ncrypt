export type IdentityRecoveryAction = 'verify-again' | 'reject-change' | 'block-conversation';
export type IdentityRecoveryOutcome = 'review-required' | 'rejected-unverified' | 'conversation-blocked';

/** Presentation-only recovery state. It never accepts or replaces an identity. */
export const identityRecoveryOutcome = (action: IdentityRecoveryAction): IdentityRecoveryOutcome => {
    if (action === 'verify-again') return 'review-required';
    if (action === 'reject-change') return 'rejected-unverified';
    return 'conversation-blocked';
};
