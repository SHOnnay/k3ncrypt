package com.k3ncrypt.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProofGuardTest {
    private fun proof(resource: ProofResource? = ProofResource(conversationId = "c"), expiry: Long = 2_000) = DeviceAuthorizationProof(1, "p", "a", "d", "i", "relay:message", 1, "n", resource, 1_000, expiry, "signature")
    @Test fun `resource mismatch and expiry are rejected`() {
        assertTrue(ProofGuard.validateFor(proof(), "relay:message", ProofResource(conversationId = "c"), 1_500).isSuccess)
        assertFalse(ProofGuard.validateFor(proof(), "relay:message", ProofResource(conversationId = "other"), 1_500).isSuccess)
        assertFalse(ProofGuard.validateFor(proof(expiry = 1_500), "relay:message", ProofResource(conversationId = "c"), 1_500).isSuccess)
    }
}
