package com.k3ncrypt.calls

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallReplayGuardTest {
    @Test fun `rejects repeated nonces and signals for a finished call until expiry`() {
        val guard = CallReplayGuard()
        assertTrue(guard.accept("call-a", "nonce-a", 10_000, 1_000))
        assertFalse(guard.accept("call-b", "nonce-a", 10_000, 1_001))
        assertTrue(guard.accept("call-a", "nonce-b", 10_000, 1_002))
        guard.finish("call-a", 10_000, 1_003)
        assertFalse(guard.accept("call-a", "nonce-c", 10_000, 1_004))
        assertFalse(guard.accept("call-b", "nonce-d", 1_000, 1_004))
        assertTrue(guard.accept("call-a", "nonce-e", 20_000, 10_000))
    }
}
