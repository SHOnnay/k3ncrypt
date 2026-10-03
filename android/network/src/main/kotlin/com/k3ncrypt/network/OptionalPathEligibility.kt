package com.k3ncrypt.network

/** Build defaults only; a flag never substitutes for the eligibility gates below. */
object ConnectivityFeatureFlags {
    const val lanDelivery = false
    const val directDelivery = false
}

data class OptionalPathReadiness(
    val featureEnabled: Boolean,
    val privacyAllowsAddressDisclosure: Boolean,
    val contactVerifiedAndUnchanged: Boolean,
    val requiredTrustFreshnessAvailable: Boolean,
    val capabilitiesAuthenticated: Boolean,
    val peerAdmissionAuthenticatedAndCurrent: Boolean,
    val stableEnvelopeIdentityAvailable: Boolean,
    val receiverDeduplicatesBeforeDecrypt: Boolean,
    val sharedDedupeHorizonDefined: Boolean,
    val acceptanceCrashConsistent: Boolean,
    val authenticatedReceiptAvailable: Boolean,
    val outboxCompletionSupportsPath: Boolean,
)

/** Pure eligibility checklist. It has no discovery, socket, identity, or trust side effects. */
object OptionalPathEligibility {
    fun blockers(value: OptionalPathReadiness): List<String> = buildList {
        if (!value.featureEnabled) add("feature-disabled")
        if (!value.privacyAllowsAddressDisclosure) add("privacy-disallows-address-disclosure")
        if (!value.contactVerifiedAndUnchanged) add("contact-not-verified-and-unchanged")
        if (!value.requiredTrustFreshnessAvailable) add("trust-freshness-unavailable")
        if (!value.capabilitiesAuthenticated) add("capability-not-authenticated")
        if (!value.peerAdmissionAuthenticatedAndCurrent) add("peer-admission-unavailable")
        if (!value.stableEnvelopeIdentityAvailable) add("stable-envelope-identity-unavailable")
        if (!value.receiverDeduplicatesBeforeDecrypt) add("receiver-deduplication-unavailable")
        if (!value.sharedDedupeHorizonDefined) add("dedupe-horizon-undefined")
        if (!value.acceptanceCrashConsistent) add("acceptance-not-crash-consistent")
        if (!value.authenticatedReceiptAvailable) add("authenticated-receipt-unavailable")
        if (!value.outboxCompletionSupportsPath) add("outbox-completion-incompatible")
    }

    fun isEligible(path: DeliveryPathKind, value: OptionalPathReadiness): Boolean =
        path != DeliveryPathKind.RELAY && blockers(value).isEmpty()
}
