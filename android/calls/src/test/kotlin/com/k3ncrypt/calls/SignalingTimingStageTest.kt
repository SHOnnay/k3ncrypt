package com.k3ncrypt.calls

import org.junit.Assert.assertEquals
import org.junit.Test
import org.webrtc.PeerConnection

class SignalingTimingStageTest {
    @Test
    fun remoteOfferCallbackUsesTheApprovedTimingLabel() {
        assertEquals(
            "signaling-state-have-remote-offer",
            signalingTimingStage(PeerConnection.SignalingState.HAVE_REMOTE_OFFER),
        )
    }
}
