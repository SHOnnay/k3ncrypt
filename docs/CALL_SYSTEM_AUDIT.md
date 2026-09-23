# K3NCRYPT Call System Audit

This is a read-only review of the current calling implementation. It evaluates the code paths in `service/src/calls`, `service/src/webrtc`, `service/src/privacy`, and the SDK integration. It does not redesign or modify the implementation.

## Summary

| Area | Classification | Assessment |
|---|---|---|
| Voice calls | Partially working | Audio capture, offer/answer, ICE, encrypted signaling, and teardown are implemented. Browser and network failure behavior still needs production validation. |
| Video calls | Missing | Camera permission and camera capture helpers exist, but the active `Peer` implementation always requests microphone-only media and only attaches audio tracks. |
| WebRTC lifecycle | Partially working | Peer creation, offer/answer, candidate buffering, state callbacks, reconnect offer, and close are present. Timeout, renegotiation, and all failure races are not fully closed. |
| Signaling | Working with limitations | Call signals are encrypted inside the conversation session, identity-bound, digest-checked, expiry-checked, and replay-checked. Transport and server integration need end-to-end network tests. |
| ICE/STUN/TURN | Partially working | Explicit ICE configuration and relay-only policy are supported; defaults intentionally use no external servers. TURN credential lifecycle and operational fallback are not supplied by this layer. |
| Media permissions | Partially working | Foreground permission requests, denial handling, visibility cancellation, and track release are implemented. Camera is not connected to a production video call path. |
| Encryption boundary | Working for signaling and WebRTC transport | Signaling uses the existing encrypted conversation session; media uses browser-mandated DTLS-SRTP. No custom media cryptography is added. |
| Call state management | Partially working | State transitions, expiry, rejection, cancellation, reconnecting, failure, and cleanup exist, but independent state machines can drift. |
| Mobile readiness | Missing | The reviewed implementation is browser/WebRTC oriented and has no verified native mobile media, permission, background, notification, or network lifecycle integration. |
| Beta readiness | Critical before beta | Video is absent and production call reliability, mobile behavior, and TURN operations are not verified. |

## 1. Voice call flow — Partially working

`ChatE2EE.startCall()` creates a `WebRTCCall`, sends an authenticated call invite, and prepares a `Peer`. `Peer.addLocalAudioTracks()` requests `{ audio: true, video: false }`, adds the audio track, creates an SDP offer, and sends the offer through the signaling callback. The receiving side routes the offer, creates an answer, and exchanges ICE candidates. Remote audio tracks are attached to `AudioSink`.

The call composition additionally checks encrypted/ready session state, device trust, participant membership, identity verification, signal expiry, sequence, and replay. This is a coherent two-party voice flow in the browser.

Limitations are that the default configuration has no STUN/TURN servers, browser NAT behavior is not guaranteed, and full network failure/recovery behavior is not demonstrated by a production integration test.

## 2. Video call flow — Missing

`CallMediaController` supports a `camera` request and the permission model tracks camera state, but `ProductionCallNegotiator` defaults to microphone capture and `Peer.getAudioStream()` is hard-coded to microphone-only constraints. `Peer.ontrack` attaches audio tracks to `AudioSink` and has no video renderer or remote video sink. The public SDK call methods do not expose a video mode.

Therefore camera permission code is a reusable foundation, not a working video-call feature. A beta UI must not present video calling as available.

## 3. WebRTC connection lifecycle — Partially working

The implementation creates `RTCPeerConnection` with configured ICE servers and policy, emits candidates, accepts offers and answers, buffers candidates that arrive before a connection exists, and closes the peer and media tracks on teardown. `ProductionCallNegotiator` maps connected, reconnecting, failed, and closed states into call events and attempts an ICE restart on reconnect.

The lifecycle does not show a bounded retry policy, a connection timeout independent of invitation expiry, explicit handling for `iceConnectionState`/`iceGatheringState`, or a robust guard against simultaneous reconnect offers. The separate SDK call lifecycle and negotiation lifecycle can also emit competing terminal transitions.

## 4. Signaling flow — Working with limitations

`SecureCallSignaling` validates call/session/conversation binding, identity binding, participant membership, timestamp and expiry, payload digest, and replay keys. `AuthenticatedCallSignalTransport` encrypts the serialized signal with the existing conversation `CryptoSession` before handing it to the transport. Incoming signals are decrypted, checked against the remote identity, and passed to the replay-aware signaling layer.

The WebRTC payload validator bounds SDP and candidate sizes and rejects malformed descriptions. Signaling correctness still depends on the transport delivering the encrypted envelope to the intended peer and on integration coverage across reconnect, cancellation, and delayed candidate ordering.

## 5. ICE/STUN/TURN configuration — Partially working

`WebRtcConfig` supports `iceServers` and `iceTransportPolicy`, including relay-only mode. Defaults are an empty server list and `all`, which avoids hidden third-party traffic but means many internet/NAT scenarios will fail without explicit infrastructure. TURN credentials are supplied by configuration; this code does not provide credential issuance, rotation, health checks, or expiry handling.

Production deployments need an operational TURN service, secret management, regional capacity planning, and tests for direct, STUN-assisted, and TURN-relayed calls.

## 6. Media permission handling — Partially working

`BrowserCaptureController` gates `getUserMedia` behind an explicit request, rejects hidden-document capture, stops tracks on cancellation or release, and removes its visibility listener. `CallMediaController` maps microphone/camera requests and denial to a generic error. The SDK settings surface describes foreground call permission behavior.

The permission state model is not visibly persisted or reconciled with browser permission changes, and camera state is not consumed by a live video call. Mobile-specific permission prompts and lifecycle callbacks are absent.

## 7. Encryption boundaries — Working for current scope

Call signaling is encrypted using the existing conversation session before relay transport. WebRTC media relies on the browser’s DTLS-SRTP protection, as documented in `WebRTCCall` and `Peer`. The implementation does not invent a second media cipher or export media keys. This leaves media confidentiality dependent on authenticated peer negotiation and WebRTC’s standard transport security; it is not an independently implemented media E2EE layer.

## 8. Call state management — Partially working

`transitionCall` defines explicit states for inviting, ringing, accepted, connecting, connected, reconnecting, ended, rejected, cancelled, expired, and failed. Heartbeat freshness and invitation expiry are enforced. `CallSignalRouter` tracks one active call, buffers candidates, rejects stale sequences, and clears state on reset.

The SDK also maintains a separate `callLifecycleState`, outgoing invite timer, active call id, and signal sequence. There is no single durable state authority across these layers, and the audit did not find a complete abandoned-session sweeper or persisted call history. Duplicate-call handling is mainly an in-memory active-call check.

## 9. Mobile readiness — Missing

The reviewed call path assumes browser globals (`RTCPeerConnection`, `navigator.mediaDevices`, `document`, `MediaStream`, and browser audio output). No verified Android/iOS adapter, native permission bridge, background-call policy, push notification wake-up, audio route management, interruption handling, or mobile network transition integration is present in these call modules.

## 10. Missing production requirements

- A real video media path with local/remote video rendering, camera lifecycle, and renegotiation.
- Production TURN deployment, credential rotation, monitoring, and relay-only validation.
- End-to-end tests across real browsers and representative NAT/network conditions.
- Bounded call connection and reconnect timeouts with deterministic terminal cleanup.
- Unified lifecycle ownership for SDK call state, WebRTC state, cancellation, and abandoned calls.
- Mobile platform adapters and permission/background/audio-route integration.
- Operational privacy review for call metadata, logs, metrics, and failure reporting.
- Explicit product behavior for unsupported browsers and unavailable media devices.

## Final assessment

The current implementation provides a credible authenticated, encrypted signaling and browser voice-call foundation. It is **partially working**, not a complete voice/video calling product. Video calling and mobile calling are missing, while production NAT traversal and lifecycle reliability remain unverified. These are **critical before beta** if beta messaging includes calling as a supported product capability.
