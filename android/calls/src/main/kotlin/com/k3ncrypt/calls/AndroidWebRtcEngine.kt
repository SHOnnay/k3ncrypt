package com.k3ncrypt.calls

import android.content.Context
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
        peer = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) { observer.onState(state.name.lowercase()) }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) { observer.onLocalIce(IceValue(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)) }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) { stream.videoTracks.firstOrNull()?.let(observer::onRemoteVideo) }
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: org.webrtc.DataChannel) { channel.close(); channel.dispose() }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) { (receiver.track() as? VideoTrack)?.let(observer::onRemoteVideo) }
            override fun onTrack(transceiver: org.webrtc.RtpTransceiver) { (transceiver.receiver.track() as? VideoTrack)?.let(observer::onRemoteVideo) }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) { observer.onState(state.name.lowercase()) }
            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState) = Unit
        }) ?: error("call_peer_creation_failed")

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

    fun addIce(value: IceValue) {
        check(peerOrFail().addIceCandidate(IceCandidate(value.sdpMid, value.sdpMLineIndex, value.candidate))) { "call_ice_candidate_rejected" }
    }

    fun setMicrophoneEnabled(enabled: Boolean) { audioTrack?.setEnabled(enabled) }
    fun setCameraEnabled(enabled: Boolean) { videoTrack?.setEnabled(enabled) }
    fun switchCamera() { capturer?.switchCamera(null) }

    fun close() {
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        textureHelper?.dispose(); textureHelper = null
        peer?.close(); peer?.dispose(); peer = null
        audioTrack?.dispose(); audioTrack = null
        audioSource?.dispose(); audioSource = null
        videoTrack?.dispose(); videoTrack = null
        videoSource?.dispose(); videoSource = null
        localStream?.dispose(); localStream = null
        observer = null
        factory.dispose(); audioModule.release(); egl.release()
    }

    private fun peerOrFail() = peer ?: error("call_peer_not_initialized")
    private suspend fun createDescription(create: (SdpObserver) -> Unit): SdpValue = suspendCancellableCoroutine { continuation ->
        create(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) { if (continuation.isActive) continuation.resume(SdpValue(description.type.canonicalForm(), description.description)) }
            override fun onSetSuccess() = Unit
            override fun onCreateFailure(error: String) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("call_sdp_create_failed")) }
            override fun onSetFailure(error: String) = Unit
        })
    }
    private suspend fun setLocal(value: SdpValue) = setDescription(value, true)
    private suspend fun setRemote(value: SdpValue) = setDescription(value, false)
    private suspend fun setDescription(value: SdpValue, local: Boolean): Unit = suspendCancellableCoroutine { continuation ->
        val type = when (value.type) { "offer" -> SessionDescription.Type.OFFER; "answer" -> SessionDescription.Type.ANSWER; else -> { continuation.resumeWithException(IllegalArgumentException("call_sdp_type_invalid")); return@suspendCancellableCoroutine } }
        val description = SessionDescription(type, value.sdp)
        val callback = object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) = Unit
            override fun onSetSuccess() { if (continuation.isActive) continuation.resume(Unit) }
            override fun onCreateFailure(error: String) = Unit
            override fun onSetFailure(error: String) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("call_sdp_apply_failed")) }
        }
        if (local) peerOrFail().setLocalDescription(callback, description) else peerOrFail().setRemoteDescription(callback, description)
    }

    companion object { @Volatile private var initialized = false }
}
