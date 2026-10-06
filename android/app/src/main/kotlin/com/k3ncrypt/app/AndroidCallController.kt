package com.k3ncrypt.app

import android.content.Context
import com.k3ncrypt.calls.AndroidCallObserver
import com.k3ncrypt.calls.AndroidCallHealthSnapshot
import com.k3ncrypt.calls.AndroidRemoteDescriptionDiagnostic
import com.k3ncrypt.calls.AndroidWebRtcEngine
import com.k3ncrypt.calls.CallSignalCodec
import com.k3ncrypt.calls.CallSignalValue
import com.k3ncrypt.calls.CallReplayGuard
import com.k3ncrypt.calls.IceServerConfig
import com.k3ncrypt.calls.IceValue
import com.k3ncrypt.calls.SdpValue
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class AndroidCallUiState(
    val callId: String? = null,
    val mediaMode: String = "audio",
    val status: String = "idle",
    val incoming: Boolean = false,
    val microphoneEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val localVideo: org.webrtc.VideoTrack? = null,
    val remoteVideo: org.webrtc.VideoTrack? = null,
    val mediaError: String? = null,
    val errorCategory: String? = null,
    val receivedProtocolVersion: Int? = null,
)

/** Expire an abandoned call setup before considering a newer authenticated invite. */
internal fun shouldExpireCallSetupBeforeInvite(
    activeCallId: String?,
    status: String,
    expiresAt: Long,
    now: Long,
): Boolean = activeCallId != null && expiresAt <= now && status !in setOf("connected", "reconnecting")

/** Stable tie-break for simultaneous unanswered outgoing attempts; no clock ordering is involved. */
internal fun shouldKeepOutgoingCallOnCollision(activeCallId: String, incomingCallId: String, status: String, incoming: Boolean): Boolean =
    status == "ringing" && !incoming && activeCallId <= incomingCallId

internal fun isCallReconnectOfferOwner(localRoutingId: String, peerRoutingId: String): Boolean = localRoutingId < peerRoutingId

internal fun shouldEndCallWhenActivityStops(isChangingConfigurations: Boolean): Boolean = !isChangingConfigurations

internal fun shouldStartCallMediaAfterAcceptance(incoming: Boolean, status: String, locallyAccepted: Boolean, remotelyAccepted: Boolean, appForeground: Boolean): Boolean =
    appForeground && if (incoming) status == "incoming" && locallyAccepted else status == "ringing" && remotelyAccepted

/** Replay state may change only after protocol, origin, call-state, and sequence admission pass. */
internal fun shouldClaimCallReplay(
    protocol: CallSignalCodec.ProtocolClassification,
    senderIdentityBound: Boolean,
    callStateAllowsSignal: Boolean,
    sequenceExpected: Boolean,
): Boolean = protocol == CallSignalCodec.ProtocolClassification.CURRENT && senderIdentityBound && callStateAllowsSignal && sequenceExpected

/** Owns only call/media state. Identity, Vodozemac signaling, and device proof stay in existing repositories. */
@Singleton
class AndroidCallController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val messaging: AndroidMessagingRepository,
    private val identities: AndroidIdentityLifecycleRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(AndroidCallUiState())
    val state: StateFlow<AndroidCallUiState> = mutableState
    private var peer: AndroidWebRtcEngine? = null
    private var binding: ConversationInvitation? = null
    private var callId: String? = null
    private var mediaMode = "audio"
    private var configuredIceServers: List<IceServerConfig> = emptyList()
    private var identityBinding = ""
    private var expiresAt = 0L
    private val controllerStartedAt = System.currentTimeMillis()
    private var callGeneration = 0L
    private var appForeground = false
    private var nextSequence = 1L
    private val receivedSequences = linkedMapOf<String, Long>()
    private var remoteDescriptionReady = false
    private var signalingReady = false
    private var isInitiator = false
    private var restartAttempted = false
    private var firstRemoteCandidateTimingRecorded = false
    private val queuedIce = mutableListOf<IceValue>()
    private val queuedLocalIce = mutableListOf<IceValue>()
    private val replayGuard = CallReplayGuard()
    private val signalMutex = Mutex()
    private val actionMutex = Mutex()
    private var postConnectHealthJob: Job? = null
    private var setupTimeoutJob: Job? = null
    private var reconnectTimeoutJob: Job? = null
    private var relayLossJob: Job? = null

    fun eglContext() = peer?.eglContext() ?: error("Call video is not active")

    init {
        if (BuildConfig.DEBUG) CallSignalCodec.installDebugDigestDiagnosticSink { diagnostic ->
            DebugInspectionStore.setCallDigestInputDiagnostic(diagnostic.kind, diagnostic.byteLength, diagnostic.payloadJsonLength, diagnostic.sdpValueLength, diagnostic.metadataLength, diagnostic.escapingCategory)
        }
        messaging.observeCallSignals { raw ->
            val receivedGeneration = callGeneration
            scope.launch { runCatching { actionMutex.withLock { handle(raw) } }.onFailure { if (callId != null && callGeneration == receivedGeneration) finish("failed") } }
        }
        messaging.observeCallTransportConnectivity { connected -> scope.launch {
            if (connected) { relayLossJob?.cancel(); relayLossJob = null }
            else if (callId != null && relayLossJob?.isActive != true) {
                val disconnectedCallId = callId
                relayLossJob = scope.launch {
                    delay(30_000)
                    if (callId == disconnectedCallId) finish("failed")
                }
            }
        } }
        scope.launch {
            messaging.verificationRevision.collect {
                val current = binding
                if (current != null && messaging.verificationState(current) != ContactVerificationState.VERIFIED) finish("verification-required")
            }
        }
    }

    suspend fun startVoice(iceServers: List<IceServerConfig> = emptyList()) = start("audio", iceServers)
    suspend fun startVideo(iceServers: List<IceServerConfig> = emptyList()) = start("video", iceServers)

    suspend fun accept(iceServers: List<IceServerConfig> = emptyList()) = actionMutex.withLock { acceptLocked(iceServers) }

    private suspend fun acceptLocked(iceServers: List<IceServerConfig>) {
        val current = mutableState.value
        val acceptedCallId = callId ?: error("No incoming call is waiting")
        val acceptedGeneration = callGeneration
        check(current.incoming) { "No incoming call is waiting" }
        check(shouldStartCallMediaAfterAcceptance(incoming = true, status = current.status, locallyAccepted = true, remotelyAccepted = false, appForeground = appForeground))
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("accept-action")
        messaging.requireVerifiedCallConversation().also { check(it == binding) { "Call contact changed" } }
        configuredIceServers = iceServers
        mutableState.value = current.copy(incoming = false, status = "connecting")
        try {
            startPeer(iceServers)
            if (callId != acceptedCallId || callGeneration != acceptedGeneration) return
            send("accept", "control")
            if (callId != acceptedCallId || callGeneration != acceptedGeneration) return
            signalingReady = true
            flushLocalIce()
        } catch (error: Throwable) {
            if (callId == acceptedCallId && callGeneration == acceptedGeneration) finish("failed")
            throw error
        }
        // The incoming caller owns offer creation. Creating an offer here causes
        // offer glare: both peers enter HAVE_LOCAL_OFFER before either applies
        // the other's offer. The caller creates its offer after receiving accept.
    }

    suspend fun reject() = actionMutex.withLock {
        val rejectedCallId = callId ?: error("No incoming call is waiting")
        val rejectedGeneration = callGeneration
        check(mutableState.value.incoming)
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("decline-action")
        runCatching { send("reject", "control") }
        if (callId == rejectedCallId && callGeneration == rejectedGeneration) finish("rejected")
    }

    suspend fun hangup() = actionMutex.withLock {
        val endingCallId = callId ?: return@withLock
        val endingGeneration = callGeneration
        val event = if (mutableState.value.status == "ringing") "cancel" else "end"
        runCatching { send(event, "control") }
        if (callId == endingCallId && callGeneration == endingGeneration) finish(if (event == "cancel") "cancelled" else "ended")
    }

    fun setMicrophoneEnabled(enabled: Boolean) { peer?.setMicrophoneEnabled(enabled); mutableState.value = mutableState.value.copy(microphoneEnabled = enabled) }
    fun setCameraEnabled(enabled: Boolean): Boolean {
        val engine = peer ?: return false
        val applied = engine.setCameraEnabled(enabled)
        mutableState.value = mutableState.value.copy(
            cameraEnabled = applied && enabled,
            localVideo = if (applied && enabled) engine.localVideoTrack() else null,
            mediaError = if (applied) null else "Camera is unavailable. The call can continue with video off.",
        )
        return applied
    }
    fun switchCamera() {
        val engine = peer ?: return
        val ownerCallId = callId
        val ownerGeneration = callGeneration
        engine.switchCamera { switched ->
            if (callId != ownerCallId || callGeneration != ownerGeneration) return@switchCamera
            if (!switched) mutableState.value = mutableState.value.copy(mediaError = "The other camera is unavailable.")
            else mutableState.value = mutableState.value.copy(mediaError = null)
        }
    }
    fun clearProtocolError() {
        mutableState.value = if (callId == null) AndroidCallUiState() else mutableState.value.copy(errorCategory = null, receivedProtocolVersion = null)
    }

    fun dismissCallNotice() {
        val state = mutableState.value
        if (callId == null && state.status in setOf("verification-required", "ended", "rejected", "cancelled", "timeout", "expired", "failed")) {
            mutableState.value = AndroidCallUiState()
        }
    }

    private fun showProtocolIncompatibility(signalCallId: String, receivedVersion: Int) {
        mutableState.value = if (callId == null) {
            AndroidCallUiState(callId = signalCallId, status = "protocol-incompatible", errorCategory = "protocol-incompatible", receivedProtocolVersion = receivedVersion)
        } else {
            mutableState.value.copy(errorCategory = "protocol-incompatible", receivedProtocolVersion = receivedVersion)
        }
    }

    fun recordApplicationLifecycle(backgrounded: Boolean) {
        appForeground = !backgrounded
        if (BuildConfig.DEBUG && callId != null) {
            DebugInspectionStore.setCallSignalStage(if (backgrounded) "app-lifecycle-background" else "app-lifecycle-foreground")
        }
    }

    /** No foreground call service exists; stop local media when the app leaves the foreground. */
    fun endForBackground() {
        val activeCallId = callId ?: return
        if (peer == null && mutableState.value.status in setOf("incoming", "ringing")) return
        val activeGeneration = callGeneration
        peer?.close()
        peer = null
        scope.launch {
            actionMutex.withLock {
                if (callId != activeCallId || callGeneration != activeGeneration) return@withLock
                val terminalEvent = when {
                    mutableState.value.incoming -> "reject"
                    mutableState.value.status == "ringing" && isInitiator -> "cancel"
                    else -> "end"
                }
                runCatching { send(terminalEvent, "control") }
                if (callId == activeCallId && callGeneration == activeGeneration) finish("ended")
            }
        }
    }

    private suspend fun start(mode: String, iceServers: List<IceServerConfig>) = actionMutex.withLock { startLocked(mode, iceServers) }

    private suspend fun startLocked(mode: String, iceServers: List<IceServerConfig>) {
        check(mutableState.value.callId == null) { "A call is already active" }
        if (BuildConfig.DEBUG) DebugInspectionStore.clearCallSignalStages()
        configuredIceServers = iceServers
        val trusted = messaging.requireVerifiedCallConversation()
        val local = identities.activeState()
        require(local.lifecycleState == "active" && local.accountIdentityReference != null && trusted.peerIdentityReference.startsWith("K3 ")) { "Verified device and contact are required for calls" }
        binding = trusted
        mediaMode = mode
        isInitiator = true
        restartAttempted = false
        callId = UUID.randomUUID().toString()
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("call-created")
        callGeneration += 1
        identityBinding = CallSignalCodec.binding(trusted.conversationId, trusted.localRoutingId, local.deviceIdentityReference, trusted.peerRoutingId, trusted.peerIdentityReference)
        nextSequence = 1
        rememberReceivedSequence(requireNotNull(callId), 0)
        expiresAt = System.currentTimeMillis() + CallSignalCodec.SIGNAL_LIFETIME_MS
        mutableState.value = AndroidCallUiState(callId = callId, mediaMode = mode, status = "ringing", incoming = false, cameraEnabled = mode == "video")
        val startedCallId = requireNotNull(callId)
        val startedGeneration = callGeneration
        scheduleSetupTimeout(startedCallId)
        try { send("invite", "control") } catch (error: Throwable) { if (callId == startedCallId && callGeneration == startedGeneration) finish("failed"); throw error }
        signalingReady = true
        flushLocalIce()
    }

    private suspend fun startPeer(iceServers: List<IceServerConfig>) {
        if (peer != null) return
        val ownerCallId = callId
        val ownerGeneration = callGeneration
        if (BuildConfig.DEBUG) DebugInspectionStore.beginCallTimingTrace()
        val engine = AndroidWebRtcEngine(context)
        engine.setDebugIceDiagnosticSink { stage -> if (BuildConfig.DEBUG) DebugInspectionStore.setIceDiagnostic(stage) }
        engine.setDebugTimingDiagnosticSink { stage -> if (BuildConfig.DEBUG) DebugInspectionStore.setCallTimingDiagnostic(stage) }
        engine.setDebugHealthDiagnosticSink { snapshot: AndroidCallHealthSnapshot -> if (BuildConfig.DEBUG) DebugInspectionStore.recordCallHealthSnapshot(snapshot) }
        engine.setDebugRemoteDescriptionDiagnosticSink { diagnostic: AndroidRemoteDescriptionDiagnostic ->
            if (BuildConfig.DEBUG) DebugInspectionStore.recordRemoteDescriptionDiagnostic(diagnostic)
        }
        engine.setDebugSdpObserverDiagnosticSink { stage ->
            if (BuildConfig.DEBUG) DebugInspectionStore.setSdpObserverStage(stage)
        }
        try { engine.start(iceServers, mediaMode == "video", object : AndroidCallObserver {
            private fun isCurrentCall() = callId == ownerCallId && callGeneration == ownerGeneration
            override fun onLocalIce(candidate: IceValue) {
                if (!isCurrentCall()) return
                if (BuildConfig.DEBUG) DebugInspectionStore.setIceDiagnostic("ice-local-candidate-${candidateType(candidate.candidate)}")
                scope.launch {
                    if (signalingReady) sendIce(candidate) else queuedLocalIce.add(candidate)
                }
            }
            override fun onState(state: String) {
                if (!isCurrentCall()) return
                when (state) {
                    "connected", "completed" -> {
                        setupTimeoutJob?.cancel(); setupTimeoutJob = null
                        reconnectTimeoutJob?.cancel(); reconnectTimeoutJob = null
                        if (BuildConfig.DEBUG) {
                            DebugInspectionStore.setCallSignalStage("ice-connected")
                            DebugInspectionStore.setCallSignalStage("media-connected")
                        }
                        mutableState.value = mutableState.value.copy(status = "connected")
                        startPostConnectHealthPolling(engine)
                    }
                    "disconnected" -> {
                        if (BuildConfig.DEBUG) engine.collectPostConnectHealthSnapshot()
                        val wasConnected = mutableState.value.status == "connected" || mutableState.value.status == "reconnecting"
                        if (wasConnected) {
                            mutableState.value = mutableState.value.copy(status = "reconnecting")
                            reconnectTimeoutJob?.cancel()
                            val disconnectedCallId = ownerCallId
                            reconnectTimeoutJob = scope.launch {
                                delay(30_000)
                                if (callId == disconnectedCallId && mutableState.value.status == "reconnecting") finish("failed")
                            }
                            val currentBinding = binding
                            if (currentBinding != null && isCallReconnectOfferOwner(currentBinding.localRoutingId, currentBinding.peerRoutingId) && !restartAttempted) {
                                restartAttempted = true
                                val activeCallId = callId
                                scope.launch {
                                    delay(1_000)
                                    if (callId == activeCallId && mutableState.value.status == "reconnecting") runCatching { createAndSendOffer(restart = true) }.onFailure { finish("failed") }
                                }
                            }
                        }
                    }
                    "failed" -> scope.launch { finish("failed") }
                }
            }
            override fun onRemoteVideo(track: org.webrtc.VideoTrack) { if (isCurrentCall()) mutableState.value = mutableState.value.copy(remoteVideo = track) }
            override fun onRemoteVideoRemoved(track: org.webrtc.VideoTrack) {
                if (isCurrentCall() && mutableState.value.remoteVideo === track) mutableState.value = mutableState.value.copy(remoteVideo = null)
            }
            override fun onMediaFailure(reason: String) {
                if (!isCurrentCall()) return
                if (reason == "microphone-unavailable") {
                    scope.launch {
                        if (!isCurrentCall()) return@launch
                        runCatching { send("fail", "control") }
                        if (isCurrentCall()) finish("failed", "Microphone became unavailable. The call ended.")
                    }
                } else {
                    mutableState.value = mutableState.value.copy(cameraEnabled = false, localVideo = null, mediaError = "Camera became unavailable. The call continues with video off.")
                }
            }
        }) } catch (error: Throwable) {
            engine.close()
            throw error
        }
        peer = engine
        engine.setMicrophoneEnabled(mutableState.value.microphoneEnabled)
        if (mediaMode == "video" && !mutableState.value.cameraEnabled) engine.setCameraEnabled(false)
        mutableState.value = mutableState.value.copy(
            localVideo = if (mutableState.value.cameraEnabled) engine.localVideoTrack() else null,
            mediaError = null,
        )
    }

    private suspend fun handle(raw: String) {
        val trusted = runCatching { messaging.requireVerifiedCallConversation() }.getOrNull() ?: run {
            if (callId != null) finish("verification-required")
            return
        }
        val local = runCatching { identities.activeState() }.getOrNull() ?: return
        val signal = runCatching { CallSignalCodec.decode(raw) }.getOrNull() ?: return
        val now = System.currentTimeMillis()
        val senderIdentityBound = signal.senderParticipantId == trusted.peerRoutingId && signal.senderIdentityId == trusted.peerIdentityReference &&
            signal.identityBinding == CallSignalCodec.binding(trusted.conversationId, trusted.localRoutingId, local.deviceIdentityReference, trusted.peerRoutingId, trusted.peerIdentityReference)
        if (!senderIdentityBound) return
        val protocolClassification = CallSignalCodec.classifyProtocol(signal, trusted.conversationId, local.deviceIdentityReference, now)
        when (protocolClassification) {
            CallSignalCodec.ProtocolClassification.INVALID -> return
            CallSignalCodec.ProtocolClassification.LEGACY -> { showProtocolIncompatibility(signal.callId, 1); return }
            CallSignalCodec.ProtocolClassification.UNSUPPORTED -> { showProtocolIncompatibility(signal.callId, signal.protocolVersion ?: 1); return }
            CallSignalCodec.ProtocolClassification.CURRENT -> Unit
        }
        val activeId = callId
        val ownerGeneration = callGeneration
        if (activeId == signal.callId && shouldExpireCallSetupBeforeInvite(activeId, mutableState.value.status, expiresAt, now)) {
            finish("timeout")
            return
        }
        // INVITE is sequence 1 per attempt. Ignore a duplicate for the selected
        // attempt before touching its sequence window.
        if (signal.event == "invite" && activeId == signal.callId) return
        if (signal.event == "invite") {
            if (signal.timestamp < controllerStartedAt) return
        } else {
            if (signal.callId != callId || signal.mediaMode != mediaMode || ownerGeneration != callGeneration) return
            val state = mutableState.value.status
            val allowed = when (signal.event) {
                "accept" -> isInitiator && state == "ringing"
                "reject", "cancel", "end", "expire", "fail" -> state !in setOf("idle")
                "connect", "reconnect" -> state in setOf("connecting", "connected", "reconnecting") && signal.kind == "offer"
                "connected" -> state in setOf("connecting", "connected", "reconnecting") && signal.kind in setOf("answer", "ice-candidate")
                else -> false
            }
            if (!allowed) return
        }
        val previousSequence = receivedSequences[signal.callId] ?: 0L
        val sequenceExpected = signal.sequence == previousSequence + 1
        if (!shouldClaimCallReplay(protocolClassification, senderIdentityBound, callStateAllowsSignal = true, sequenceExpected = sequenceExpected) || !replayGuard.accept(signal.callId, signal.nonce, signal.expiresAt, now)) return
        rememberReceivedSequence(signal.callId, signal.sequence)
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("signal-received")
        if (BuildConfig.DEBUG && signal.event == "accept") DebugInspectionStore.setCallSignalStage("accept-signal-received")
        if (BuildConfig.DEBUG && activeId == null && signal.event == "invite" && signal.kind == "control") {
            DebugInspectionStore.setCallSignalStage("incoming-signal-received")
        }
        if (signal.event == "invite" && signal.kind == "control") {
            val competingId = activeId
            if (competingId != null) {
                if (shouldKeepOutgoingCallOnCollision(competingId, signal.callId, mutableState.value.status, mutableState.value.incoming)) {
                    runCatching { sendSignalContext(signal.callId, signal.mediaMode, signal.identityBinding, invitationExpiresAt = signal.expiresAt, event = "reject", kind = "control", sequence = 1, expectedActiveCallId = activeId, expectedGeneration = ownerGeneration) }
                    return
                }
                if (mutableState.value.status != "ringing" || mutableState.value.incoming) {
                    runCatching { sendSignalContext(signal.callId, signal.mediaMode, signal.identityBinding, invitationExpiresAt = signal.expiresAt, event = "reject", kind = "control", sequence = 1, expectedActiveCallId = activeId, expectedGeneration = ownerGeneration) }
                    return
                }
                // The incoming ID wins the stable tie-break. Cancel and release
                // the local unanswered attempt before adopting the winner.
                runCatching { send("cancel", "control") }
                finish("cancelled")
            }
            binding = trusted
            callGeneration += 1
            callId = signal.callId
            mediaMode = signal.mediaMode
            isInitiator = false
            restartAttempted = false
            identityBinding = signal.identityBinding
            expiresAt = signal.expiresAt
            // Signal sequence is per sender in the existing Web protocol.
            nextSequence = 1
            mutableState.value = AndroidCallUiState(signal.callId, signal.mediaMode, "incoming", incoming = true, cameraEnabled = signal.mediaMode == "video")
            if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("call-state-created")
            scheduleSetupTimeout(signal.callId)
            return
        }
        when (signal.event) {
            "accept" -> {
                if (isInitiator && !shouldStartCallMediaAfterAcceptance(incoming = false, status = mutableState.value.status, locallyAccepted = false, remotelyAccepted = true, appForeground = appForeground)) {
                    runCatching { send("end", "control") }
                    finish("ended")
                    return
                }
                mutableState.value = mutableState.value.copy(status = "connecting")
                // Only the originating device creates the initial offer. A callee
                // waits for that offer and answers it in the connect/offer branch.
                if (isInitiator) {
                    startPeer(configuredIceServers)
                    if (callId != signal.callId || ownerGeneration != callGeneration) return
                    signalingReady = true
                    createAndSendOffer()
                    flushLocalIce()
                }
            }
            "reject", "cancel", "end", "expire", "fail" -> finish(if (signal.event == "fail") "failed" else signal.event)
            "connect", "reconnect" -> if (signal.kind == "offer") {
                if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("offer-received")
                val description = signal.payload?.let { SdpValue(it.getString("type"), it.getString("sdp")) } ?: return
                val answer = peer?.acceptOffer(description) ?: return
                if (callId != signal.callId || ownerGeneration != callGeneration) return
                if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("answer-created")
                remoteDescriptionReady = true
                flushIce()
                send("connected", "answer", JSONObject().put("type", answer.type).put("sdp", answer.sdp))
            }
            "connected" -> when (signal.kind) {
                "answer" -> {
                    if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("answer-received")
                    val description = signal.payload?.let { SdpValue(it.getString("type"), it.getString("sdp")) } ?: return
                    peer?.acceptAnswer(description) ?: return
                    if (callId != signal.callId || ownerGeneration != callGeneration) return
                    remoteDescriptionReady = true
                    flushIce()
                    // Applying an SDP answer is not connectivity evidence; ICE
                    // connected/completed owns the CONNECTED barrier.
                }
                "ice-candidate" -> {
                    val payload = signal.payload ?: return
                    val value = IceValue(payload.getString("candidate"), payload.optString("sdpMid").takeIf { it != "null" }, payload.getInt("sdpMLineIndex"))
                    val candidateType = candidateType(value.candidate)
                    if (!firstRemoteCandidateTimingRecorded) {
                        firstRemoteCandidateTimingRecorded = true
                        if (BuildConfig.DEBUG) DebugInspectionStore.setCallTimingDiagnostic("first-remote-candidate-received")
                    }
                    if (BuildConfig.DEBUG) DebugInspectionStore.setIceDiagnostic("ice-remote-candidate-$candidateType-received")
                    if (remoteDescriptionReady) addRemoteIce(value, candidateType) else queuedIce.add(value)
                }
            }
        }
    }

    private suspend fun flushIce() { queuedIce.toList().forEach { addRemoteIce(it, candidateType(it.candidate)) }; queuedIce.clear() }

    private fun addRemoteIce(value: IceValue, candidateType: String) {
        val added = peer?.addIce(value) == true
        if (BuildConfig.DEBUG) {
            DebugInspectionStore.setIceDiagnostic("ice-remote-candidate-$candidateType-${if (added) "added" else "rejected"}")
            if (!added) DebugInspectionStore.setIceDiagnostic("ice-candidate-add-failed")
        }
        check(added) { "call_ice_candidate_rejected" }
    }

    private suspend fun flushLocalIce() {
        queuedLocalIce.toList().forEach { sendIce(it) }
        queuedLocalIce.clear()
    }

    private suspend fun sendIce(candidate: IceValue) {
        send("connected", "ice-candidate", JSONObject().put("candidate", candidate.candidate).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex))
    }

    private suspend fun createAndSendOffer(restart: Boolean = false) {
        val offer = peer?.createOffer(iceRestart = restart) ?: return
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("offer-created")
        send(if (restart) "reconnect" else "connect", "offer", JSONObject().put("type", offer.type).put("sdp", offer.sdp))
    }

    private suspend fun send(event: String, kind: String, payload: JSONObject? = null) {
        val call = callId ?: error("Call is unavailable")
        val activeCallId = call
        val generation = callGeneration
        signalMutex.withLock {
            val sequence = nextSequence
            sendSignalContextLocked(call, mediaMode, identityBinding, expiresAt, event, kind, sequence, payload, activeCallId, generation)
            if (callId != activeCallId || callGeneration != generation) error("Call attempt ended")
            nextSequence = sequence + 1
        }
    }

    private suspend fun sendSignalContext(
        call: String,
        mode: String,
        bindingValue: String,
        invitationExpiresAt: Long,
        event: String,
        kind: String,
        sequence: Long,
        payload: JSONObject? = null,
        expectedActiveCallId: String? = callId,
        expectedGeneration: Long = callGeneration,
    ) {
        signalMutex.withLock { sendSignalContextLocked(call, mode, bindingValue, invitationExpiresAt, event, kind, sequence, payload, expectedActiveCallId, expectedGeneration) }
    }

    private suspend fun sendSignalContextLocked(
        call: String,
        mode: String,
        bindingValue: String,
        invitationExpiresAt: Long,
        event: String,
        kind: String,
        sequence: Long,
        payload: JSONObject?,
        expectedActiveCallId: String?,
        expectedGeneration: Long,
    ) {
        check(callId == expectedActiveCallId && callGeneration == expectedGeneration) { "Call attempt ended" }
        val trusted = binding ?: error("Call conversation is unavailable")
        check(messaging.requireVerifiedCallConversation() == trusted) { "Call contact changed" }
        val local = identities.activeState()
        val timestamp = System.currentTimeMillis()
        val signalExpiry = if (event == "invite") minOf(invitationExpiresAt, timestamp + CallSignalCodec.SIGNAL_LIFETIME_MS) else timestamp + CallSignalCodec.SIGNAL_LIFETIME_MS
        val signal = CallSignalCodec.create(
            callId = call, conversationId = trusted.conversationId, senderParticipantId = trusted.localRoutingId,
            senderIdentityId = local.deviceIdentityReference, receiverIdentityId = trusted.peerIdentityReference,
            mediaMode = mode, event = event, kind = kind, payload = payload, sequence = sequence,
            timestamp = timestamp, expiresAt = signalExpiry, identityBinding = bindingValue,
        )
        messaging.sendCallSignal(CallSignalCodec.encode(signal))
        if (BuildConfig.DEBUG) {
            when {
                event == "connect" && kind == "offer" -> DebugInspectionStore.setCallSignalStage("offer-signal-sent")
                event == "connected" && kind == "answer" -> DebugInspectionStore.setCallSignalStage("answer-signal-sent")
                kind == "ice-candidate" -> DebugInspectionStore.setCallSignalStage("ice-signal-sent")
            }
        }
    }

    private fun scheduleSetupTimeout(startedCallId: String) {
        setupTimeoutJob?.cancel()
        val deadline = expiresAt
        setupTimeoutJob = scope.launch {
            delay((deadline - System.currentTimeMillis()).coerceAtLeast(0))
            if (callId == startedCallId && mutableState.value.status in setOf("incoming", "ringing", "connecting")) finish("timeout")
        }
    }

    private fun rememberReceivedSequence(signalCallId: String, sequence: Long) {
        receivedSequences[signalCallId] = sequence
        while (receivedSequences.size > 128) {
            val oldest = receivedSequences.keys.firstOrNull { it != callId } ?: break
            receivedSequences.remove(oldest)
        }
    }

    private fun finish(status: String, mediaError: String? = null) {
        if (BuildConfig.DEBUG) {
            val cleanupCategory = when (status) {
                "timeout" -> "call-cleanup-timeout"
                "failed" -> "call-cleanup-failure"
                "rejected" -> "call-cleanup-rejected"
                "cancelled", "cancel" -> "call-cleanup-cancelled"
                "expired", "expire" -> "call-cleanup-expired"
                else -> "call-cleanup-ended"
            }
            DebugInspectionStore.setCallSignalStage(cleanupCategory)
        }
        if (BuildConfig.DEBUG) DebugInspectionStore.setCallSignalStage("call-ended")
        postConnectHealthJob?.cancel()
        postConnectHealthJob = null
        setupTimeoutJob?.cancel(); setupTimeoutJob = null
        reconnectTimeoutJob?.cancel(); reconnectTimeoutJob = null
        relayLossJob?.cancel(); relayLossJob = null
        callId?.let {
            replayGuard.finish(it, System.currentTimeMillis() + 120_000, System.currentTimeMillis())
            receivedSequences.remove(it)
        }
        callGeneration += 1
        peer?.close(); peer = null
        mutableState.value = AndroidCallUiState(
            status = status,
            mediaMode = mediaMode,
            mediaError = mediaError,
            errorCategory = if (status == "verification-required") "verification-required" else null,
        )
        callId = null; binding = null; identityBinding = ""; expiresAt = 0
        remoteDescriptionReady = false; queuedIce.clear(); nextSequence = 1
        signalingReady = false; queuedLocalIce.clear()
        isInitiator = false; restartAttempted = false; firstRemoteCandidateTimingRecorded = false
    }

    private fun startPostConnectHealthPolling(engine: AndroidWebRtcEngine) {
        if (!BuildConfig.DEBUG || postConnectHealthJob?.isActive == true) return
        postConnectHealthJob = scope.launch {
            while (peer === engine && mutableState.value.status in setOf("connected", "reconnecting")) {
                engine.collectPostConnectHealthSnapshot()
                delay(10_000)
            }
        }
    }

    private fun candidateType(candidate: String): String = candidate.substringAfter(" typ ", "").substringBefore(' ').takeIf { it in setOf("host", "srflx", "relay", "prflx") } ?: "unknown"
}
