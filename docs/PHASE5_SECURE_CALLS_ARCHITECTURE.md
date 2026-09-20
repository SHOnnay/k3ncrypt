# Phase 5 secure calls: architecture boundaries (design only)

No call functionality, signaling, WebRTC wiring, or permissions are introduced by this document. Existing Phase 3 identity/Vodozemac sessions, encrypted persistence, mailbox and transport protocol, and Phase 4 media/attachment encryption remain frozen. Existing legacy WebRTC code is not a reviewed modern-call integration.

## Signaling and identity

- Define call invitation, acceptance, ICE exchange, cancellation, and hang-up as versioned, bounded messages authenticated and encrypted by the existing modern conversation, with replay and expiry handling. Never treat a relay room, socket ID, or unverified invite as a call identity. Require fail-closed behavior after an identity change, revoked session, or protocol mismatch; legacy compatibility needs a separate explicit decision.
- Bind both peers' call signaling and media connection to the verified conversation identity. Specify how the E2EE-authenticated signaling transcript binds DTLS fingerprints, ICE credentials, participants, and session lifetime, with adversarial tests against substitution, glare, replay, stale offers, and cross-conversation confusion. WebRTC transport encryption alone does not authenticate the human contact.
- The signaling server should forward opaque bounded messages, enforce existing access controls, and not receive media content keys. Server-visible call timing, participant routing, ICE addresses, packet sizes, and availability still leak metadata.

## Media and network boundary

- Review browser WebRTC DTLS-SRTP behavior and actual peer authentication before implementation. If an SFU, transcoder, recording service, or other media-terminating component is proposed, ordinary WebRTC encryption does not keep media hidden from it; an additional reviewed end-to-end media design would be required. Never promise E2EE from transport encryption alone.
- Establish deployment requirements for STUN/TURN, NAT traversal, relay-only privacy options, TURN credentials/expiry, quotas, abuse controls, and IP-address exposure. No public unauthenticated TURN relay or hardcoded credentials. Document connectivity tradeoffs when relay-only is chosen.
- Request microphone access only after an explicit call action; request camera access only after a separate explicit video action. Show active device state, allow mute/stop, stop tracks on hang-up/failure/navigation, and do not activate background capture. Permissions must not be requested during onboarding or passive incoming-call display.
- Define ringing and notification behavior without revealing contact names or call content to third parties. Recording, screenshots, OS-level capture, compromised endpoints, and remote-party recording cannot be prevented by E2EE; any app recording needs separate consent and local encrypted-storage design, not a silent default.

## Acceptance before implementation

Threat-model identity and signaling binding, media endpoint visibility, relay metadata, device permissions, denial-of-service and revocation. Obtain a separate protocol/security review and browser interoperability plan. Specify negative tests and deployment dependencies before code is written. No Phase 3/4 protocol default, keys, verification state, or attachment security model should be changed as a shortcut.
