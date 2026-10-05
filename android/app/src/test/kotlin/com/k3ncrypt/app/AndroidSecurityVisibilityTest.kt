package com.k3ncrypt.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSecurityVisibilityTest {
    @Test fun pinnedFingerprintIsNotPromotedToRecordedVerification() {
        val visibility = deriveAndroidSecurityVisibility("peer-route", "K3 EXAMPLE FINGERPRINT", true)
        assertEquals(AndroidIdentityBinding.PINNED, visibility.identityBinding)
        assertFalse(visibility.verificationRecorded)
        assertFalse(visibility.identityChangeRecorded)
    }

    @Test fun activeMessagingPathIsRelayAndSocketStateIsOnlySocketState() {
        val connected = deriveAndroidSecurityVisibility("peer-route", "K3 EXAMPLE FINGERPRINT", true)
        val disconnected = deriveAndroidSecurityVisibility("peer-route", "K3 EXAMPLE FINGERPRINT", false)
        assertEquals("Relay", connected.transport)
        assertEquals(AndroidRelaySocketState.CONNECTED, connected.relaySocket)
        assertEquals(AndroidRelaySocketState.DISCONNECTED, disconnected.relaySocket)
        assertFalse(connected.sessionHealthRecorded)
    }

    @Test fun relayAcknowledgementDoesNotClaimRecipientReceipt() {
        val visibility = deriveAndroidMessageDeliveryVisibility(AndroidSendAttemptState.RELAY_ACKNOWLEDGED)
        assertTrue(visibility.label.contains("recipient status unknown"))
        assertTrue(visibility.explanation.contains("mailbox storage"))
        assertFalse(visibility.label.contains("Delivered"))
    }

    @Test fun failedAndInProgressSendStatesRemainNeutral() {
        assertEquals("Sending through relay…", deriveAndroidMessageDeliveryVisibility(AndroidSendAttemptState.SENDING).label)
        assertTrue(deriveAndroidMessageDeliveryVisibility(AndroidSendAttemptState.COULD_NOT_CONFIRM).label.startsWith("Could not confirm"))
    }
}
