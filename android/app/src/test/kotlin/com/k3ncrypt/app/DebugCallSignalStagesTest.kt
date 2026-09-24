package com.k3ncrypt.app

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DebugCallSignalStagesTest {
    @Test
    fun acceptsOnlyTheApprovedMetadataLabels() {
        DebugInspectionStore.setCallSignalStage("signal-sent")
        assertTrue(DebugInspectionStore.callSignalStageHistory().contains("signal-sent"))

        try {
            DebugInspectionStore.setCallSignalStage("signal-sent:device-id")
            fail("Arbitrary diagnostic data must not be accepted")
        } catch (_: IllegalArgumentException) {
            // The stage API is intentionally an enum-like allowlist.
        }
    }
}
