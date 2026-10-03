import type { DeliveryPathKind } from './contracts';

export interface OptionalPathReadiness {
    readonly featureEnabled: boolean;
    readonly privacyAllowsAddressDisclosure: boolean;
    readonly contactVerifiedAndUnchanged: boolean;
    readonly requiredTrustFreshnessAvailable: boolean;
    readonly capabilitiesAuthenticated: boolean;
    readonly peerAdmissionAuthenticatedAndCurrent: boolean;
    readonly stableEnvelopeIdentityAvailable: boolean;
    readonly receiverDeduplicatesBeforeDecrypt: boolean;
    readonly sharedDedupeHorizonDefined: boolean;
    readonly acceptanceCrashConsistent: boolean;
    readonly authenticatedReceiptAvailable: boolean;
    readonly outboxCompletionSupportsPath: boolean;
}

export type OptionalPathBlocker =
    | 'feature-disabled'
    | 'privacy-disallows-address-disclosure'
    | 'contact-not-verified-and-unchanged'
    | 'trust-freshness-unavailable'
    | 'capability-not-authenticated'
    | 'peer-admission-unavailable'
    | 'stable-envelope-identity-unavailable'
    | 'receiver-deduplication-unavailable'
    | 'dedupe-horizon-undefined'
    | 'acceptance-not-crash-consistent'
    | 'authenticated-receipt-unavailable'
    | 'outbox-completion-incompatible';

/**
 * A conservative policy checklist. It has no network side effects and does
 * not perform authentication; every positive input must come from the
 * corresponding reviewed runtime boundary before this can authorize a path.
 */
export const optionalPathBlockers = (readiness: OptionalPathReadiness): OptionalPathBlocker[] => {
    const blockers: OptionalPathBlocker[] = [];
    if (!readiness.featureEnabled) blockers.push('feature-disabled');
    if (!readiness.privacyAllowsAddressDisclosure) blockers.push('privacy-disallows-address-disclosure');
    if (!readiness.contactVerifiedAndUnchanged) blockers.push('contact-not-verified-and-unchanged');
    if (!readiness.requiredTrustFreshnessAvailable) blockers.push('trust-freshness-unavailable');
    if (!readiness.capabilitiesAuthenticated) blockers.push('capability-not-authenticated');
    if (!readiness.peerAdmissionAuthenticatedAndCurrent) blockers.push('peer-admission-unavailable');
    if (!readiness.stableEnvelopeIdentityAvailable) blockers.push('stable-envelope-identity-unavailable');
    if (!readiness.receiverDeduplicatesBeforeDecrypt) blockers.push('receiver-deduplication-unavailable');
    if (!readiness.sharedDedupeHorizonDefined) blockers.push('dedupe-horizon-undefined');
    if (!readiness.acceptanceCrashConsistent) blockers.push('acceptance-not-crash-consistent');
    if (!readiness.authenticatedReceiptAvailable) blockers.push('authenticated-receipt-unavailable');
    if (!readiness.outboxCompletionSupportsPath) blockers.push('outbox-completion-incompatible');
    return blockers;
};

export const isOptionalPathEligible = (path: Exclude<DeliveryPathKind, 'relay'>, readiness: OptionalPathReadiness): boolean =>
    path !== 'lan' && path !== 'direct' ? false : optionalPathBlockers(readiness).length === 0;
