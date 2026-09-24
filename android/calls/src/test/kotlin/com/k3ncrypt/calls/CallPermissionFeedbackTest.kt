package com.k3ncrypt.calls

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CallPermissionFeedbackTest {
    @Test fun `microphone denial blocks voice and video`() {
        assertEquals("Microphone permission is required for calls.", CallPermissionFeedback.denial("audio", false, true))
        assertEquals("Microphone permission is required for calls.", CallPermissionFeedback.denial("video", false, true))
    }
    @Test fun `camera denial blocks video but not voice`() {
        assertEquals("Camera permission is required for video calls.", CallPermissionFeedback.denial("video", true, false))
        assertNull(CallPermissionFeedback.denial("audio", true, false))
    }
}
