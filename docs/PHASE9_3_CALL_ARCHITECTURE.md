# Phase 9.3 Voice and Video Calling Architecture

## Scope and security boundary

Phase 9.3 adds trusted one-to-one voice and video calling to the browser and Android clients. Calls reuse the verified conversation, its device trust state, the current device-authorization proof authority, and the existing encrypted signaling session. The backend remains an opaque signaling relay. WebRTC's negotiated DTLS-SRTP media transport protects live media; K3NCRYPT must not add a home-grown media encryption layer or represent the server as a media endpoint.

Calls are available only when the conversation is established, the peer fingerprint has been confirmed, both device states are current, and the authenticated conversation session is ready. A changed or unverified identity fails closed. The caller's short-lived `relay:signal` authorization proof is scoped to the conversation and is attached to relay signaling requests; the signed/encrypted call signal additionally binds call ID, conversation, verified caller and intended peer identities, media mode, timestamp, expiration, and monotonic sequence/nonce. SDP and ICE data stay inside the existing encrypted signaling envelope. The relay validates the device proof and conversation routing, forwards the opaque envelope, and never receives media.

## Repository audit and implementation boundary

- The service SDK has `CallSession`, state transitions, participant verification, expiring and replay-checked signaling, an encrypted `AuthenticatedCallSignalTransport`, and a browser `ProductionCallNegotiator`.
- Browser WebRTC uses `RTCPeerConnection`, requests microphone/camera tracks following explicit user action, and accepts runtime ICE configuration. The modern authenticated client now routes voice and video through the same verified conversation call composition.
- The backend has a `webrtc-signal` Socket.IO event. It requires a conversation-scoped `relay:signal` proof, rate-limits and size-checks requests, and forwards an opaque encrypted envelope to the other room participant. It does not terminate WebRTC or process media.
- Android now has a native WebRTC engine, proof-carrying `webrtc-signal` relay send/receive, a call controller, Compose call controls, runtime microphone/camera permission requests, and local/remote video rendering. Calls require an already established encrypted Olm conversation session and a trusted active conversation; the call path does not establish or substitute for that messaging session.
- Android's `RECORD_AUDIO` and `CAMERA` manifest declarations are already present. They are declarations only; runtime requests, lifecycle release, native audio routing, and video rendering still need implementation.
- Android uses Rust/Vodozemac as the identity and message cryptography authority. Call signaling must remain in that boundary; Kotlin must not create keys or invent signatures. The WebRTC engine handles its standard DTLS-SRTP media security independently from the end-to-end encrypted control/signaling channel.

## Target architecture

### Call authorization and signaling

1. User explicitly taps voice or video in an open, verified one-to-one conversation.
2. The client re-checks current peer verification, device trust freshness, authenticated session readiness, and conversation membership.
3. It obtains a short-lived proof for `relay:signal`, scoped to that conversation. It does not persist the proof beyond its expiry.
4. The caller creates a call ID, `audio` or `video` media mode, expiry, sequence 1, and a cryptographically random call nonce. The existing Vodozemac/conversation signaling boundary authenticates and encrypts this control signal.
5. Socket.IO transports the encrypted envelope with the authorization proof. The backend validates proof scope and socket-bound conversation membership, enforces size/rate limits, and relays the opaque envelope only to the other participant.
6. The recipient decrypts and validates the signal, expiration, sequence/replay state, sender identity, intended receiver identity, conversation binding, and current trust. Only then does UI show incoming-call controls.
7. Accept/reject and subsequent offer/answer/ICE signals follow the same authenticated and encrypted path. Decline, timeout, cancellation, disconnect, or end performs a terminal state transition and releases local media and peer resources.

### Media plane

The browser uses its native WebRTC APIs. Android uses the WebRTC Android native library through a narrow Kotlin adapter. Both sides create a peer connection only after authorization and explicit local user acceptance/action. Microphone and camera tracks are requested only when needed, attached to the peer, and stopped on terminal state or permission/lifecycle loss. ICE configuration comes from the existing runtime configuration (STUN/TURN URLs and short-lived TURN credentials); relay-only policy is supported where deployment policy requires it. The service/backend does not proxy audio or video.

### Android integration boundary

Add an Android call controller and WebRTC adapter in `:calls`, injected by the app through Hilt. The adapter wraps `PeerConnectionFactory`, `PeerConnection`, `AudioSource`/`AudioTrack`, `VideoSource`/`VideoTrack`, and `SurfaceViewRenderer`; it exposes opaque SDP/ICE values and connection/media events to the call controller. It does not receive identity private keys or bypass `CryptoPort`, `ProofGuard`, `AndroidMessagingRepository`, or the trusted conversation. A proof acquisition API and a proof-carrying `webrtc-signal` API are added to existing network adapters. Incoming calls are accepted only after normal Android UI confirmation.

## Phased implementation and current status

### 9.3.1 WebRTC foundation — implemented, build-verified

Browser uses the existing service negotiator and Android uses the native WebRTC adapter. Android closes native tracks, peer, factory, and audio resources at terminal state. Browser/Android call controls expose audio mute, video toggle, Android camera switch, and local/remote video surfaces. Browser ICE settings are read from runtime configuration. Android currently accepts ICE server settings through the controller API but the app UI does not yet provision STUN/TURN credentials; direct ICE may fail behind NAT.

### 9.3.2 Signaling — implemented, unit-verified

Android and browser carry call signals over the existing encrypted conversation session and proof-scoped Socket.IO relay. The shared binding covers call ID, conversation, sender/receiver identities, media mode, timestamp, expiry, nonce, sequence, and payload digest. Android queues local ICE until the invite/accept is sent and serializes signal sends. The backend still relays opaque envelopes and does not parse SDP/ICE or carry media.

### 9.3.3 Voice call — implementation present; live interoperability unverified

Browser and Android call UIs request microphone access on explicit start/accept, negotiate audio tracks, and expose mute/end/state controls. Signals expire and calls time out locally. A real Browser↔Android audio connection has not yet been demonstrated.

### 9.3.4 Video call — implementation present; live interoperability unverified

The same call protocol binds `audio` or `video`. Android attaches camera tracks and renders local/remote video; browser attaches browser media tracks and renders streams. Permission-denial feedback and camera/microphone controls exist. Camera denial does not silently downgrade a video invitation. A real Browser↔Android video connection has not yet been demonstrated.

### 9.3.5 Call security validation — partial

Service call tests cover verified identity checks, signal expiry/replay, proof-scoped signaling, negotiation, permission/media handling, and cleanup. Android unit tests cover signal binding/validation and permission-denial messages. Full Android permission instrumentation, disconnect/reconnect tests, malformed media-signal integration tests, and live revocation during an active call remain outstanding.

### 9.3.6 End-to-end testing — blocked by unavailable emulator tooling

The current environment has no `adb` executable, so a persistent emulator could not be launched and no live Browser→Android or Android→Browser call was asserted. Required validation remains: both directions for audio and video, permission denial, network interruption/recovery, cleanup, and call availability after app restart. Use real media-capable devices for final microphone/camera confirmation; emulator loopback alone does not establish physical device behavior. Do not create a release tag until every required direction/mode passes.

## Validation and release gates

Unit tests cover shared call contracts/state transitions, proof and replay enforcement, WebRTC adapter lifecycle, permission denial, cleanup, and malformed signal handling. Browser tests cover UI/media handling and call protocol. Android local and instrumentation tests cover native peer construction, runtime permissions, audio/video track lifecycle, and relay proof attachment. End-to-end tests assert both clients reach connected state and media tracks become live while the relay sees only encrypted signaling envelopes. Network interruption tests verify reconnect or a safe terminal failure without stale media resources.

The requested Browser↔Android voice/video matrix requires a running local backend/Mongo, `adb` plus a persistent emulator that grants microphone/camera access, and a browser with camera/microphone permission. Unit/build success cannot substitute for that live interoperability evidence. The repository can build and the focused SDK/Android tests pass, but the feature is not release-ready until E2E calls and Android runtime-ICE provisioning are validated.

## Current status and limitations

The signaling and media implementations are now present in source, with focused tests/builds passing. The cross-platform call milestone remains incomplete because live calls could not be run and TURN credentials are not yet wired into Android app configuration. No claim of call readiness or production TURN readiness is made here.
