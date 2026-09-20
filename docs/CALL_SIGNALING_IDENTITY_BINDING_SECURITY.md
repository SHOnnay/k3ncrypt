# Call signaling identity binding

Call SDP, ICE, and control payloads are covered by a canonical SHA-256 digest over the call ID, conversation ID, sender identity reference, event/kind, payload, sequence, timestamp, expiry, and the existing conversation identity binding. `SecureCallSignaling` verifies the digest, participant membership, verification-change state, call scope, expiry, and clock bounds before forwarding the payload.

The digest is an integrity binding, not a second identity system or standalone signature. Ownership/authentication comes from the existing encrypted modern-conversation signaling envelope and its session keys; a relay cannot forge a valid envelope without the conversation security context. Modified SDP or ICE fails digest verification, while a changed contact identity fails authorization. Payloads remain opaque to the server.

Replay claims are delegated to `ReplayProtectionStore`, which rejects duplicate call/sender/sequence keys, expires entries, and provides a bounded memory implementation plus a persistence interface for deployment storage. Production must supply a durable, atomic implementation shared by instances; the memory implementation is for tests and single-process development only.
