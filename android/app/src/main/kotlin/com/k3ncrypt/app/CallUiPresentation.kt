package com.k3ncrypt.app

import com.k3ncrypt.calls.CallSignalCodec

internal data class CallUiPresentation(
    val visible: Boolean,
    val title: String,
    val statusLabel: String,
    val message: String? = null,
    val dismissible: Boolean = false,
    val showIncomingActions: Boolean = false,
    val showMediaControls: Boolean = false,
    val showVideo: Boolean = false,
    val remoteVideoMessage: String? = null,
    val localVideoMessage: String? = null,
)

internal fun deriveCallUiPresentation(state: AndroidCallUiState): CallUiPresentation {
    val upgradeRequired = state.errorCategory == "protocol-incompatible"
    val verificationRequired = state.errorCategory == "verification-required" || state.status == "verification-required"
    val terminal = state.callId == null && state.status in setOf("ended", "rejected", "cancelled", "timeout", "expired", "failed", "verification-required")
    val visible = state.callId != null || upgradeRequired || verificationRequired || terminal
    val label = when {
        upgradeRequired -> "Upgrade required"
        verificationRequired -> "Verification required"
        else -> when (state.status.lowercase()) {
            "ringing" -> if (state.incoming) "Incoming call" else "Calling…"
            "connecting" -> "Connecting…"
            "connected" -> "Connected"
            "reconnecting" -> "Reconnecting…"
            "completed", "ended" -> "Call ended"
            "rejected" -> "Call declined"
            "cancelled" -> "Call cancelled"
            "timeout", "expired" -> "Call timed out"
            "failed" -> "Call failed"
            else -> "Call in progress"
        }
    }
    val message = when {
        upgradeRequired -> if ((state.receivedProtocolVersion ?: 1) < CallSignalCodec.CURRENT_PROTOCOL_VERSION) {
            "This contact needs a newer K3NCRYPT version to call."
        } else {
            "This call needs a newer K3NCRYPT version."
        }
        verificationRequired -> "This contact is no longer verified. Reverify it before calling."
        state.mediaError != null -> state.mediaError
        state.status == "failed" || state.status == "timeout" -> "The call could not connect. Check the connection and try again."
        else -> null
    }
    val specialTitle = when {
        upgradeRequired -> "Call requires a newer K3NCRYPT version"
        verificationRequired -> "Verified contact required"
        else -> null
    }
    val showVideo = state.callId != null && state.mediaMode == "video" && !state.incoming && state.status in setOf("connecting", "connected", "reconnecting")
    return CallUiPresentation(
        visible = visible,
        title = specialTitle ?: if (state.incoming) "Incoming ${if (state.mediaMode == "audio") "voice" else "video"} call" else "${if (state.mediaMode == "audio") "Voice" else "Video"} call",
        statusLabel = label,
        message = message,
        dismissible = upgradeRequired || verificationRequired || terminal,
        showIncomingActions = state.callId != null && state.incoming,
        showMediaControls = state.callId != null && !state.incoming && state.status in setOf("connecting", "connected", "reconnecting"),
        showVideo = showVideo,
        remoteVideoMessage = if (showVideo && state.remoteVideo == null) "Waiting for remote video" else null,
        localVideoMessage = if (showVideo && state.localVideo == null) {
            if (state.cameraEnabled) "Camera starting…" else "Camera off"
        } else null,
    )
}
