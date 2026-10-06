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
        "Sending…",
        "K3NCRYPT is waiting for the service to accept this message.",
    )
    AndroidSendAttemptState.RELAY_ACKNOWLEDGED -> AndroidMessageDeliveryVisibility(
        "Sent · recipient not confirmed",
        "K3NCRYPT could not confirm that the recipient received this message.",
    )
    AndroidSendAttemptState.COULD_NOT_CONFIRM -> AndroidMessageDeliveryVisibility(
        "Couldn’t confirm sending",
        "The message may or may not have been accepted. Check your connection before retrying.",
    )
}

internal fun verificationLabel(state: ContactVerificationState): String = when (state) {
    ContactVerificationState.VERIFIED -> "Verified"
    ContactVerificationState.UNVERIFIED -> "Unverified"
    ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW -> "Identity changed · needs your review"
    ContactVerificationState.UNKNOWN -> "Verification unavailable"
}
