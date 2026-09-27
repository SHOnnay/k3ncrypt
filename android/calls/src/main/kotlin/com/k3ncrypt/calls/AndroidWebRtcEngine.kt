package com.k3ncrypt.calls

import android.content.Context
import android.util.Log
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.audio.JavaAudioDeviceModule
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RTCStatsCollectorCallback
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class IceServerConfig(val urls: List<String>, val username: String? = null, val credential: String? = null)
data class SdpValue(val type: String, val sdp: String)
data class IceValue(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int)
data class AndroidCallHealthSnapshot(
    val peerState: String,
    val iceState: String,
    val signalingState: String,
    val selectedPair: String,
    val consentRequestsSent: Long?,
    val consentResponsesReceived: Long?,
    val audioInboundPackets: Long,
    val audioInboundBytes: Long,
    val audioOutboundPackets: Long,
    val audioOutboundBytes: Long,
)
data class AndroidRemoteDescriptionDiagnostic(
    val signalingState: String,
    val iceConnectionState: String,
    val iceGatheringState: String,
    val transceiverCount: Int,
    val callingThread: String,
)

internal fun signalingTimingStage(state: PeerConnection.SignalingState): String =
    "signaling-state-${state.name.lowercase().replace('_', '-')}"

interface AndroidCallObserver {
    fun onLocalIce(candidate: IceValue)
    fun onState(state: String)
    fun onRemoteVideo(track: VideoTrack)
}

/** Native WebRTC adapter only. Identity, authorization, and encrypted signaling stay in existing K3NCRYPT boundaries. */
class AndroidWebRtcEngine(context: Context) {
    private val appContext = context.applicationContext
    private val egl = EglBase.create()
    private val audioModule = JavaAudioDeviceModule.builder(appContext).createAudioDeviceModule()
    private val factory: PeerConnectionFactory
    private var peer: PeerConnection? = null
    private var capturer: CameraVideoCapturer? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var localStream: MediaStream? = null
    private var observer: AndroidCallObserver? = null
    private var debugIceDiagnosticSink: ((String) -> Unit)? = null
    private var debugTimingDiagnosticSink: ((String) -> Unit)? = null
    private var debugHealthDiagnosticSink: ((AndroidCallHealthSnapshot) -> Unit)? = null
    private var debugRemoteDescriptionDiagnosticSink: ((AndroidRemoteDescriptionDiagnostic) -> Unit)? = null
    private var debugSdpObserverDiagnosticSink: ((String) -> Unit)? = null
    private var firstLocalCandidateTimed = false
    private var selectedPairTimed = false

    fun setDebugIceDiagnosticSink(sink: ((String) -> Unit)?) {
        if (BuildConfig.DEBUG) debugIceDiagnosticSink = sink
    }

    fun setDebugTimingDiagnosticSink(sink: ((String) -> Unit)?) {
        if (BuildConfig.DEBUG) debugTimingDiagnosticSink = sink
    }

    fun setDebugHealthDiagnosticSink(sink: ((AndroidCallHealthSnapshot) -> Unit)?) {
        if (BuildConfig.DEBUG) debugHealthDiagnosticSink = sink
    }

    fun setDebugRemoteDescriptionDiagnosticSink(sink: ((AndroidRemoteDescriptionDiagnostic) -> Unit)?) {
        if (BuildConfig.DEBUG) debugRemoteDescriptionDiagnosticSink = sink
    }

    fun setDebugSdpObserverDiagnosticSink(sink: ((String) -> Unit)?) {
        if (BuildConfig.DEBUG) debugSdpObserverDiagnosticSink = sink
    }

    init {
        synchronized(AndroidWebRtcEngine::class.java) {
            if (!initialized) {
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(appContext).createInitializationOptions())
                initialized = true
            }
        }
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioModule)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
    }

    fun eglContext(): EglBase.Context = egl.eglBaseContext
    fun localVideoTrack(): VideoTrack? = videoTrack

    fun start(iceServers: List<IceServerConfig>, video: Boolean, observer: AndroidCallObserver) {
        check(peer == null) { "call_peer_already_active" }
        this.observer = observer
        val servers = iceServers.flatMap { server ->
            require(server.urls.isNotEmpty() && server.urls.all { it.startsWith("stun:") || it.startsWith("stuns:") || it.startsWith("turn:") || it.startsWith("turns:") }) { "call_ice_configuration_invalid" }
            server.urls.map { url ->
                val builder = PeerConnection.IceServer.builder(url)
                if (server.username != null) builder.setUsername(server.username)
                if (server.credential != null) builder.setPassword(server.credential)
                builder.createIceServer()
            }
        }
        val rtcConfig = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        emitTimingDiagnostic("peer-connection-create-start")
        peer = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) {
                emitSdpObserverDiagnostic("peer-signaling-${state.name.lowercase()}")
                emitTimingDiagnostic(signalingTimingStage(state))
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                val label = state.name.lowercase()
                emitSdpObserverDiagnostic("peer-ice-connection-$label")
                emitIceDiagnostic("ice-state-$label")
                when (state) {
                    PeerConnection.IceConnectionState.CHECKING -> emitTimingDiagnostic("ice-checking-start")
                    PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> emitTimingDiagnostic("ice-connected")
                    PeerConnection.IceConnectionState.DISCONNECTED -> emitTimingDiagnostic("ice-disconnected")
                    PeerConnection.IceConnectionState.FAILED -> emitTimingDiagnostic("ice-failure")
                    else -> Unit
                }
                observer.onState(label)
                if (state in setOf(PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED, PeerConnection.IceConnectionState.DISCONNECTED, PeerConnection.IceConnectionState.FAILED)) {
                    collectIcePairDiagnostic(state == PeerConnection.IceConnectionState.FAILED)
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
                emitSdpObserverDiagnostic("peer-ice-gathering-${state.name.lowercase()}")
                if (state == PeerConnection.IceGatheringState.GATHERING) emitTimingDiagnostic("ice-gathering-start")
                if (state == PeerConnection.IceGatheringState.COMPLETE) emitTimingDiagnostic("ice-gathering-complete")
                if (state == PeerConnection.IceGatheringState.COMPLETE) emitIceDiagnostic("ice-gathering-complete")
            }
            override fun onIceCandidate(candidate: IceCandidate) {
                if (!firstLocalCandidateTimed) { firstLocalCandidateTimed = true; emitTimingDiagnostic("first-local-candidate") }
                emitIceDiagnostic("ice-local-candidate-${candidateType(candidate.sdp)}")
                observer.onLocalIce(IceValue(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex))
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) {
                if (BuildConfig.DEBUG && stream.audioTracks.isNotEmpty()) audioDiagnostic("remote-audio-on-add-stream", stream.audioTracks.size)
                stream.videoTracks.firstOrNull()?.let(observer::onRemoteVideo)
            }
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: org.webrtc.DataChannel) { channel.close(); channel.dispose() }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                if (BuildConfig.DEBUG && receiver.track() is AudioTrack) audioDiagnostic("remote-audio-on-add-track", streams.sumOf { it.audioTracks.size }.coerceAtLeast(1))
                (receiver.track() as? VideoTrack)?.let(observer::onRemoteVideo)
            }
            override fun onTrack(transceiver: org.webrtc.RtpTransceiver) {
                if (BuildConfig.DEBUG && transceiver.receiver.track() is AudioTrack) audioDiagnostic("remote-audio-on-track", 1)
                (transceiver.receiver.track() as? VideoTrack)?.let(observer::onRemoteVideo)
            }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                emitSdpObserverDiagnostic("peer-connection-${state.name.lowercase()}")
                emitTimingDiagnostic("peer-connection-state-${state.name.lowercase()}")
                observer.onState(state.name.lowercase())
            }
            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState) = Unit
        }) ?: run { emitTimingDiagnostic("peer-connection-create-failed"); error("call_peer_creation_failed") }
        emitTimingDiagnostic("peer-connection-created")

        val stream = factory.createLocalMediaStream("k3ncrypt-call")
        audioSource = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("k3ncrypt-call-audio", audioSource).also { stream.addTrack(it) }
        if (video) {
            val camera = Camera2Enumerator(appContext).deviceNames.firstOrNull { Camera2Enumerator(appContext).isFrontFacing(it) }
                ?: Camera2Enumerator(appContext).deviceNames.firstOrNull()
                ?: error("call_camera_unavailable")
            val enumerator = Camera2Enumerator(appContext)
            capturer = enumerator.createCapturer(camera, null) as? CameraVideoCapturer ?: error("call_camera_unavailable")
            videoSource = factory.createVideoSource(false)
            textureHelper = SurfaceTextureHelper.create("k3ncrypt-camera", egl.eglBaseContext)
            capturer!!.initialize(textureHelper, appContext, videoSource!!.capturerObserver)
            capturer!!.startCapture(640, 480, 24)
            videoTrack = factory.createVideoTrack("k3ncrypt-call-video", videoSource).also { stream.addTrack(it) }
        }
        localStream = stream
        stream.audioTracks.forEach { peer!!.addTrack(it, listOf(stream.id)) }
        stream.videoTracks.forEach { peer!!.addTrack(it, listOf(stream.id)) }
    }

    suspend fun createOffer(iceRestart: Boolean = false): SdpValue = createDescription { callback ->
        peerOrFail().createOffer(callback, MediaConstraints().apply { if (iceRestart) mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true")) })
    }.also { setLocal(it) }

    suspend fun acceptOffer(offer: SdpValue): SdpValue {
        setRemote(offer)
        val answer = createDescription { callback -> peerOrFail().createAnswer(callback, MediaConstraints()) }
        setLocal(answer)
        return answer
    }

    suspend fun acceptAnswer(answer: SdpValue) = setRemote(answer)

    fun addIce(value: IceValue): Boolean {
        val added = peerOrFail().addIceCandidate(IceCandidate(value.sdpMid, value.sdpMLineIndex, value.candidate))
        emitTimingDiagnostic(if (added) "add-ice-candidate-succeeded" else "add-ice-candidate-failed")
        return added
    }

    fun setMicrophoneEnabled(enabled: Boolean) { audioTrack?.setEnabled(enabled) }
    fun setCameraEnabled(enabled: Boolean) { videoTrack?.setEnabled(enabled) }
    fun switchCamera() { capturer?.switchCamera(null) }

    /** Collect aggregate transport/media counters only in debug builds; no addresses or payload data are retained. */
    fun collectPostConnectHealthSnapshot() {
        if (!BuildConfig.DEBUG) return
        val connection = peer ?: return
        connection.getStats(RTCStatsCollectorCallback { report ->
            val stats = report.statsMap.values.toList()
            val transport = stats.firstOrNull { it.type == "transport" }
            val selectedId = transport?.members?.get("selectedCandidatePairId") as? String
            val pairs = stats.filter { it.type == "candidate-pair" }
            val selected = pairs.firstOrNull { it.id == selectedId }
                ?: pairs.firstOrNull { it.members["selected"] == true }
                ?: pairs.firstOrNull { it.members["state"] == "succeeded" && it.members["nominated"] == true }
            val audioInbound = stats.filter { it.type == "inbound-rtp" && ((it.members["kind"] ?: it.members["mediaType"]) == "audio") }
            val audioOutbound = stats.filter { it.type == "outbound-rtp" && ((it.members["kind"] ?: it.members["mediaType"]) == "audio") }
            fun total(items: List<org.webrtc.RTCStats>, key: String): Long = items.sumOf { ((it.members[key] as? Number)?.toLong() ?: 0L).coerceAtLeast(0L) }
            fun optional(stat: org.webrtc.RTCStats?, key: String): Long? = (stat?.members?.get(key) as? Number)?.toLong()?.takeIf { it >= 0L }
            debugHealthDiagnosticSink?.invoke(AndroidCallHealthSnapshot(
                peerState = connection.connectionState().name.lowercase(),
                iceState = connection.iceConnectionState().name.lowercase(),
                signalingState = connection.signalingState().name.lowercase(),
                selectedPair = when {
                    selected == null -> "unknown"
                    selected.members["state"] == "succeeded" && selected.members["nominated"] == true -> "active"
                    else -> "inactive"
                },
                consentRequestsSent = optional(selected, "consentRequestsSent"),
                consentResponsesReceived = optional(selected, "responsesReceived"),
                audioInboundPackets = total(audioInbound, "packetsReceived"),
                audioInboundBytes = total(audioInbound, "bytesReceived"),
                audioOutboundPackets = total(audioOutbound, "packetsSent"),
                audioOutboundBytes = total(audioOutbound, "bytesSent"),
            ))
        })
    }

    fun close() {
        emitTimingDiagnostic("peer-connection-closed")
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        textureHelper?.dispose(); textureHelper = null
        peer?.close(); peer?.dispose(); peer = null
        // Detach live tracks before disposing them. MediaStream.dispose() removes
        // each remaining track and crashes if its native handle was already freed.
        audioTrack?.let { runCatching { localStream?.removeTrack(it) } }
        videoTrack?.let { runCatching { localStream?.removeTrack(it) } }
        audioTrack?.dispose(); audioTrack = null
        audioSource?.dispose(); audioSource = null
        videoTrack?.dispose(); videoTrack = null
        videoSource?.dispose(); videoSource = null
        localStream?.dispose(); localStream = null
        observer = null
        debugHealthDiagnosticSink = null
        debugRemoteDescriptionDiagnosticSink = null
        debugSdpObserverDiagnosticSink = null
        factory.dispose(); audioModule.release(); egl.release()
    }

    private fun peerOrFail() = peer ?: error("call_peer_not_initialized")
    private fun candidateType(candidate: String): String = candidate.substringAfter(" typ ", "").substringBefore(' ').takeIf { it in setOf("host", "srflx", "relay", "prflx") } ?: "unknown"
    private fun emitIceDiagnostic(stage: String) { if (BuildConfig.DEBUG) debugIceDiagnosticSink?.invoke(stage) }
    private fun emitTimingDiagnostic(stage: String) { if (BuildConfig.DEBUG) debugTimingDiagnosticSink?.invoke(stage) }
    private fun emitSdpObserverDiagnostic(stage: String) { if (BuildConfig.DEBUG) debugSdpObserverDiagnosticSink?.invoke(stage) }

    private fun collectIcePairDiagnostic(failure: Boolean) {
        if (!BuildConfig.DEBUG) return
        val connection = peer ?: return
        connection.getStats(RTCStatsCollectorCallback { report ->
            val stats = report.statsMap.values.toList()
            val selectedIds = stats.asSequence()
                .filter { it.type == "transport" }
                .mapNotNull { it.members["selectedCandidatePairId"] as? String }
                .toSet()
            val pairs = stats.filter { it.type == "candidate-pair" }
            val selected = pairs.firstOrNull { it.id in selectedIds }
                ?: pairs.firstOrNull { it.members["selected"] == true }
                ?: pairs.firstOrNull { it.members["state"] == "succeeded" && it.members["nominated"] == true }
            if (selected == null) {
                if (failure) emitTimingDiagnostic("candidate-pair-not-selected")
                emitIceDiagnostic("ice-candidate-pair-not-selected")
                if (failure) emitIceDiagnostic("ice-failure-no-selected-pair")
                return@RTCStatsCollectorCallback
            }
            if (!selectedPairTimed) { selectedPairTimed = true; emitTimingDiagnostic("candidate-pair-selected") }
            emitIceDiagnostic("ice-candidate-pair-selected")
            val localId = selected.members["localCandidateId"] as? String
            val remoteId = selected.members["remoteCandidateId"] as? String
            val localType = stats.firstOrNull { it.id == localId }?.members?.get("candidateType") as? String
            val remoteType = stats.firstOrNull { it.id == remoteId }?.members?.get("candidateType") as? String
            localType?.takeIf { it in setOf("host", "srflx", "relay", "prflx") }?.let { emitIceDiagnostic("ice-selected-local-$it") }
            remoteType?.takeIf { it in setOf("host", "srflx", "relay", "prflx") }?.let { emitIceDiagnostic("ice-selected-remote-$it") }
            if (failure) emitIceDiagnostic("ice-failure-selected-pair-not-connected")
        })
    }
    private fun audioDiagnostic(stage: String, trackCount: Int) { if (BuildConfig.DEBUG) Log.d("K3CallAudio", "$stage trackCount=$trackCount") }
    private suspend fun createDescription(create: (SdpObserver) -> Unit): SdpValue = suspendCancellableCoroutine { continuation ->
        emitSdpObserverDiagnostic("description-create-start")
        create(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) { emitSdpObserverDiagnostic("description-create-success"); if (continuation.isActive) continuation.resume(SdpValue(description.type.canonicalForm(), description.description)) }
            override fun onSetSuccess() = Unit
            override fun onCreateFailure(error: String) { emitSdpObserverDiagnostic("description-create-failure"); if (continuation.isActive) continuation.resumeWithException(IllegalStateException("call_sdp_create_failed")) }
            override fun onSetFailure(error: String) = Unit
        })
    }
    private suspend fun setLocal(value: SdpValue) = setDescription(value, true)
    private suspend fun setRemote(value: SdpValue) = setDescription(value, false)
    private suspend fun setDescription(value: SdpValue, local: Boolean): Unit = suspendCancellableCoroutine { continuation ->
        val startStage = if (local) "set-local-description-start" else "set-remote-description-start"
        val completedStage = if (local) "set-local-description-complete" else "set-remote-description-complete"
        val failedStage = if (local) "set-local-description-failed" else "set-remote-description-failed"
        emitTimingDiagnostic(startStage)
        emitSdpObserverDiagnostic(if (local) "local-set-start" else "remote-set-start")
        val type = when (value.type) { "offer" -> SessionDescription.Type.OFFER; "answer" -> SessionDescription.Type.ANSWER; else -> { continuation.resumeWithException(IllegalArgumentException("call_sdp_type_invalid")); return@suspendCancellableCoroutine } }
        val description = SessionDescription(type, value.sdp)
        val targetPeer = peerOrFail()
        if (!local && BuildConfig.DEBUG) {
            debugRemoteDescriptionDiagnosticSink?.invoke(
                AndroidRemoteDescriptionDiagnostic(
                    signalingState = targetPeer.signalingState().name.lowercase(),
                    iceConnectionState = targetPeer.iceConnectionState().name.lowercase(),
                    iceGatheringState = targetPeer.iceGatheringState().name.lowercase(),
                    transceiverCount = targetPeer.transceivers.size,
                    callingThread = safeCallingThreadName(),
                ),
            )
        }
        val callback = object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) = Unit
            override fun onSetSuccess() { emitSdpObserverDiagnostic(if (local) "local-set-success" else "remote-set-success"); emitTimingDiagnostic(completedStage); if (continuation.isActive) continuation.resume(Unit) }
            override fun onCreateFailure(error: String) = Unit
            override fun onSetFailure(error: String) { emitSdpObserverDiagnostic(if (local) "local-set-failure" else "remote-set-failure"); emitTimingDiagnostic(failedStage); if (continuation.isActive) continuation.resumeWithException(IllegalStateException("call_sdp_apply_failed")) }
        }
        if (local) targetPeer.setLocalDescription(callback, description) else targetPeer.setRemoteDescription(callback, description)
    }

    private fun safeCallingThreadName(): String {
        val name = Thread.currentThread().name
        return if (name.matches(Regex("[A-Za-z0-9_.-]{1,48}"))) name else "other"
    }

    companion object { @Volatile private var initialized = false }
}
