# K3NCRYPT Phase 8C Real-Time Communication Report

Date: 2026-09-22

## Implemented architecture

Modern calls now use a dedicated browser negotiation adapter, `ProductionCallNegotiator`. The adapter is composed only after `ModernConversation` has established an encrypted CryptoSession, current device trust, a verified contact identity, and the authenticated call composition.

1. An explicit user call action creates an authenticated invitation.
2. The authenticated call composition validates participant membership, verified identity continuity, call binding, expiry, digest, and replay sequence before any media payload reaches the negotiation adapter.
3. The adapter requests microphone/camera access only from the outgoing-call or incoming-accept action, attaches local tracks to a browser peer connection, and exchanges SDP offer/answer plus ICE candidates as authenticated encrypted call signals.
4. WebRTC negotiates DTLS-SRTP media directly between peers or through configured TURN. The application server only relays opaque authenticated signaling; it neither terminates media nor stores audio/video.

The signaling transport, media connection, and capture controller remain separate. The negotiator cannot access application message storage, attachment storage, encryption material, or device private keys.

## WebRTC boundary

`BrowserCallMediaConnection` owns only `RTCPeerConnection`, local-track attachment, SDP application, ICE candidate callbacks, and close operations. `ProductionCallNegotiator` validates SDP type/content bounds and ICE candidate bounds before application, queues candidates that arrive before a connection, tracks connection state, performs ICE restart on disconnect, and fails/cleans up on failed connectivity. Call lifecycle transitions cover ringing, accepted, connecting, connected, reconnecting, ended, failed, cancelled, rejected, and expired.

Duplicate, stale, cross-conversation, unauthorized, altered, and replayed signals remain blocked by the existing authenticated transport, identity binding, digest, and replay guard before negotiation dispatch. Unknown media signals fail closed. Calls expire using the existing 60-second invitation lifetime.

## STUN/TURN configuration

The frontend build receives `CHATE2EE_ICE_SERVERS` as a JSON array and `CHATE2EE_ICE_TRANSPORT_POLICY` as `all` or `relay`. The parser accepts only `stun:`, `stuns:`, `turn:`, and `turns:` URLs plus string TURN credentials; malformed configuration results in no configured ICE servers. No TURN URL, username, password, or key is hardcoded. Use `relay` only after provisioning working authenticated TURN infrastructure. These variables are documented in [.env.production.sample](/Users/sakibulhudaonnay/Documents/ChatGPT/chatapp/.env.production.sample) and pass through the frontend Docker build arguments.

## Security and privacy guarantees

- Call negotiation starts only after authenticated signaling, verified contact identity, and current device trust.
- SDP and ICE are integrity-bound inside the existing encrypted signaling envelope; altered or unauthorized payloads are rejected before peer-connection calls.
- Media is peer-to-peer DTLS-SRTP or TURN-relayed; K3NCRYPT has no plaintext media persistence path.
- Microphone/camera requests are explicit foreground call actions. Permission denial produces a generic error and closes the partial connection.
- On end, failure, cancellation, or browser capture release, all local tracks are stopped and peer connections are closed.
- Operational logging never receives SDP, ICE candidates, media, encryption material, identities, capabilities, or private identifiers.

## Remaining limitations

- Browser WebRTC interoperability and TURN reachability require a staging test against the selected browsers and deployed TURN service.
- The current UI exposes private audio calling. Camera capability exists at the capture boundary but is not yet a user-selectable video-call control.
- Calls remain intentionally single-peer. Group calling needs a separately reviewed media topology and authorization model.

## Validation results

| Gate | Result |
| --- | --- |
| Jest | Passed: 89 suites, 409 tests; 1 environment-gated test skipped |
| Service TypeScript | Passed |
| ESLint | Passed |
| Client production build | Passed: 213 modules transformed |
| SDK build | Passed |
| npm audit | Passed: 0 vulnerabilities at high threshold |
| Docker builds | Passed: backend and frontend production images built locally |
| Diff check | Passed: no whitespace errors |
