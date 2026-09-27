package com.k3ncrypt.app

import android.os.SystemClock
import android.util.Log
import com.k3ncrypt.calls.AndroidCallHealthSnapshot
import com.k3ncrypt.calls.AndroidRemoteDescriptionDiagnostic
/**
 * In-memory metadata compiled only into the debug source set. No exported
 * provider or release inspection surface exists. This never stores invitation
 * capabilities, proofs, encrypted envelopes, or key material.
 */
internal object DebugInspectionStore {
    @Volatile private var conversationHash: String? = null
    @Volatile private var trustState: String = "unknown"
    @Volatile private var connectionState: String = "not_started"
    @Volatile private var connectionPhase: String = "not_started"
    @Volatile private var deliveryState: String = "idle"
    @Volatile private var lastActivityTimestamp: Long = 0L
    @Volatile private var deliveryStage: String? = null
    private val deliveryStages = java.util.concurrent.CopyOnWriteArrayList<String>()
    private val callSignalStages = java.util.concurrent.CopyOnWriteArrayList<String>()
    private val callTimingStages = java.util.concurrent.CopyOnWriteArrayList<String>()
    private val sdpObserverStages = java.util.concurrent.CopyOnWriteArrayList<String>()
    private val callHealthSnapshots = java.util.concurrent.CopyOnWriteArrayList<String>()
    @Volatile private var callTimingStartedAt = 0L
    @Volatile private var callSignalResultCategory: String? = null
    @Volatile private var remoteDescriptionDiagnostic: String? = null
    private val callDigestInputDiagnostics = java.util.concurrent.ConcurrentHashMap<String, DigestInputMetadata>()
    @Volatile private var inboundMessageResultCategory: String? = null
    private val allowedCallSignalResultCategories = setOf(
        "accepted", "sender_not_joined", "rate_limited", "invalid_envelope",
        "proof_rejected", "recipient_unavailable", "relay_disconnected",
        "ack_timeout", "invalid_response", "rejected",
    )
    private val allowedInboundMessageResultCategories = setOf(
        "accepted", "duplicate", "session-renewal-not-authorized", "invalid-envelope",
        "identity-or-trust", "runtime-or-persistence", "receive-failed", "conversation-mismatch",
    )
    private val allowedCallSignalStages = setOf(
        "identity-restored", "conversation-restored", "proof-issued", "relay-connected",
        "signal-sent", "signal-received", "signal-ack", "call-created",
        "offer-created", "offer-signal-sent", "offer-received", "answer-created", "answer-received",
        "answer-signal-sent", "ice-signal-sent", "accept-signal-received",
        "incoming-signal-received", "call-state-created", "incoming-ui-triggered",
        "accept-action", "decline-action", "ice-connected", "media-connected", "call-ended",
        "relay-call-signal-arrived",
        "ice-gathering-complete", "ice-candidate-pair-selected", "ice-candidate-pair-not-selected",
        "ice-failure-no-selected-pair", "ice-failure-selected-pair-not-connected",
        "ice-candidate-add-failed",
        "app-lifecycle-foreground", "app-lifecycle-background",
        "call-cleanup-timeout", "call-cleanup-failure", "call-cleanup-ended",
        "call-cleanup-rejected", "call-cleanup-cancelled", "call-cleanup-expired",
    )
    private val allowedIceDiagnostics = buildSet {
        addAll(setOf("ice-gathering-complete", "ice-candidate-pair-selected", "ice-candidate-pair-not-selected", "ice-failure-no-selected-pair", "ice-failure-selected-pair-not-connected", "ice-candidate-add-failed"))
        for (type in setOf("host", "srflx", "relay", "prflx", "unknown")) {
            add("ice-local-candidate-$type")
            add("ice-remote-candidate-$type-received")
            add("ice-remote-candidate-$type-added")
            add("ice-remote-candidate-$type-rejected")
            add("ice-selected-local-$type")
            add("ice-selected-remote-$type")
        }
        for (state in setOf("new", "checking", "connected", "completed", "disconnected", "failed", "closed")) add("ice-state-$state")
    }
    private val allowedCallTimingStages = setOf(
        "peer-connection-create-start", "peer-connection-created", "peer-connection-create-failed", "peer-connection-closed",
        "set-local-description-start", "set-local-description-complete", "set-local-description-failed",
        "set-remote-description-start", "set-remote-description-complete", "set-remote-description-failed",
        "ice-gathering-start", "ice-gathering-complete", "first-local-candidate", "first-remote-candidate-received",
        "add-ice-candidate-succeeded", "add-ice-candidate-failed", "ice-checking-start", "ice-connected",
        "ice-disconnected", "ice-failure", "candidate-pair-selected", "candidate-pair-not-selected",
        "peer-connection-state-new", "peer-connection-state-connecting", "peer-connection-state-connected",
        "peer-connection-state-disconnected", "peer-connection-state-failed", "peer-connection-state-closed",
        "signaling-state-stable", "signaling-state-have-local-offer", "signaling-state-have-remote-offer",
        "signaling-state-have-local-pranswer", "signaling-state-have-remote-pranswer", "signaling-state-closed",
    )
    private val allowedSdpObserverStages = buildSet {
        addAll(setOf(
            "description-create-start", "description-create-success", "description-create-failure",
            "local-set-start", "local-set-success", "local-set-failure",
            "remote-set-start", "remote-set-success", "remote-set-failure",
        ))
        for (state in setOf("stable", "have_local_offer", "have_remote_offer", "have_local_pranswer", "have_remote_pranswer", "closed")) {
            add("peer-signaling-$state")
        }
        for (state in setOf("new", "checking", "connected", "completed", "disconnected", "failed", "closed")) {
            add("peer-ice-connection-$state")
        }
        for (state in setOf("new", "gathering", "complete")) add("peer-ice-gathering-$state")
        for (state in setOf("new", "connecting", "connected", "disconnected", "failed", "closed")) {
            add("peer-connection-$state")
        }
    }
    private val allowedPeerSignalingStates = setOf("stable", "have_local_offer", "have_remote_offer", "have_local_pranswer", "have_remote_pranswer", "closed")
    private val allowedPeerIceStates = setOf("new", "checking", "connected", "completed", "disconnected", "failed", "closed")
    private val allowedPeerGatheringStates = setOf("new", "gathering", "complete")
    private val allowedCallDigestKinds = setOf("control", "offer", "answer", "ice-candidate")
    private val allowedCallDigestEscapingCategories = setOf("CRLF-vs-LF", "line-ending-variant", "unicode-escape", "slash-escape-case", "escape-mismatch-candidate", "plain-ascii")

    fun update(
        conversationId: String?,
        trustState: String,
        connectionState: String,
        deliveryState: String,
        lastActivityTimestamp: Long,
    ) {
        if (!BuildConfig.DEBUG) return
        this.conversationHash = conversationId?.let(SavedConversationIndex::hash)
        this.trustState = trustState
        this.connectionState = connectionState
        this.deliveryState = this.deliveryStage?.let { "test:$it" } ?: deliveryState
        this.lastActivityTimestamp = lastActivityTimestamp
    }

    /** Internal debug-build delivery stage; never includes message or authorization data. */
    fun setDeliveryStage(stage: String) {
        if (BuildConfig.DEBUG) {
            deliveryStage = stage
            deliveryStages.add(stage)
            while (deliveryStages.size > 64) deliveryStages.removeAt(0)
        }
    }

    fun stageHistory(): List<String> = if (BuildConfig.DEBUG) deliveryStages.toList() else emptyList()

    /** Debug-only call authorization trace. Arbitrary strings are rejected to keep it metadata-only. */
    fun setCallSignalStage(stage: String) {
        if (!BuildConfig.DEBUG) return
        require(stage in allowedCallSignalStages)
        callSignalStages.add(stage)
        while (callSignalStages.size > 96) callSignalStages.removeAt(0)
    }

    /** ICE-only metadata. Values must be fixed categories and must never contain candidate text. */
    fun setIceDiagnostic(stage: String) {
        if (!BuildConfig.DEBUG) return
        require(stage in allowedIceDiagnostics)
        callSignalStages.add(stage)
        while (callSignalStages.size > 96) callSignalStages.removeAt(0)
    }

    fun callSignalStageHistory(): List<String> = if (BuildConfig.DEBUG) callSignalStages.toList() else emptyList()

    fun clearCallSignalStages() {
        if (BuildConfig.DEBUG) {
            callSignalStages.clear()
            callTimingStages.clear()
            sdpObserverStages.clear()
            callHealthSnapshots.clear()
            callTimingStartedAt = 0L
            remoteDescriptionDiagnostic = null
        }
    }

    /** Elapsed ICE timing contains only fixed stage labels and monotonic milliseconds. */
    fun beginCallTimingTrace() {
        if (!BuildConfig.DEBUG) return
        callTimingStages.clear()
        sdpObserverStages.clear()
        callHealthSnapshots.clear()
        remoteDescriptionDiagnostic = null
        callTimingStartedAt = SystemClock.elapsedRealtime()
    }

    /** Debug-only ordered observer callbacks; labels are a fixed allowlist and contain no SDP. */
    fun setSdpObserverStage(stage: String) {
        if (!BuildConfig.DEBUG) return
        if (stage !in allowedSdpObserverStages) return
        sdpObserverStages.add(stage)
        while (sdpObserverStages.size > 160) sdpObserverStages.removeAt(0)
        Log.d("K3CallSDP", "observer=$stage")
    }

    fun sdpObserverStageHistory(): List<String> = if (BuildConfig.DEBUG) sdpObserverStages.toList() else emptyList()

    /** Captures only PeerConnection state, transceiver count, and a sanitized caller thread name. */
    fun recordRemoteDescriptionDiagnostic(value: AndroidRemoteDescriptionDiagnostic) {
        if (!BuildConfig.DEBUG) return
        if (value.signalingState !in allowedPeerSignalingStates ||
            value.iceConnectionState !in allowedPeerIceStates ||
            value.iceGatheringState !in allowedPeerGatheringStates ||
            value.transceiverCount !in 0..64 ||
            !value.callingThread.matches(Regex("[A-Za-z0-9_.-]{1,48}"))) return
        val diagnostic = "signaling=${value.signalingState};ice=${value.iceConnectionState};gathering=${value.iceGatheringState};transceivers=${value.transceiverCount};thread=${value.callingThread}"
        remoteDescriptionDiagnostic = diagnostic
        Log.d("K3CallSDP", "before-remote-description $diagnostic")
    }

    fun remoteDescriptionDiagnostic(): String? = if (BuildConfig.DEBUG) remoteDescriptionDiagnostic else null

    fun setCallTimingDiagnostic(stage: String) {
        if (!BuildConfig.DEBUG) return
        if (stage !in allowedCallTimingStages) return
        val now = SystemClock.elapsedRealtime()
        if (callTimingStartedAt == 0L) callTimingStartedAt = now
        callTimingStages.add("$stage@${(now - callTimingStartedAt).coerceAtLeast(0)}ms")
        while (callTimingStages.size > 160) callTimingStages.removeAt(0)
    }

    fun callTimingStageHistory(): List<String> = if (BuildConfig.DEBUG) callTimingStages.toList() else emptyList()

    /** Stores bounded aggregate WebRTC counters; addresses, identities, and media contents are never accepted. */
    fun recordCallHealthSnapshot(value: AndroidCallHealthSnapshot) {
        if (!BuildConfig.DEBUG) return
        val states = setOf("new", "checking", "connected", "completed", "disconnected", "failed", "closed")
        val signaling = setOf("stable", "have_local_offer", "have_remote_offer", "have_local_pranswer", "have_remote_pranswer", "closed")
        if (value.peerState !in states || value.iceState !in states || value.signalingState !in signaling || value.selectedPair !in setOf("active", "inactive", "unknown")) return
        val counters = listOfNotNull(value.consentRequestsSent, value.consentResponsesReceived) + listOf(value.audioInboundPackets, value.audioInboundBytes, value.audioOutboundPackets, value.audioOutboundBytes)
        if (counters.any { it < 0L }) return
        val elapsed = (SystemClock.elapsedRealtime() - callTimingStartedAt).coerceAtLeast(0L)
        callHealthSnapshots.add("${elapsed}ms;pc=${value.peerState};ice=${value.iceState};signal=${value.signalingState};pair=${value.selectedPair};consentSent=${value.consentRequestsSent ?: "na"};consentReplies=${value.consentResponsesReceived ?: "na"};audioInPackets=${value.audioInboundPackets};audioInBytes=${value.audioInboundBytes};audioOutPackets=${value.audioOutboundPackets};audioOutBytes=${value.audioOutboundBytes}")
        while (callHealthSnapshots.size > 48) callHealthSnapshots.removeAt(0)
    }

    fun callHealthSnapshotHistory(): List<String> = if (BuildConfig.DEBUG) callHealthSnapshots.toList() else emptyList()

    /** Stores only a fixed diagnostic label; never stores the raw server response. */
    fun setCallSignalResultCategory(category: String) {
        if (!BuildConfig.DEBUG) return
        require(category in allowedCallSignalResultCategories)
        callSignalResultCategory = category
    }

    fun callSignalResultCategory(): String? = if (BuildConfig.DEBUG) callSignalResultCategory else null

    fun setCallDigestInputDiagnostic(kind: String, inputLength: Int, payloadJsonLength: Int, sdpValueLength: Int, metadataLength: Int, escapingCategory: String) {
        if (!BuildConfig.DEBUG) return
        require(kind in allowedCallDigestKinds && inputLength >= 0 && payloadJsonLength >= 0 && sdpValueLength >= 0 && metadataLength >= 0 && escapingCategory in allowedCallDigestEscapingCategories)
        callDigestInputDiagnostics[kind] = DigestInputMetadata(inputLength, payloadJsonLength, sdpValueLength, metadataLength, escapingCategory)
    }

    fun callDigestInputDiagnostic(kind: String): DigestInputMetadata? = if (BuildConfig.DEBUG) callDigestInputDiagnostics[kind] else null

    /** Safe debug-only category for an inbound encrypted delivery result. */
    fun setInboundMessageResultCategory(category: String) {
        if (!BuildConfig.DEBUG) return
        require(category in allowedInboundMessageResultCategories)
        inboundMessageResultCategory = category
    }

    fun inboundMessageResultCategory(): String? = if (BuildConfig.DEBUG) inboundMessageResultCategory else null

    /** Safe connection phase label for isolated interoperability diagnostics. */
    fun setConnectionStage(stage: String) {
        if (BuildConfig.DEBUG) {
            connectionPhase = stage
            connectionState = "test:$stage"
        }
    }

    fun snapshot(): DebugInspectionSnapshot? = if (BuildConfig.DEBUG) {
        DebugInspectionSnapshot(conversationHash, trustState, connectionState, deliveryState, lastActivityTimestamp, connectionPhase)
    } else {
        null
    }
}

internal data class DebugInspectionSnapshot(
    val conversationHash: String?,
    val trustState: String,
    val connectionState: String,
    val deliveryState: String,
    val lastActivityTimestamp: Long,
    val connectionPhase: String,
)

internal data class DigestInputMetadata(
    val inputLength: Int,
    val payloadJsonLength: Int,
    val sdpValueLength: Int,
    val metadataLength: Int,
    val escapingCategory: String,
)
