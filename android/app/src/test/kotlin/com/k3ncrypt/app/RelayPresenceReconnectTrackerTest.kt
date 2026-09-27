package com.k3ncrypt.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayPresenceReconnectTrackerTest {
    @Test fun `initial connection does not request a redundant rejoin`() {
        val tracker = RelayPresenceReconnectTracker()
        assertFalse(tracker.onConnectionChanged(false))
        assertFalse(tracker.onConnectionChanged(true))
        assertFalse(tracker.onConnectionChanged(true))
    }

    @Test fun `socket reconnection requests one proof backed rejoin`() {
        val tracker = RelayPresenceReconnectTracker()
        tracker.onConnectionChanged(true)

        assertFalse(tracker.onConnectionChanged(false))
        assertTrue(tracker.onConnectionChanged(true))
        assertFalse(tracker.onConnectionChanged(true))
    }
}
