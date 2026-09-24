package com.k3ncrypt.calls

object CallPermissionFeedback {
    fun denial(mediaMode: String, microphoneGranted: Boolean, cameraGranted: Boolean): String? = when {
        !microphoneGranted -> "Microphone permission is required for calls."
        mediaMode == "video" && !cameraGranted -> "Camera permission is required for video calls."
        else -> null
    }
}
