package com.k3ncrypt.app

import com.k3ncrypt.calls.CallSignalCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallUiPresentationTest {
    @Test fun `verified outgoing audio and video calls expose the existing media UI`() {
        val audio = deriveCallUiPresentation(AndroidCallUiState(callId = "audio", mediaMode = "audio", status = "connected"))
        val video = deriveCallUiPresentation(AndroidCallUiState(callId = "video", mediaMode = "video", status = "connected"))
        assertTrue(audio.visible)
        assertEquals("Connected", audio.statusLabel)
        assertTrue(audio.showMediaControls)
        assertFalse(audio.showVideo)
        assertTrue(video.showMediaControls)
        assertTrue(video.showVideo)
    }

    @Test fun `outgoing call exposes hangup but not media controls before peer acceptance`() {
        val presentation = deriveCallUiPresentation(AndroidCallUiState(callId = "call", mediaMode = "video", status = "ringing"))
        assertTrue(presentation.visible)
        assertFalse(presentation.showMediaControls)
        assertFalse(presentation.showVideo)
    }

    @Test fun `incoming audio and video invitations expose acceptance without video media`() {
        listOf("audio", "video").forEach { mode ->
            val presentation = deriveCallUiPresentation(AndroidCallUiState(callId = "call", mediaMode = mode, status = "incoming", incoming = true))
            assertTrue(presentation.showIncomingActions)
            assertFalse(presentation.showMediaControls)
            assertFalse(presentation.showVideo)
        }
    }

    @Test fun `video rendering reports remote waiting and local camera state truthfully`() {
        val waiting = deriveCallUiPresentation(AndroidCallUiState(callId = "call", mediaMode = "video", status = "connected", cameraEnabled = true))
        assertEquals("Waiting for remote video", waiting.remoteVideoMessage)
        assertEquals("Camera starting…", waiting.localVideoMessage)

        val cameraOff = deriveCallUiPresentation(AndroidCallUiState(callId = "call", mediaMode = "video", status = "connected", cameraEnabled = false))
        assertEquals("Camera off", cameraOff.localVideoMessage)
    }

    @Test fun `verification termination remains visible and is never labeled as a network failure`() {
        val presentation = deriveCallUiPresentation(AndroidCallUiState(status = "verification-required", errorCategory = "verification-required", mediaMode = "video"))
        assertTrue(presentation.visible)
        assertTrue(presentation.dismissible)
        assertEquals("Verified contact required", presentation.title)
        assertEquals("Verification required", presentation.statusLabel)
        assertTrue(presentation.message.orEmpty().contains("Reverify"))
    }

    @Test fun `protocol incompatibility has a distinct upgrade message`() {
        val older = deriveCallUiPresentation(AndroidCallUiState(errorCategory = "protocol-incompatible", receivedProtocolVersion = 1))
        assertTrue(older.visible)
        assertEquals("Upgrade required", older.statusLabel)
        assertTrue(older.title.contains("newer K3NCRYPT version"))
        assertTrue(older.message.orEmpty().contains("contact needs a newer"))
        val newer = deriveCallUiPresentation(AndroidCallUiState(errorCategory = "protocol-incompatible", receivedProtocolVersion = CallSignalCodec.CURRENT_PROTOCOL_VERSION + 1))
        assertTrue(newer.message.orEmpty().contains("call needs a newer"))
    }

    @Test fun `call statuses distinguish ringing connection reconnect and terminal results`() {
        assertEquals("Calling…", deriveCallUiPresentation(AndroidCallUiState(callId = "call", status = "ringing")).statusLabel)
        assertEquals("Incoming call", deriveCallUiPresentation(AndroidCallUiState(callId = "call", status = "ringing", incoming = true)).statusLabel)
        assertEquals("Connecting…", deriveCallUiPresentation(AndroidCallUiState(callId = "call", status = "connecting")).statusLabel)
        assertEquals("Reconnecting…", deriveCallUiPresentation(AndroidCallUiState(callId = "call", status = "reconnecting")).statusLabel)
        assertEquals("Call ended", deriveCallUiPresentation(AndroidCallUiState(status = "ended")).statusLabel)
        assertEquals("Call failed", deriveCallUiPresentation(AndroidCallUiState(status = "failed")).statusLabel)
        assertEquals("Call timed out", deriveCallUiPresentation(AndroidCallUiState(status = "expired")).statusLabel)
    }
}
