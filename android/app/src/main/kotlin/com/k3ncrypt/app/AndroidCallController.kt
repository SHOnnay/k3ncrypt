package com.k3ncrypt.app

import android.content.Context
import com.k3ncrypt.calls.AndroidCallObserver
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
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject

data class AndroidCallUiState(
    val callId: String? = null,
    val mediaMode: String = "audio",
    val status: String = "idle",
    val incoming: Boolean = false,
    val microphoneEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val localVideo: org.webrtc.VideoTrack? = null,
    val remoteVideo: org.webrtc.VideoTrack? = null,
    val errorCategory: String? = null,
)

/** Owns only call/media state. Identity, Vodozemac signaling, and device proof stay in existing repositories. */
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
    private var identityBinding = ""
    private var expiresAt = 0L
    private var nextSequence = 1L
    private var receivedSequence = 0L
    private var remoteDescriptionReady = false
    private var signalingReady = false
    private var isInitiator = false
    private var restartAttempted = false
    private val queuedIce = mutableListOf<IceValue>()
    private val queuedLocalIce = mutableListOf<IceValue>()
    private val replayGuard = CallReplayGuard()
    private val signalMutex = Mutex()

    fun eglContext() = peer?.eglContext() ?: error("Call video is not active")

    init { messaging.observeCallSignals { raw -> scope.launch { handle(raw) } } }

    suspend fun startVoice(iceServers: List<IceServerConfig> = emptyList()) = start("audio", iceServers)
    suspend fun startVideo(iceServers: List<IceServerConfig> = emptyList()) = start("video", iceServers)

    /** Sends one normal encrypted call invitation for debug authorization validation, without opening media or a peer connection. */
    suspend fun sendSignalingValidationInvite() {
        check(BuildConfig.DEBUG) { "Signaling validation is available only in debug builds." }
        check(mutableState.value.callId == null) { "A call is already active." }
        val trusted = messaging.activeConversation()
        val local = identities.activeState()
        require(local.lifecycleState == "active" && local.accountIdentityReference != null && trusted.peerIdentityReference.startsWith("K3 ")) {
            "Verified device and contact are required for calls."
        }
        val now = System.currentTimeMillis()
        val callId = UUID.randomUUID().toString()
        val signalBinding = CallSignalCodec.binding(trusted.conversationId, trusted.localRoutingId, local.deviceIdentityReference, trusted.peerRoutingId, trusted.peerIdentityReference)
        val signal = CallSignalCodec.create(
            callId = callId,
            conversationId = trusted.conversationId,
            senderParticipantId = trusted.localRoutingId,
            senderIdentityId = local.deviceIdentityReference,
            receiverIdentityId = trusted.peerIdentityReference,
            mediaMode = "audio",
            event = "invite",
            sequence = 1,
            timestamp = now,
            expiresAt = now + 60_000,
            identityBinding = signalBinding,
        )
        messaging.sendCallSignal(CallSignalCodec.encode(signal))
    }

    suspend fun accept(iceServers: List<IceServerConfig> = emptyList()) {
        val current = mutableState.value
        check(current.incoming && callId != null) { "No incoming call is waiting" }
        startPeer(iceServers)
        send("accept", "control")
        signalingReady = true
        flushLocalIce()
        mutableState.value = current.copy(incoming = false, status = "connecting")
        createAndSendOffer()
    }

    suspend fun reject() {
        check(mutableState.value.incoming && callId != null)
        send("reject", "control")
        finish("rejected")
    }

    suspend fun hangup() {
        val event = if (mutableState.value.status == "ringing") "cancel" else "end"
        if (callId != null) runCatching { send(event, "control") }
        finish("ended")
    }

    fun setMicrophoneEnabled(enabled: Boolean) { peer?.setMicrophoneEnabled(enabled); mutableState.value = mutableState.value.copy(microphoneEnabled = enabled) }
    fun setCameraEnabled(enabled: Boolean) { peer?.setCameraEnabled(enabled); mutableState.value = mutableState.value.copy(cameraEnabled = enabled) }
    fun switchCamera() { peer?.switchCamera() }

    private suspend fun start(mode: String, iceServers: List<IceServerConfig>) {
        check(mutableState.value.callId == null) { "A call is already active" }
        val trusted = messaging.activeConversation()
        val local = identities.activeState()
        require(local.lifecycleState == "active" && local.accountIdentityReference != null && trusted.peerIdentityReference.startsWith("K3 ")) { "Verified device and contact are required for calls" }
        binding = trusted
        mediaMode = mode
        isInitiator = true
        restartAttempted = false
        callId = UUID.randomUUID().toString()
        expiresAt = System.currentTimeMillis() + 60_000
        identityBinding = CallSignalCodec.binding(trusted.conversationId, trusted.localRoutingId, local.deviceIdentityReference, trusted.peerRoutingId, trusted.peerIdentityReference)
        nextSequence = 1
        receivedSequence = 1
        startPeer(iceServers)
        mutableState.value = AndroidCallUiState(callId = callId, mediaMode = mode, status = "ringing", incoming = false, cameraEnabled = mode == "video", localVideo = peer?.localVideoTrack())
        send("invite", "control")
        signalingReady = true
        flushLocalIce()
        scope.launch { delay(60_000); if (this@AndroidCallController.callId == callId && mutableState.value.status == "ringing") finish("timeout") }
    }

    private suspend fun startPeer(iceServers: List<IceServerConfig>) {
        if (peer != null) return
        val engine = AndroidWebRtcEngine(context)
        try { engine.start(iceServers, mediaMode == "video", object : AndroidCallObserver {
            override fun onLocalIce(candidate: IceValue) {
                scope.launch {
                    if (signalingReady) sendIce(candidate) else queuedLocalIce.add(candidate)
                }
            }
            override fun onState(state: String) {
                when (state) {
                    "connected", "completed" -> mutableState.value = mutableState.value.copy(status = "connected")
                    "disconnected" -> {
                        val wasConnected = mutableState.value.status == "connected" || mutableState.value.status == "reconnecting"
                        if (wasConnected) {
                            mutableState.value = mutableState.value.copy(status = "reconnecting")
                            if (isInitiator && !restartAttempted) {
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
            override fun onRemoteVideo(track: org.webrtc.VideoTrack) { mutableState.value = mutableState.value.copy(remoteVideo = track) }
        }) } catch (error: Throwable) {
            engine.close()
            throw error
        }
        peer = engine
        mutableState.value = mutableState.value.copy(localVideo = engine.localVideoTrack())
    }

    private suspend fun handle(raw: String) {
        val trusted = runCatching { messaging.activeConversation() }.getOrNull() ?: return
        val local = runCatching { identities.activeState() }.getOrNull() ?: return
        val signal = runCatching { CallSignalCodec.decode(raw) }.getOrNull() ?: return
        val now = System.currentTimeMillis()
        if (!CallSignalCodec.validate(signal, trusted.conversationId, local.deviceIdentityReference, now)) return
        if (signal.senderParticipantId != trusted.peerRoutingId || signal.senderIdentityId != trusted.peerIdentityReference) return
        if (signal.identityBinding != CallSignalCodec.binding(trusted.conversationId, trusted.localRoutingId, local.deviceIdentityReference, trusted.peerRoutingId, trusted.peerIdentityReference)) return
        if (signal.sequence != receivedSequence + 1 || !replayGuard.accept(signal.callId, signal.nonce, signal.expiresAt, now)) return
        receivedSequence = signal.sequence
        val activeId = callId
        if (activeId == null) {
            if (signal.event != "invite" || signal.kind != "control") return
            binding = trusted
            callId = signal.callId
            mediaMode = signal.mediaMode
            isInitiator = false
            restartAttempted = false
            identityBinding = signal.identityBinding
            expiresAt = signal.expiresAt
        nextSequence = 2
            mutableState.value = AndroidCallUiState(signal.callId, signal.mediaMode, "incoming", incoming = true, cameraEnabled = signal.mediaMode == "video")
            scope.launch { delay((signal.expiresAt - System.currentTimeMillis()).coerceAtLeast(0)); if (callId == signal.callId && mutableState.value.incoming) finish("timeout") }
            return
        }
        if (signal.callId != activeId || signal.mediaMode != mediaMode || signal.expiresAt > expiresAt) return
        when (signal.event) {
            "accept" -> {
                mutableState.value = mutableState.value.copy(status = "connecting")
                createAndSendOffer()
            }
            "reject", "cancel", "end", "expire", "fail" -> finish(if (signal.event == "fail") "failed" else signal.event)
            "connect", "reconnect" -> if (signal.kind == "offer") {
                val description = signal.payload?.let { SdpValue(it.getString("type"), it.getString("sdp")) } ?: return
                val answer = peer?.acceptOffer(description) ?: return
                remoteDescriptionReady = true
                flushIce()
                send("connected", "answer", JSONObject().put("type", answer.type).put("sdp", answer.sdp))
            }
            "connected" -> when (signal.kind) {
                "answer" -> {
                    val description = signal.payload?.let { SdpValue(it.getString("type"), it.getString("sdp")) } ?: return
                    peer?.acceptAnswer(description) ?: return
                    remoteDescriptionReady = true
                    flushIce()
                }
                "ice-candidate" -> {
                    val payload = signal.payload ?: return
                    val value = IceValue(payload.getString("candidate"), payload.optString("sdpMid").takeIf { it != "null" }, payload.getInt("sdpMLineIndex"))
                    if (remoteDescriptionReady) peer?.addIce(value) else queuedIce.add(value)
                }
            }
        }
    }

    private suspend fun flushIce() { queuedIce.toList().forEach { peer?.addIce(it) }; queuedIce.clear() }

    private suspend fun flushLocalIce() {
        queuedLocalIce.toList().forEach { sendIce(it) }
        queuedLocalIce.clear()
    }

    private suspend fun sendIce(candidate: IceValue) {
        send("connected", "ice-candidate", JSONObject().put("candidate", candidate.candidate).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex))
    }

    private suspend fun createAndSendOffer(restart: Boolean = false) {
        val offer = peer?.createOffer(iceRestart = restart) ?: return
        send(if (restart) "reconnect" else "connect", "offer", JSONObject().put("type", offer.type).put("sdp", offer.sdp))
    }

    private suspend fun send(event: String, kind: String, payload: JSONObject? = null) {
        signalMutex.withLock {
            val trusted = binding ?: error("Call conversation is unavailable")
            val local = identities.activeState()
            val call = callId ?: error("Call is unavailable")
            val sequence = nextSequence
            val signal = CallSignalCodec.create(
                callId = call, conversationId = trusted.conversationId, senderParticipantId = trusted.localRoutingId,
                senderIdentityId = local.deviceIdentityReference, receiverIdentityId = trusted.peerIdentityReference,
                mediaMode = mediaMode, event = event, kind = kind, payload = payload, sequence = sequence,
                timestamp = System.currentTimeMillis(), expiresAt = expiresAt, identityBinding = identityBinding,
            )
            messaging.sendCallSignal(CallSignalCodec.encode(signal))
            nextSequence = sequence + 1
        }
    }

    private fun finish(status: String) {
        callId?.let { replayGuard.finish(it, expiresAt, System.currentTimeMillis()) }
        peer?.close(); peer = null
        mutableState.value = AndroidCallUiState(status = status)
        callId = null; binding = null; identityBinding = ""; expiresAt = 0
        remoteDescriptionReady = false; queuedIce.clear(); receivedSequence = 0; nextSequence = 1
        signalingReady = false; queuedLocalIce.clear()
        isInitiator = false; restartAttempted = false
    }
}
