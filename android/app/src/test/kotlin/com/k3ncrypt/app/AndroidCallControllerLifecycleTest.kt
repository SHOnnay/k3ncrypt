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

    @Test fun `simultaneous unanswered outgoing calls choose the same lexical call id winner`() {
        assertTrue(shouldKeepOutgoingCallOnCollision("call-a", "call-b", "ringing", false))
        assertFalse(shouldKeepOutgoingCallOnCollision("call-b", "call-a", "ringing", false))
    }

    @Test fun `incoming or negotiating calls do not use collision replacement`() {
        assertFalse(shouldKeepOutgoingCallOnCollision("call-a", "call-b", "ringing", true))
        assertFalse(shouldKeepOutgoingCallOnCollision("call-a", "call-b", "connecting", false))
    }

    @Test fun `both platforms choose the lower stable routing id as reconnect offer owner`() {
        assertTrue(isCallReconnectOfferOwner("route-a", "route-b"))
        assertFalse(isCallReconnectOfferOwner("route-b", "route-a"))
    }
}
