package com.k3ncrypt.calls

import com.k3ncrypt.security.DeviceAuthorizationProof
import com.k3ncrypt.security.ProofResource
import org.junit.Assert.assertFalse
import org.junit.Test

class CallSignalBoundaryTest {
    @Test fun `wrong operation proof cannot signal`() {
        val proof = DeviceAuthorizationProof(1, "p", "a", "d", "i", "relay:message", 1, "n", ProofResource(conversationId = "c"), 1, 2_000, "s")
        assertFalse(CallSignalBoundary { 1_000 }.authorize(ProtectedCallSignal("c", "encrypted", proof)))
    }
}
