package com.k3ncrypt.app

import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class DebugCallSignalStagesTest {
    @Test
    fun invalidCallbackDiagnosticsAreDroppedWithoutThrowing() {
        val timingBefore = DebugInspectionStore.callTimingStageHistory()
        val observerBefore = DebugInspectionStore.sdpObserverStageHistory()
        DebugInspectionStore.setCallTimingDiagnostic("signaling-state-have_remote_offer")
        DebugInspectionStore.setSdpObserverStage("unrecognized-callback")
        assertEquals(timingBefore, DebugInspectionStore.callTimingStageHistory())
        assertEquals(observerBefore, DebugInspectionStore.sdpObserverStageHistory())
    }

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
