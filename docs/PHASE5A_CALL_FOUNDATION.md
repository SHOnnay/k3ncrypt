# Phase 5A secure calling foundation

Phase 5A adds only a typed, testable non-media call boundary. It does not request browser permissions, capture devices, implement WebRTC, connect TURN/STUN, add signaling sockets, or add UI.

## Architecture

`service/src/calls/` contains call contracts, a state machine, configurable security policy, permission-state bookkeeping, and an injected signaling abstraction. `CallSession` stores only opaque call/conversation identifiers, two participant identity bindings and verification states, lifecycle timestamps, expiry, and state. It never stores audio, video, media keys, private keys, or device data.

## State and security decisions

Valid progression is `idle → inviting → ringing → accepted → connecting → connected → ended`. Rejection, cancellation, expiry, and failure are terminal. Invalid transitions, expired sessions, identity-change review states, unauthorized participants, mismatched call/conversation IDs, and mismatched identity bindings fail closed. Duplicate signal sequence keys are safely ignored. Policy bounds invitation lifetime, heartbeat timeout, participant count (currently one-to-one), and sequence behavior.

Permission bookkeeping has explicit `unknown`, `requested`, `granted`, `active`, `released`, and `denied` states for microphone and camera. Initialization is `unknown`; no API is called. Future device code must request only after user action and always record release.

## Threat boundaries

The existing modern E2EE conversation remains the authority for participant identity, verification, encryption, replay protection, and downgrade behavior. This foundation accepts an injected identity verifier; it does not create credentials or trust changed identities. Signaling is an abstraction only and must later carry bounded, authenticated, call-scoped events. WebRTC and TURN/STUN are deliberately outside this phase; their transport and metadata properties require separate review.

## Future integration points

- Bind a reviewed signaling implementation to the existing modern conversation and `CallSignalTransport`.
- Bind offer/answer and ICE transcript data to `CallSession.identityBinding` before adding WebRTC.
- Add browser permission adapters only around the permission state machine; keep capture out of initialization and release on every terminal path.
- Add one-to-one WebRTC and TURN/STUN deployment only after peer authentication, relay metadata, abuse, and endpoint privacy review.
- Design group calls separately; do not raise `maxParticipants` by configuration alone.

Phase 3 and Phase 4 crypto, identity, mailbox, transport, attachment, media-message, and legacy behavior remain unchanged.
