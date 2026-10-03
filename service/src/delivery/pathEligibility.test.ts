import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONNECTIVITY_FEATURE_FLAGS } from './connectivityFlags';
import { isOptionalPathEligible, optionalPathBlockers, type OptionalPathReadiness } from './pathEligibility';

const allGatesSatisfied: OptionalPathReadiness = {
    featureEnabled: true,
    privacyAllowsAddressDisclosure: true,
    contactVerifiedAndUnchanged: true,
    requiredTrustFreshnessAvailable: true,
    capabilitiesAuthenticated: true,
    peerAdmissionAuthenticatedAndCurrent: true,
    stableEnvelopeIdentityAvailable: true,
    receiverDeduplicatesBeforeDecrypt: true,
    sharedDedupeHorizonDefined: true,
    acceptanceCrashConsistent: true,
    authenticatedReceiptAvailable: true,
    outboxCompletionSupportsPath: true,
};

describe('optional path fail-closed eligibility contract', () => {
    it('ships with LAN and direct delivery feature flags disabled', () => {
        expect(CONNECTIVITY_FEATURE_FLAGS).toEqual({ lanDelivery: false, directDelivery: false });
    });

    it('matches the shared language-neutral eligibility fixtures', () => {
        const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../protocol-fixtures/v1/optional-path-eligibility.json'), 'utf8')) as {
            cases: Array<{ name: string; readiness: OptionalPathReadiness; eligible: boolean; blockers: string[] }>;
        };
        for (const item of fixture.cases) {
            expect(isOptionalPathEligible('lan', item.readiness)).toBe(item.eligible);
            expect(optionalPathBlockers(item.readiness)).toEqual(item.blockers);
        }
    });

    it('blocks optional paths when the local feature flag is off', () => {
        const readiness = { ...allGatesSatisfied, featureEnabled: false };
        expect(isOptionalPathEligible('lan', readiness)).toBe(false);
        expect(optionalPathBlockers(readiness)).toEqual(['feature-disabled']);
    });

    it('requires every privacy, identity, admission, dedupe, receipt, and outbox gate', () => {
        const fields: Array<keyof OptionalPathReadiness> = [
            'privacyAllowsAddressDisclosure',
            'contactVerifiedAndUnchanged',
            'requiredTrustFreshnessAvailable',
            'capabilitiesAuthenticated',
            'peerAdmissionAuthenticatedAndCurrent',
            'stableEnvelopeIdentityAvailable',
            'receiverDeduplicatesBeforeDecrypt',
            'sharedDedupeHorizonDefined',
            'acceptanceCrashConsistent',
            'authenticatedReceiptAvailable',
            'outboxCompletionSupportsPath',
        ];
        for (const field of fields) {
            const readiness = { ...allGatesSatisfied, [field]: false };
            expect(isOptionalPathEligible('lan', readiness)).toBe(false);
        }
        expect(isOptionalPathEligible('direct', allGatesSatisfied)).toBe(true);
    });

    it('keeps the unresolved dedupe horizon as an explicit blocker', () => {
        const readiness = { ...allGatesSatisfied, sharedDedupeHorizonDefined: false };
        expect(optionalPathBlockers(readiness)).toContain('dedupe-horizon-undefined');
        expect(isOptionalPathEligible('lan', readiness)).toBe(false);
    });
});
