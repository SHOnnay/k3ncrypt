# Peer Admission v1 — security requirements

Status: specification only. **No adapter may implement this handshake until a security reviewer approves the wire transcript and fixtures.** Reuse existing device signing primitives; no new cryptographic construction or dependency.

## Preconditions

Admission is only for an already paired, explicitly verified, unchanged contact with an active local device, healthy existing conversation session, enabled path preferences and available required lifecycle freshness. Admission cannot create a contact, verify it, fetch a bundle, or change conversation mode.

## Required transcript binding

Bind both device identity references, conversation ID, fresh nonce of at least 128 bits from each peer, initiator/responder role labels, offered and selected control versions, and transport binding. For WebRTC, bind both DTLS certificate fingerprints. Select the highest mutually supported version. Sign a domain-separated transcript under `k3ncrypt/peer-admission/v1` using existing device signing keys.

Use a length-prefixed binary transcript with cross-language fixtures. Do not trust JSON property order, peer timestamps or wall clocks. No unauthenticated endpoint hint is identity evidence.

## Admission output and lifecycle

Successful admission returns a short-lived binding to conversation, remote identity, transport binding hash and local monotonic expiry. Every subsequent envelope on that connection is checked against the binding. Close the path on verification change, identity change, known revocation, loss of required freshness, unhealthy session, expiry or owner shutdown.

Pre-auth limits: bounded frame size, handshake timeout, per-source rate, maximum concurrent unauthenticated connections and bounded memory. Allocate no durable conversation state before admission. Unknown peer/conversation/bad signature have uniform external failures; bounded local reason codes are permitted.

Admission failure never affects relay delivery. Discovery is an untrusted hint. A path event never changes trust or verification.

## Required negative tests before implementation

Replay, reflection, role swap, nonce reuse, wrong conversation, wrong device, wrong DTLS fingerprint, unsupported/downgraded version, changed identity, revoked device, unavailable freshness, oversized frame, exhausted connection limit, timeout and malformed transcript all reject. Rejected admission creates no conversation/contact/session state and leaves relay functioning.
