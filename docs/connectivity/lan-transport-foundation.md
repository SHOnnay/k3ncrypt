# LAN and direct delivery foundation — isolated branch

**Status:** transport seams and deterministic policy tests only. Production messaging remains relay-only.

**Branch:** `connectivity/lan-transport-foundation`

**Base:** `main` at `66b0b5ca1fce0a2dd10075a563450bbd346a3677` (approved landing-page integration).
**SAS:** not implemented; not part of this work.

## Scope and authority

This change adds a relay-backed message-delivery boundary, a language-neutral stable envelope-identity fixture with Web and Android implementations, optional-path eligibility contracts, and a test-only in-process path. It does not implement network discovery, a LAN socket, WebRTC data-channel messaging, multipath, or path-to-path fallback. The branch-only connectivity documents below were inspected as constraints and evidence; they are not silently represented as merged `main` behavior or as one reconciled normative protocol.

The current `main` baseline is the authority for shipped code. The handoff and later connectivity specifications live on other branches. They provide useful security requirements but also record open decisions and conflicting baselines. No branch-only production code was copied wholesale.

| Source | Status and use in this work |
|---|---|
| `origin/connectivity/handoff-v2` — `docs/connectivity/HANDOFF.md` | Branch-only architecture/handoff; identifies delivery, identity, trust, and transport boundaries and explicitly gates real LAN work. |
| `origin/connectivity/delivery-foundation-blockers` — `foundation-blocker-resolution.md`, `specification-map.md` | Branch-only audit. Records failed Android instrumentation, unresolved dedupe horizon, source/spec conflicts, and relay ACK limits. |
| `origin/connectivity/transport-policy` — `transport-selection-v1.md`, ADRs 0001–0008 | Branch-only selection and delivery requirements. It requires relay compatibility, authenticated capability/admission, duplicate prevention, and prohibits treating submission as persistence. |
| `origin/connectivity/envelope-identity` — `envelope-identity-v1.md`, migration plan, ADR 0001 | Branch-only design for a conversation-scoped hash of exact ciphertext. The helper/fixture adopted here are local correlation only; durable migration and runtime dedupe adoption remain separate. |
| `origin/connectivity/lan-decision` — ADR 0009, `peer-admission-v1.md`, `path-eligibility-v1.md`, ADR 0005 | Branch-only direction: Android NSD endpoint hints plus a possible WebRTC DataChannel carrier, with production LAN still NO-GO. Peer admission transcript approval, offline freshness, carrier choice, and advertising policy remain open. |
| `origin/connectivity/lan-spike` — `spike-report.md` | Branch-only dummy-payload experiment. It did not test authenticated admission, real Android Wi-Fi, offline cold start, or production delivery. |

These sources differ in baseline, scope, and status. The blockers report says Android instrumentation failed on its closure branch; earlier reports record unit/fixture passes. Those claims apply only to the named refs and are not evidence from this branch. This branch makes no claim that Android is already validated for LAN.

## Current code boundaries

### Web and service

`ModernConversation` still owns identity/trust checks, Vodozemac session lifecycle, encryption/decryption, the encrypted outbox, inbound acceptance, and user-visible delivery callbacks. It now delegates already encrypted message submission and existing relay retry bookkeeping through `DeliveryCoordinator` and `RelayPathAdapter`. That coordinator is constructed with the existing relay only. Signaling, call lifecycle, mailbox replay, and relay presence remain on `TransportManager`/`SocketIoRelayTransport`.

The retry boundary resubmits the same saved envelope, keeps the existing five-second per-item throttle, and leaves work pending after failure. It does not retry through another path, create delivery states, change ACK interpretation, or move crypto/session ownership.

### Android

`AndroidMessagingRepository` continues to use `SocketRelay` directly for message delivery, call signaling, relay proofs, and mailbox behavior. `android/network` now defines an opaque-envelope path interface and fail-closed eligibility checklist for future adapters, but no coordinator or optional adapter is installed in the app. The current relay-specific `ProofCarrier` must not be passed to a LAN adapter.

### Existing private-network module

`service/src/privateNetwork` is not the chat-message LAN path. It models private-network membership and wraps a separate `CryptoSession` signaling-channel packet; its backend relay endpoint is separate. It does not discover peers on a LAN, carry the existing chat `EncryptedEnvelope` unchanged, or supply the unreviewed application-message admission protocol. This foundation leaves that module untouched.

## New testable contracts

- Delivery path adapters accept an already encrypted envelope only. They receive no plaintext, Vodozemac session, key, trust registry, or relay device-proof object.
- `DeliveryCoordinator` requires an encrypted message-capable relay and currently submits only through that adapter.
- Web and Android implement the same v1 envelope ID calculation: domain-separated SHA-256 over length-prefixed UTF-8 conversation ID and the exact validated inner `olmMessage` string. The shared fixture checks Unicode, conversation binding, and exact-ciphertext behavior.
- Optional-path eligibility is a pure checklist mirrored by TypeScript and Kotlin fixture tests. It requires a local feature flag, privacy permission, an explicitly verified unchanged contact, current trust freshness, authenticated capabilities and peer admission, stable envelope identity, pre-decrypt cross-path dedupe, a defined common dedupe horizon, crash-consistent acceptance, authenticated receipts, and compatible outbox completion.
- An in-process fake LAN adapter exercises the opaque-envelope interface with a dummy test payload. It has no sockets, discovery, real identities, cryptographic sessions, persistence, or production wiring.

The local flags `lanDelivery` and `directDelivery` are both `false`. A flag alone never authorizes a candidate. The optional-path checklist is not authentication: positive inputs must eventually be produced by reviewed runtime sources. No such source is installed on this branch.

## Envelope identity and duplicate limits

The helper computes a local correlation value; it is not a sender authenticator, trust signal, route authorization, or receipt. It is not added to the wire envelope and is not yet used to replace existing `modern-seen` records or Android's persisted serialized-envelope digest. No duplicate-retention policy is introduced.

**DEDUPE HORIZON = OPEN.** Existing sender outboxes can retry without an agreed maximum age; the relay mailbox's seven-day TTL is not a global reappearance limit; Web replay markers are count-capped while Android storage retention differs. Until expiry authority and post-expiry behavior are agreed, this branch cannot claim a bounded, common cross-platform duplicate window. The eligibility policy therefore blocks optional paths when the horizon is undefined.

## Delivery evidence and fallback

Existing relay ACK and mailbox behavior is unchanged. Transport submission, relay acceptance/storage, receiver-handler acceptance, peer persistence, and human display remain distinct. Relay or transport acknowledgements do not mean peer persistence. This branch adds no authenticated receipt and makes no peer-persistence promise.

When optional-path eligibility is absent, relay remains the path. There is no active LAN/direct attempt and therefore no new failure or retry state. Cross-path fallback after an attempted send is intentionally not implemented: the current Web outbox is completed by relay IDs, Android clears its pending row on relay acknowledgement, and ambiguous path outcomes could duplicate a ratchet envelope. Fallback after non-relay submission must wait for stable-ID dedupe before decrypt, a common retention contract, recoverable acceptance, authenticated receipts, and outbox completion support.

## Platform feasibility and security boundaries

- **Android ↔ Android:** a future native discovery adapter may use NSD only for an ephemeral untrusted endpoint hint. No NSD advertiser/scanner or connection adapter is implemented here. Admission must bind the expected verified device identities, conversation, fresh transcript, and live transport channel before sending an envelope.
- **Web ↔ Android:** ordinary browsers cannot use Android NSD or open arbitrary TCP listeners. WebRTC DataChannel is a possible future carrier, but existing voice-call WebRTC is separate and does not provide messaging admission or delivery semantics. No offline Web discovery is promised.
- **Relay fallback:** the current relay remains necessary for offline recipients. Existing relay authorization/proofs and mailbox semantics stay unchanged.
- **Verification:** a local path, endpoint hint, socket connection, capability claim, or successful adapter write cannot create or verify a contact. Only the existing explicit fingerprint verification flow changes trust. SAS remains out of scope and unimplemented.
- **Privacy:** discovery and ICE can expose local/public network addresses. A future privacy preference must be checked before discovery/address gathering, not merely before final selection. No address is persisted as identity data or logged by this foundation.
- **Mixed versions:** current relay `protocolFeatures` are peer-asserted metadata, not authenticated capability negotiation. Optional paths must stay disabled for missing, old, malformed, or unauthenticated capability data.

## Validation evidence and limits

This branch adds deterministic TypeScript/Kotlin tests for the shared envelope-ID fixture, optional-path eligibility fixture, relay submission/retry delegation, and a dummy in-process opaque-envelope adapter. These tests can establish algorithm parity and contract behavior. They cannot establish peer identity authentication, real path reachability, network privacy, delivery persistence, battery/background behavior, or real-device Android interoperability.

Android validation must use the repository's existing guarded disposable AVD. No test guard is changed. The second physical Android device is unavailable, so no two-phone LAN claim will be made. Emulator loopback/fake-path tests are not physical LAN validation.

## Gates before any runtime LAN/direct path

1. Reconcile and adopt exact normative spec revisions; close peer-admission transcript and authenticated capability/downgrade decisions with independent security review.
2. Add Android production signature verification/admission only through an independently reviewed implementation; do not infer it from test-only JCA verification.
3. Agree on a global envelope maximum age, expiry authority, and common Web/Android tombstone policy; integrate stable IDs and dedupe before decrypt, preserving legacy records.
4. Define how each path's attempts and completion map into durable Web/Android outboxes without mislabeling relay ACKs. If peer persistence is required, separately approve authenticated receipt wire semantics.
5. Pass current Android unit, instrumentation, restart, and shared-fixture tests on the guarded disposable AVD.
6. Demonstrate discovery, authenticated admission, encrypted-envelope exchange, teardown, restart, relay fallback, and duplicate/replay behavior on two real Android devices over Wi-Fi with Internet unavailable. Record browser constraints separately.
7. Only then add a default-off runtime adapter behind explicit local and per-contact privacy/trust eligibility, with rollback and mixed-version tests. Do not enable it by changing a flag alone.

## Instructions when a second Android phone is available

This branch does not include a usable LAN switch or adapter, so there is nothing safe to toggle on the current APK. When a reviewed runtime adapter is delivered on a later branch, install the same signed test build on two disposable phones, create separate identities, pair them through the existing invitation flow, explicitly verify both contacts, put both phones on the same Wi-Fi, and follow that build's documented opt-in. Repeat with Internet disabled before app launch; send both directions; then test peer disappearance, reconnect, app restart, duplicate/replay injection, privacy-off behavior, and relay fallback when Internet is restored. Capture Android logs without keys, ciphertext, invitation values, or network addresses. Do not treat successful setup or a connected indicator as trust or persistence proof.
