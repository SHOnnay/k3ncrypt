# Phase 5 complete call flow

This document describes the implemented one-to-one call path. Calls remain an isolated subsystem; Vodozemac, message encryption, mailbox delivery, attachments, and Phase 4 media security are unchanged.

## Pipeline

1. A user starts a call from the existing conversation. The SDK checks channel readiness, participant availability, and WebRTC support, creates an opaque call ID, and sends an encrypted call invitation through the conversation's signaling channel.
2. The recipient receives only a decrypted, replay-checked signaling event. The existing call overlay presents the incoming state and exposes accept/decline actions. No media permission is requested for a passive invitation.
3. Accept/reject/cancel/end/timeout events are scoped to the active call ID and monotonically increasing sequence. Duplicate or stale events are ignored. The Phase 5 call foundation additionally validates conversation, participant, identity binding, expiry, and terminal-state transitions.
4. On acceptance, the WebRTC peer creates an offer or answer and exchanges SDP and ICE candidates through the authenticated encrypted signaling path. The peer lifecycle reports connecting, connected, reconnecting, failed, and closed states.
5. The browser requests microphone access only when the active peer starts the call. Local tracks are added to the peer connection, remote audio is attached to an autoplay audio sink, and all local tracks and sinks are stopped/detached when the call ends or fails.
6. Call teardown sends a terminal event when possible, disposes the peer, clears subscriptions and timers, and releases media resources. A failed or disconnected peer cannot silently continue as an authenticated call.

## Signaling visibility

The signaling relay can observe opaque routing, timing, call state, packet sizes, connection failures, and availability. It cannot decrypt the authenticated signaling envelope or access media content through the existing E2EE session. It must not be treated as a source of participant identity or verification. The server does not receive audio/video, media keys, recordings, or public media URLs.

## WebRTC boundary

WebRTC's DTLS-SRTP protects media in transit between negotiated endpoints. The peer implementation uses browser connection lifecycle and ICE candidate exchange; it does not add an external STUN provider or hardcoded TURN credentials. WebRTC transport encryption does not authenticate a human contact by itself, hide metadata, or protect a compromised endpoint. Any future SFU or media-terminating relay would require a separate review because it can see media it terminates.

## Privacy and limitations

- No call recording, analytics, device fingerprinting, background capture, or public media storage is added.
- Microphone access is user-action initiated by the active call path; permission denial fails the call and does not persist browser errors.
- Camera/video is not enabled by the current call UI or peer media path; no camera permission is requested.
- The remote participant can record or screenshot locally, and a compromised browser/OS can observe decrypted media.
- TURN deployment, relay-only IP privacy, short-lived relay credentials, rate limits, and production signaling deployment remain operational gates.
- Group calls, multi-device calls, and media-layer end-to-end encryption beyond WebRTC transport are not implemented.

## Security tests and acceptance

The service tests cover fake/unauthorized participants, identity-change rejection, expiry, duplicate signaling, invalid transitions, permission denial, reconnect/disconnect mapping, track cleanup, and terminal call cleanup. Browser tests cover the existing call control and modern conversation regressions. Before production enablement, run the complete browser matrix on supported hosts and perform an independent review of the deployed signaling and relay configuration.
