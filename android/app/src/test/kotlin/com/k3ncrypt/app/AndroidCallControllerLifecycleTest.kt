package com.k3ncrypt.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCallControllerLifecycleTest {
    @Test fun `expired incoming state is eligible for cleanup before a new invite`() {
        assertTrue(shouldExpireCallSetupBeforeInvite("old-call", "incoming", 99L, 100L))
    }

    @Test fun `expired accepted but unconnected state is eligible for cleanup`() {
        assertTrue(shouldExpireCallSetupBeforeInvite("old-call", "connecting", 99L, 100L))
    }

    @Test fun `active connected call is not replaced by a later invite`() {
        assertFalse(shouldExpireCallSetupBeforeInvite("active-call", "connected", 99L, 100L))
        assertFalse(shouldExpireCallSetupBeforeInvite("active-call", "reconnecting", 99L, 100L))
    }

    @Test fun `missing or unexpired call state is not expired`() {
        assertFalse(shouldExpireCallSetupBeforeInvite(null, "idle", 99L, 100L))
        assertFalse(shouldExpireCallSetupBeforeInvite("active-call", "connecting", 101L, 100L))
    }
}
