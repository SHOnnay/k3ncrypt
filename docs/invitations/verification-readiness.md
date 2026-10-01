# Verification protocol readiness prerequisites

**Status:** Prerequisite work only. SAS remains disabled and is not implementation-ready.

This document records the narrow changes made against `verification-protocol-review.md`. It does not amend or approve that candidate SAS transcript. The existing explicit fingerprint comparison remains the only verification flow.

## Blocker closure map

| Review blocker | Before | Readiness work | State after this phase |
|---|---|---|---|
| Android production identity-signature verification | `CryptoPort`/JNI could sign but could not verify; JCA provider availability was not safe to assume at minSdk 26. | Added a bounded `CryptoPort.verifyIdentitySignature` operation, implemented by the existing Rust/Vodozemac Ed25519 verifier through JNI. Inputs are normalized and length-checked; malformed encodings and invalid signatures fail closed. Added a fixed shared-vector Rust test and an Android instrumentation test through the production bridge. | **Implementation prerequisite addressed.** Android's configured minSdk is 26; verification uses the bundled Vodozemac implementation, not platform Ed25519 providers. Device execution of instrumentation tests is still required before release. The API is not wired to trust upgrades. |
| Authenticated capability negotiation | Relay `protocolFeatures`/`peerFeatures` are client-supplied and relay-forwarded metadata, not authenticated. | Documented the current hint as unauthenticated, non-authoritative compatibility metadata. Required future binding is an identity-signed, domain-separated capability statement covering protocol and exact versions, conversation, both current identity commitments, intended peer, freshness/expiry, and the selected version; both parties must authenticate the selection before a SAS frame is enabled. | **Open blocker.** No authenticated SAS capability exchange is implemented. Do not treat relay hints, join success, or the introduction signature as authenticated capability negotiation. Exact wire encoding and old-client-safe probe remain dependent on a reviewed SAS protocol and compatibility decision. |
| Web/Android peer-introduction parity | Web had signed, encrypted `join-introduction-v1`; Android did not install the joiner's validated descriptor on the inviter. | Added the matching bounded Android frame encoder/parser and production send/receive path. Android validates the existing encrypted delivery, conversation and sender route, fetched pre-key identity pair, commitment, and Ed25519 signature before atomically storing route, identity descriptor, and replay marker. It creates no chat message and writes no verified state. | **Runtime path added; interoperability evidence in place.** The same deterministic event/canonical-signature/frame vector is consumed by TypeScript, Kotlin, and Rust tests. Full device-pairing tests remain required. The relay feature hint only gates compatibility and remains unauthenticated. |
| Android route/contact creation versus trust | Join UI required entering the full fingerprint to continue, coupling route setup with explicit verification. | Invitation join now stores the validated joiner's own route and claimed peer identity as unverified setup state. The inviter pins the peer only after accepting the authenticated introduction. Existing `ContactVerification` remains the sole Android verification state writer; calls still require `VERIFIED`, while message sending requires a route and stays available for unverified contacts. | **Join prerequisite removed without trust change.** Route and fingerprint values alone do not set `VERIFIED`; invitation, introduction, and messages do not upgrade trust. Existing manual fingerprint comparison is still the explicit verification action. |
| Cross-platform protocol fixtures | No readiness fixture covered a common identity/signature/introduction exchange across all client pairings. | Added a deterministic fixture with public identity material, existing fingerprint commitment, exact signed introduction bytes, frame prefixes, canonical encoding, capability-hint semantics, and Web/Web, Android/Android, Web/Android, Android/Web pairing entries. `sasExpected` is deliberately `null`. | **Current-protocol fixture prerequisite addressed.** These are introduction/signature compatibility vectors, not SAS transcript or SAS derivation vectors. SAS fixtures cannot be defined until the transcript and protocol decisions are approved. |
| Independent security review and candidate SAS transcript | Candidate transcript, confirmation semantics, nonce construction, and downgrade plan remain unreviewed. | No cryptographic ceremony changes were made. | **Open blocker.** Independent cryptographic/security review is still required before any SAS implementation or trust-writer integration. |

## Authenticated capability boundary

### Current behavior

The relay accepts `protocolFeatures` during channel join, stores them transiently on the socket, and returns/forwards peer features. This metadata can be stripped, replayed, misassociated, or fabricated by a relay. It is a best-effort compatibility hint only. Android's `peerSupportsFeature("join-introduction-v1")` and Web's equivalent must not be used as evidence of identity, trust, or SAS support.

The join introduction has a different purpose: after it is carried inside the existing encrypted conversation, its signature binds the current conversation ID, sender route, identity commitment, event ID, and timestamp to the sender Ed25519 key. It establishes a validated contact descriptor; it does not attest which verification capabilities the peer supports.

### Minimum future binding requirement

Before either client sends a SAS ceremony frame, each must authenticate a capability statement that binds:

- a dedicated capability domain and protocol/schema version;
- the exact supported verification protocol version(s) and required methods;
- the conversation ID and both current identity commitments/roles;
- the statement's sender and intended peer;
- a fresh negotiation identifier and bounded freshness/expiry;
- the exact mutually selected version, with no implicit fallback.

The statement must be signed by the current device Ed25519 identity, verified against the currently observed peer descriptor, and carried over the existing encrypted conversation. Both parties must authenticate the same selection. Relay metadata may be used to avoid unnecessary probes, but cannot authorize or downgrade the result. Unknown, stripped, mismatched, stale, or old-client responses leave SAS unavailable and preserve the explicit fingerprint flow.

The precise canonical bytes, negotiation rounds, and safe extension behavior for old decoders are **not defined here**. They must be reviewed alongside the final SAS transcript: an unauthenticated probe that old clients parse inconsistently can itself create a downgrade or compatibility hazard. No runtime capability mechanism was added in this phase.

## Join-introduction compatibility contract

`protocol-fixtures/v1/verification-readiness.json` is the deterministic contract for the current join-introduction signature format. The signed payload is compact UTF-8 JSON in the existing field order; the encrypted message content uses the current message-frame prefix followed by the `join-introduction-v1` magic and JSON. Implementations must verify the fixture and reject modified signed bytes. The four platform pairings refer to consuming the same exact public vector; they do not assert that SAS exists or that relay negotiation is authenticated.

The Android acceptance boundary is: encrypted transport acceptance → authenticated sender bundle → event and conversation/route checks → commitment recomputation → identity signature verification → atomic descriptor/session/dedup/replay commit → relay acknowledgement. The introduced descriptor remains unverified. A duplicate event is idempotently accepted without creating a message or changing trust.

## Security invariants retained

- Invitation/QR, route discovery, fingerprint receipt, successful join-introduction, first message, relay delivery, and capability hints never set `VERIFIED`.
- Existing identity generation, fingerprint derivation, Vodozemac message/session protocol, relay authorization, invitation format, calls, and message protocol are unchanged.
- Android Ed25519 verification is only a primitive exposed by the production crypto port. It is not a trust decision and does not mark contacts verified.
- No SAS frames, SAS values, ceremony state machine, verification QR, or new user-facing trust claims are introduced.
- Calls remain gated by the existing explicit Android `ContactVerificationState.VERIFIED` state.

## Validation still required

The shared vector has Rust-native, Web verifier, and Android/Kotlin coverage. The Android JNI instrumentation test must run on a disposable emulator/device. The Android Room acceptance test must also run on an emulator. Run Web/Jest, service tests/build, Android unit/instrumentation tests, and lint before merging. A fixed vector proves byte compatibility for that vector, not protocol safety, relay authentication, or complete live cross-platform reliability.

## Readiness decision

The Android verifier, current introduction parity, Android contact-setup prerequisite, and current-protocol fixtures are implementation work addressed by this phase. Authenticated capability negotiation, complete real-device interoperability, and independent review of the candidate SAS protocol remain open. **SAS is not implementation-ready.**
