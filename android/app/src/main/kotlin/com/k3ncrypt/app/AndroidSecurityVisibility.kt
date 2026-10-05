package com.k3ncrypt.app

internal enum class AndroidIdentityBinding { PINNED, NOT_PINNED }
internal enum class AndroidRelaySocketState { CONNECTED, DISCONNECTED }
internal enum class AndroidSendAttemptState { SENDING, RELAY_ACKNOWLEDGED, COULD_NOT_CONFIRM }

internal data class AndroidSecurityVisibility(
    val identityBinding: AndroidIdentityBinding,
    val verificationRecorded: Boolean,
    val verificationState: ContactVerificationState,
    val identityChangeRecorded: Boolean,
    val transport: String,
    val relaySocket: AndroidRelaySocketState,
    val sessionHealthRecorded: Boolean,
)

internal data class AndroidMessageDeliveryVisibility(val label: String, val explanation: String)

internal fun deriveAndroidSecurityVisibility(
    peerRoutingId: String,
    peerIdentityReference: String,
    relayConnected: Boolean,
    verification: ContactVerificationState = ContactVerificationState.UNKNOWN,
): AndroidSecurityVisibility = AndroidSecurityVisibility(
    identityBinding = if (peerRoutingId.isNotBlank() && peerIdentityReference.startsWith("K3 ")) AndroidIdentityBinding.PINNED else AndroidIdentityBinding.NOT_PINNED,
    verificationRecorded = verification == ContactVerificationState.VERIFIED,
    verificationState = verification,
    identityChangeRecorded = verification == ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW,
    transport = "Relay",
    relaySocket = if (relayConnected) AndroidRelaySocketState.CONNECTED else AndroidRelaySocketState.DISCONNECTED,
    sessionHealthRecorded = false,
)

internal fun deriveAndroidMessageDeliveryVisibility(state: AndroidSendAttemptState): AndroidMessageDeliveryVisibility = when (state) {
    AndroidSendAttemptState.SENDING -> AndroidMessageDeliveryVisibility(
        "Sending through relay…",
        "The app is waiting for the relay response.",
    )
    AndroidSendAttemptState.RELAY_ACKNOWLEDGED -> AndroidMessageDeliveryVisibility(
        "Accepted by relay · recipient status unknown",
        "The acknowledgement does not distinguish live recipient acceptance from mailbox storage. No authenticated peer receipt is available.",
    )
    AndroidSendAttemptState.COULD_NOT_CONFIRM -> AndroidMessageDeliveryVisibility(
        "Could not confirm sending · recipient status unknown",
        "The app did not receive a confirmed result. A timeout can leave the relay outcome unknown.",
    )
}

internal fun verificationLabel(state: ContactVerificationState): String = when (state) {
    ContactVerificationState.VERIFIED -> "Verified"
    ContactVerificationState.UNVERIFIED -> "Unverified"
    ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW -> "Identity changed · review required"
    ContactVerificationState.UNKNOWN -> "Verification unavailable"
}
