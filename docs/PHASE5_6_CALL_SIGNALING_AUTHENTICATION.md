# Phase 5.6 call signaling authentication

The call transport now binds signaling to the existing authenticated conversation session. A SHA-256 digest alone is not an identity proof: a relay that can rewrite a signal could recompute it. The concrete `AuthenticatedCallSignalTransport` therefore encrypts the complete signal through the existing `CryptoSession` signaling channel and checks the local sender identity before sending and the expected remote identity before delivery.

## Bound fields and trust boundary

The canonical digest covers call ID, conversation ID, sender identity reference, event/kind, SDP or ICE payload, sequence, timestamp, expiry, and the call identity binding. The encrypted conversation session proves that the sender controls the established authenticated security context; the digest detects payload mutation inside that context. A relay can forward ciphertext but cannot create a valid signaling envelope for another participant.

## Replay outcomes

`ReplayProtectionStore` now distinguishes `accepted`, `duplicate`, `expired`, and `capacity-exceeded`. The memory implementation performs TTL cleanup and bounded claims for tests. Production must provide an atomic durable implementation shared across instances, with expiry indexes and a retry/outbox decision so a transport failure does not create unsafe replay or availability behavior.

## Attack results

Modified SDP/ICE, forged sender identity, wrong conversation, unverified/changed identity, expired signals, duplicate sequence values, and unauthenticated receive origins are rejected by the binding/transport tests. No new key or identity mechanism was introduced, and Phase 3/4 security boundaries remain unchanged.

## Remaining risk

The transport adapter must be used for every deployed signaling path; a caller that bypasses it and sends raw relay envelopes would lose this guarantee. Production durable replay persistence, authenticated session lifecycle, and deployment-level browser/relay review remain required.
