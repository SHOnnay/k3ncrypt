package com.k3ncrypt.experiment.localsession

internal enum class Stage {
    INACTIVE, ADVERTISING, DISCOVERING, PEER_FOUND, AUTHENTICATING, WAITING_ACCEPTANCE,
    CONNECTING, CONNECTED, DISCONNECTED, FAILED
}

internal enum class SafeReason {
    USER_ENDED, NETWORK_UNAVAILABLE, UNSUPPORTED_NETWORK_PROFILE, PERMISSION_DENIED,
    NSD_START_FAILED, NSD_RESOLVE_FAILED, DISCOVERY_TIMEOUT, RESOLVE_TIMEOUT,
    CONNECT_TIMEOUT, ACCEPT_TIMEOUT, PAIRING_CODE_REQUIRED, PAIRING_AUTH_FAILED,
    FRAME_TOO_LARGE, BAD_MAGIC, BAD_VERSION, UNEXPECTED_MESSAGE, FRAME_INVALID,
    FRAME_TIMEOUT, CONTEXT_MISMATCH, RATE_LIMIT, RESOURCE_LIMIT, PEER_DISCONNECTED,
    SESSION_EXPIRED, BACKGROUNDED, NETWORK_CHANGED, CLEANUP_TIMEOUT, CRYPTO_FAILED
}

internal data class Snapshot(
    val stage: Stage = Stage.INACTIVE,
    val reason: SafeReason? = null,
    val internet: String = "unknown",
    val event: String = "Ready",
    val messages: List<String> = emptyList(),
    val generation: Int = 0,
    val role: String = "none",
    val pairingCode: String? = null,
    val pairingStatus: String = "not established",
    val encryptionStatus: String = "not established",
    val pairingVerified: Boolean = false,
    val encryptionActive: Boolean = false,
) {
    val canAccept get() = stage == Stage.WAITING_ACCEPTANCE
    val connected get() = stage == Stage.CONNECTED
    val secureConnected get() = connected && pairingVerified && encryptionActive
}

/** Main-thread-owned model. All async results must present their captured generation. */
internal class ExperimentState {
    @Volatile var value = Snapshot()
        private set

    fun begin(role: String): Int {
        val next = value.generation + 1
        value = Snapshot(
            stage = if (role == "advertiser") Stage.ADVERTISING else Stage.DISCOVERING,
            generation = next,
            role = role,
            event = "Started",
            pairingStatus = if (role == "advertiser") "pairing code generated" else "pairing code required",
        )
        return next
    }

    fun failBeforeStart(reason: SafeReason, event: String): Int {
        val next = value.generation + 1
        value = Snapshot(stage = Stage.FAILED, reason = reason, generation = next, event = event)
        return next
    }

    fun transition(generation: Int, stage: Stage, event: String, reason: SafeReason? = null): Boolean {
        if (generation != value.generation || value.stage == Stage.INACTIVE) return false
        val allowed = when (value.stage) {
            Stage.ADVERTISING -> setOf(Stage.ADVERTISING, Stage.AUTHENTICATING, Stage.FAILED, Stage.DISCONNECTED)
            Stage.DISCOVERING -> setOf(Stage.DISCOVERING, Stage.PEER_FOUND, Stage.FAILED, Stage.DISCONNECTED)
            Stage.PEER_FOUND -> setOf(Stage.DISCOVERING, Stage.AUTHENTICATING, Stage.CONNECTING, Stage.FAILED, Stage.DISCONNECTED)
            Stage.AUTHENTICATING -> setOf(Stage.WAITING_ACCEPTANCE, Stage.CONNECTING, Stage.CONNECTED, Stage.FAILED, Stage.DISCONNECTED)
            Stage.WAITING_ACCEPTANCE -> setOf(Stage.CONNECTING, Stage.FAILED, Stage.DISCONNECTED)
            Stage.CONNECTING -> setOf(Stage.AUTHENTICATING, Stage.WAITING_ACCEPTANCE, Stage.CONNECTED, Stage.FAILED, Stage.DISCONNECTED)
            Stage.CONNECTED -> setOf(Stage.FAILED, Stage.DISCONNECTED)
            Stage.DISCONNECTED, Stage.FAILED, Stage.INACTIVE -> emptySet()
        }
        if (stage !in allowed) return false
        value = value.copy(stage = stage, event = event, reason = reason)
        return true
    }

    fun updateInternet(value: String) { this.value = this.value.copy(internet = value) }

    fun annotate(generation: Int, event: String, reason: SafeReason? = null) {
        if (generation != value.generation) return
        value = value.copy(event = event, reason = reason)
    }

    fun setPairingCode(generation: Int, displayCode: String?) {
        if (generation != value.generation) return
        value = value.copy(pairingCode = displayCode)
    }

    fun updateSecurity(
        generation: Int,
        pairing: String,
        encryption: String,
        pairingVerified: Boolean = value.pairingVerified,
        encryptionActive: Boolean = value.encryptionActive,
    ) {
        if (generation != value.generation) return
        value = value.copy(
            pairingStatus = pairing,
            encryptionStatus = encryption,
            pairingVerified = pairingVerified,
            encryptionActive = encryptionActive,
        )
    }

    fun append(generation: Int, message: String): Boolean {
        if (generation != value.generation || value.stage != Stage.CONNECTED) return false
        value = value.copy(messages = (value.messages + message).takeLast(32))
        return true
    }

    fun stop(reason: SafeReason): Int {
        val next = value.generation + 1
        value = Snapshot(stage = Stage.DISCONNECTED, reason = reason, generation = next, event = "Stopped")
        return next
    }

    fun invalidateGeneration(): Int {
        val next = value.generation + 1
        value = value.copy(generation = next)
        return next
    }

    fun clearTemporaryData(generation: Int) {
        if (generation != value.generation) return
        value = value.copy(
            messages = emptyList(),
            pairingCode = null,
            pairingStatus = "not established",
            encryptionStatus = "not established",
            pairingVerified = false,
            encryptionActive = false,
        )
    }

    fun expire(generation: Int): Boolean = transition(generation, Stage.FAILED, "Session expired", SafeReason.SESSION_EXPIRED)
}
