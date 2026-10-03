# K3NCRYPT master connectivity handoff

**Version:** 2
**Purpose:** State of the repository and gated plan for future connectivity work. This is a documentation-only update on `connectivity/handoff-v2`; it does not change production behavior.
**Authoritative baseline inspected:** `origin/main` at `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f` (refreshed from origin on 2026-10-03).
**Branch:** `connectivity/handoff-v2`.

## Read this first: authority and status terms

The current `main` baseline is the commit above. It does not contain `docs/connectivity/`, the delivery-foundation implementation, the DeliveryCoordinator implementation, the Android verification-readiness work, or the LAN experiment. The earlier approved handoff and later reports/specifications are present on other branches. Their existence, approval wording, test results, and branch names do not make them part of `main` or authorize behavior changes.

Use these labels literally:

- **IMPLEMENTED IN MAIN** — present in the inspected `origin/main` tree and used by the K3NCRYPT application.
- **BRANCH-ONLY** — present only on a named feature/specification branch; not shipped by the inspected main baseline.
- **VALIDATED** — a named test or experiment produced the stated evidence. This does not imply production rollout or broader guarantees.
- **BLOCKED** — required evidence or prerequisite failed or is absent.
- **OPEN** — no reviewed decision or bounded evidence closes the question.
- **PLANNED** — product or architecture intent only; not implemented.
- **DECISION** — an explicit boundary chosen for this handoff, not a new wire protocol.

When branch documents conflict, preserve the conflict and source revisions. Do not silently promote one branch's document to governing authority. The branch-only `docs/connectivity/specification-map.md` at `connectivity/delivery-foundation-blockers` (`7a823b6a0a971d4c90e9f91ad7c001e87b9b2bb2`) catalogs the wider document set and identified conflicts; it is not in main.

## Current production architecture

**PRODUCTION TRANSPORT = RELAY ONLY.** The application has no production LAN, direct Internet message transport, multipath selection, or production discovery path. The relay remains necessary for recipients who are offline. Voice-call signaling also uses the existing relay; that is not a messaging DataChannel transport.

The desired architecture separates conversation ownership, identity/trust, sessions, delivery coordination, connectivity policy, and path adapters. That separation is not yet the main runtime architecture. In main, `ModernConversation` owns Web session/send/retry orchestration and uses the existing single relay transport. Android's `AndroidMessagingRepository` coordinates its messaging path and uses `SocketRelay`. A `DeliveryCoordinator` and relay-path wrapper exist only on feature branches and are not wired into the main app.

```text
WEB — IMPLEMENTED IN MAIN
ChatContext
  → ModernConversation (trust/session checks, Vodozemac encrypt/decrypt, retry)
  → secure storage and encrypted outbox
  → single active relay transport / SocketIoRelayTransport
  → backend relay and existing mailbox

ANDROID — IMPLEMENTED IN MAIN
MainActivity / AndroidMessagingRepository
  → existing identity/trust checks and native Vodozemac API
  → Room-backed account/session/outbox/message state
  → SocketRelay
  → backend relay and existing mailbox
```

For both platforms, incoming envelopes go through the existing relay authorization/routing and client validation before decrypt/acceptance. Duplicate checks and persistence are platform-specific. A receiver acknowledgement is sent only after the current receiver callback reports acceptance. On main, Web's session advancement, product-message persistence, and replay-marker write are not one atomic transaction; Android's receive path uses its existing Room transaction to commit the account/session/message/digest records before it reports acceptance. Do not describe the Web main behavior as crash-atomic.

The target shape is:

```text
Conversation owner → trust/session → persist encrypted envelope
  → delivery coordinator → connectivity policy → selected path adapter
  → relay (only active production adapter today)
  → receiver validation/decryption → durable acceptance → acknowledgement
```

The coordinator/policy/adapter parts of that target are **BRANCH-ONLY**. Do not describe them as active main behavior. Discovery is an untrusted route hint, not identity, admission, or trust. No discovered path may silently become eligible.

### Main baseline versus feature-branch evidence

| Work | State relative to main | Evidence / scope |
|---|---|---|
| Existing Vodozemac encrypted messaging and relay/mailbox path | **IMPLEMENTED IN MAIN** | `ModernConversation`, `SocketIoRelayTransport`, Android `AndroidMessagingRepository`/`SocketRelay`, backend relay handlers. Existing session, relay authorization, and message format remain the production boundary. |
| Stage 0 contract hardening | **BRANCH-ONLY; VALIDATED on its branch** | `connectivity/stage0-contract-hardening`: `dc54ca1`, `f123519`. Narrow Web changes require a retained identity commitment before existing-session contact repair and fence stale tab lease heartbeat/queued operations. Added characterization/regression tests. None of these changes are in main. |
| Web outbox recovery | **BRANCH-ONLY; VALIDATED on its branch** | `connectivity/web-outbox-recovery` at `8f9ad2b`. Uses Web secure-storage/IndexedDB transactions to recover outbound session state and exact queued ciphertext after reload. Does not by itself close the separate sender-history gap later addressed by closure. |
| Delivery boundary and stable envelope identity | **BRANCH-ONLY; VALIDATED in recorded TypeScript/Kotlin fixture tests** | `connectivity/delivery-foundation`: `2632bc0`, `bff1f33`, `4e80615`, `77caacb`. Adds relay-only delivery contracts/adapter, M1 local envelope identity, and Web atomic inbound acceptance. The relay adapter is not the active main app path. |
| Delivery review and closure | **BRANCH-ONLY; evidence is bounded** | `connectivity/delivery-foundation-review` at `35afc15`; `connectivity/delivery-foundation-closure` at `8c4afe8`. Closure adds Web sender-history recovery with session/outbox persistence and records transactional acceptance/retry evidence. Browser reload and deterministic failure injection are not physical crash proof. |
| Blocker review | **BRANCH-ONLY; current blockers remain** | `connectivity/delivery-foundation-blockers` at `7a823b6`. Android unit tests passed on the closure branch, but all five disposable-AVD instrumentation tests failed; see Android section. Dedupe horizon remains open. |
| DeliveryCoordinator | **BRANCH-ONLY** | `connectivity/delivery-coordinator` at `f34b981`. Coordinator selects relay only in that implementation. It is not wired into the main application. |
| Transport policy and LAN architecture decisions | **BRANCH-ONLY; specification/evidence only** | `connectivity/transport-policy` at `a80672f`; `connectivity/lan-decision` at `bf71235`. They do not enable a production path. |
| Android trust-state and verification readiness | **BRANCH-ONLY** | `invitation-redesign/trust-state` at `ed02b49` and `verification/readiness` at `11b4517`. Readiness adds Android identity-signature verification through the native crypto API and Android join-introduction parity; it does not implement SAS or automatically verify contacts. Not in main. |
| LAN dummy experiment | **BRANCH-ONLY experiment** | `connectivity/lan-spike` at `9658bbf`. Isolated experiment code/report only; no production packages or real identities. |

These references are provenance, not a changelog or an assertion that all work is ready to merge. The branch reports describe different baselines and evidence levels; revalidate source and tests before adopting them.

## Envelope identity and duplicate prevention

### Main

**IMPLEMENTED IN MAIN:** Web uses its legacy digest of the serialized envelope for replay checks, with a 1,024-entry count cap. Android's current receiver stores a digest of the serialized envelope in its Room acceptance state. There is no shared M1 conversation-scoped envelope ID in main. These mechanisms do not establish a time-bounded cross-path deduplication contract.

### Branch-only M1 work

The delivery-foundation branch implements M1 in TypeScript and Kotlin as local correlation/dedup metadata: a domain-separated SHA-256 over length-prefixed UTF-8 conversation ID and the exact validated inner Olm ciphertext. It is intended to identify the same ciphertext despite JSON key ordering/spacing differences, support duplicate prevention before decrypt, and later correlate relay/LAN/direct copies and receipts. It is not sender authentication, a trust signal, or relay metadata.

The branch includes a shared fixture consumed by TypeScript and Kotlin. Recorded evidence includes a passing TypeScript fixture test in the closure validation and a passing Kotlin fixture test in the blocker branch's unit run. This is **branch-only** implementation/evidence, not main production behavior. The blocker branch's Android instrumentation run failed, so there is no successful end-to-end Android device/restart parity evidence. No Rust M1 implementation/fixture consumer was found; do not claim three-language parity.

M1 answers *which envelope bytes are the same*. It does not answer how long the identity must be retained, authenticate a sender, prove receipt, or guarantee that a cross-path duplicate will still be recognized after local marker eviction.

## Crash and recovery evidence

### Main behavior

The main baseline has a Web outbound crash window: ratchet/session persistence can complete before the exact encrypted envelope is written to the outbox. If that later write fails or the page stops in between, the advanced session can remain without the just-created ciphertext. On inbound Web messages, decrypt/session advancement, consumer persistence, and replay-marker persistence are ordered but not atomic together on main.

Android main has Room transaction boundaries for its outbound and inbound state. This source-level fact is not equivalent to a successful device/instrumentation run or a physical-crash guarantee.

### Branch-only recovery evidence

The Web outbox-recovery and delivery-foundation branches add transactional recovery boundaries. Closure records sender message history together with session/outbox updates; Web inbound acceptance commits session, message, and replay state through the secure storage transaction. The reports include real Vodozemac WASM/IndexedDB tests and deterministic transaction-abort injection. Browser `page.reload()` exercises persisted reload/recovery, but is not an OS process kill, browser data loss, or power-loss test.

Android code/tests use Room transaction and database close/reopen coverage. The later blocker run on `connectivity/delivery-foundation-closure` passed unit tests but failed its instrumentation suite. It therefore does not establish successful process-restart behavior on Android. No physical-device crash test was demonstrated.

Keep these evidence categories distinct:

| Evidence | What it supports | What it does not support |
|---|---|---|
| Deterministic failure injection | Behavior at an injected storage failure/transaction abort | OS scheduling, actual process death, device power loss |
| Browser reload/restart | Reloading app code and restoring from browser storage | OS crash/power loss or physical storage durability |
| Room close/reopen/unit test | Database transaction logic and reopen behavior in the test environment | Passing instrumentation on a device, force-stop/redelivery, or physical crash guarantees |
| Physical-device crash test | Only the exact tested device/build/failure boundary | A universal durability guarantee |

No report may claim physical crash guarantees without a matching physical-device test.

## Retry and deduplication horizon

**DEDUPE HORIZON = OPEN.** The maximum legitimate time an identical encrypted envelope can reappear is not derivable from the current protocol or implementation evidence.

- **Web main:** the outbox retries pending exact ciphertext periodically while connected and after reconnect; the active retry timer is 5 seconds. Main does not define a maximum envelope age. Its replay list is bounded by count, not elapsed time.
- **Android main:** retry submits the saved ciphertext on reconnect. A per-attempt relay acknowledgement wait is 20 seconds; timeout is not an overall retry expiration. The sender has no shared maximum envelope age.
- **Relay:** the offline mailbox entry TTL is 7 days, with a 64-item per-mailbox capacity. Relay duplicate insertion suppression is tied to the mailbox record and ends when the record expires or is deleted. Live/replay waits and claim leases are per-attempt controls, not a maximum lifetime for the sender's outbox.
- **Restart/offline:** persisted sender outboxes can survive restart. No globally enforced expiry for pending ciphertext is defined. An offline sender can reconnect later and retry.
- **Future paths:** production has no overlapping message paths today. Future LAN/direct copies have no approved lifetime/expiry contract, and could overlap with or outlive a relay mailbox record.
- **Branch-only retention mismatch:** closure's Web M1 replay markers are count-capped at 1,024; Android M1 accepted IDs have no observed per-record time/count pruning policy. There is no common elapsed-time rule.

Therefore the maximum legitimate envelope reappearance is **unbounded by the current contract**. Do not substitute the relay's seven-day mailbox TTL, a retry interval, or a convenient tombstone duration for an end-to-end lifetime. Before multipath, the protocol owner must define the envelope's maximum retry/delivery/copy age from a named event, expiry authority, clock behavior, old-client behavior, and Web/Android/future-path tombstone cleanup semantics. Then derive, implement, and test a common retention rule. Until then, M1 cannot safely justify finite dedupe retention.

## Acknowledgements and receipt boundary

**DECISION: “Relay/transport acknowledgements do not mean peer persistence.”** The current product has no sender-verifiable authenticated peer-persistence receipt requirement or protocol. Do not add or imply one as part of the delivery foundation.

| Boundary | Current meaning | Not established |
|---|---|---|
| Transport submitted/accepted | The local adapter completed the send operation it exposes; timeout may leave the outcome unknown. | Durable relay storage, recipient acceptance, or trust. |
| Relay accepted | The relay returned a positive `chat-message` acknowledgement. `stored: true`, when present, is the relay's assertion that it stored an opaque mailbox item. | Peer receipt, decrypt, persistence, or display; a malicious relay can lie about relay-controlled state. |
| Recipient handler accepted | In normal operation, the relay observes the recipient's `received` response after its application handler returns accepted; mailbox replay is removed following that acknowledgement. Sender-visible correlation is still relay-controlled. | A cryptographically authenticated peer statement independently verifiable by the sender. |
| Recipient persisted | The receiver's local acceptance boundary. Android main writes the receive transaction before accepting; main Web's message/session/replay writes are ordered but not one atomic transaction. | A sender-verifiable cryptographic receipt that the recipient durably persisted the message. |
| Displayed/read | No read/display receipt exists. | Human display or reading. |

The current main UI has “Delivered” / “Message delivered” wording driven by relay-controlled events. A correction to relay-attributed copy exists on the closure branch, not in main. Treat the existing UI event as relay evidence, not as a promise of peer persistence. If product requirements later demand peer-persistence proof, stop at protocol design and independent security review of a receipt bound to the conversation, envelope, sender/receiver identity, freshness, replay state, and durable acceptance. Do not invent its cryptographic construction here.

## Android state and validation

### Main baseline

Android uses `AndroidMessagingRepository`, the existing native Vodozemac bridge, Room-backed state, and `SocketRelay`. Main does not include the later explicit Android contact verification-state separation or join-introduction parity. The Stage 0 audit on its branch found main's saved-contact label still derived from route/fingerprint presence, and the Android join UI couples route setup with entering the peer fingerprint. Do not treat route, fingerprint presence, join, or invitation possession as proof of explicit verification.

### Branch-only verification/readiness work

`verification/readiness` at `11b4517` documents and implements prerequisite work outside main: a bounded native identity-signature verification API, Android join-introduction-v1 parity and descriptor validation, explicit unverified contact setup, and shared current-protocol fixtures. The signature API is not a trust writer. Join/QR/introduction does not set `VERIFIED`; existing explicit fingerprint comparison remains the verification ceremony. Authenticated capability negotiation remains open. The verification-readiness document states SAS is not implemented and not implementation-ready pending protocol decisions and independent security review.

Do not claim those Android changes shipped on main. Do not infer that instrumentation passed from source, a build, fixture tests, or a release artifact.

### Android validation evidence and requirement

The blocker-resolution run found an SDK and a disposable AVD and ran Android tests against `connectivity/delivery-foundation-closure`:

- **VALIDATED, unit scope only:** `./gradlew test` completed with 121 executions, 0 failures/errors, 0 skipped across Debug/Release reports. The Kotlin M1 shared TypeScript fixture test passed.
- **BLOCKED, instrumentation:** `connectedDebugAndroidTest` ran on the disposable `k3ncrypt-instrumentation-disposable` AVD, built/installed test APKs, then all five app instrumentation tests failed. Four failed opening test SQLite databases because `/data/user/0/com.k3ncrypt.app/databases` did not exist; `SessionRenewalPersistenceTest` failed Android Keystore key generation. No successful instrumentation validation is claimed.
- These results concern the closure branch's validation run, not the Android verification-readiness branch or main. They do not establish real-device pairing, force-stop/restart delivery, or production Android readiness.

Android instrumentation must use only the disposable AVD guarded by the repository's existing Android test setup. Never weaken, bypass, or edit the guard to obtain a green result. The persistent beta AVD is not a test target.

## Invitation and verification boundary

Keep these meanings separate:

- **Invitation or QR invitation = contact/setup transport.** It may convey the existing invitation data. Scanning or importing it is not proof of identity.
- **QR invitation ≠ verification proof.** It never marks a contact verified, pins a changed identity as trusted, or replaces independent comparison.
- **Explicit verification remains separate and user-controlled.** The existing manual fingerprint comparison is the current verification method where implemented. Android's improved explicit state and join setup are branch-only, not main.
- **SAS = NOT IMPLEMENTED and NOT IMPLEMENTATION-READY.** Readiness prerequisites added on a branch do not approve a SAS transcript. Authenticated capability negotiation, ceremony transcript decisions, and independent cryptographic/security review remain open.

The QR/SAS design materials on `invitation-redesign/*` and `verification/readiness` are branch-only. Do not describe QR invitations, QR verification ceremonies, or SAS support as present in main. Device names/nicknames, routes, relay delivery, and calls are not identity proof.

## LAN experiment and feasibility gate

### Isolated spike — experiment only

The `connectivity/lan-spike` experiment/report (`9658bbf`) imports no production packages and uses only fixed `dummy-lan-probe` payloads and test identities. It is not contact admission, E2EE messaging, persistent delivery, or a receipt.

Recorded single-run measurements:

- Same-Mac multicast beacon discovery: 1,004.01 ms. One hundred sequential same-host dummy TCP probes acknowledged 100/100; median 0.59 ms, p95 1.15 ms, min 0.46 ms, max 4.96 ms.
- Android 15 disposable `sdk_gphone64_arm64` emulator to desktop via a manually supplied host address: 10/10 dummy probes acknowledged; median 556.08 ms, p95 708.93 ms. This is virtualized emulator networking, not a physical-LAN latency estimate.
- With the desktop listener stopped, emulator probe succeeded 0/10 and reported failure. The experiment did not test relay fallback.
- The experimental multicast beacons and TCP acknowledgements were unauthenticated and forgeable. The probe had bounded in-memory duplicate recognition only; no durable dedupe or delivery guarantee.
- Same-Mac measurements do not establish Wi-Fi behavior. No real Android-to-Android Wi-Fi, no Internet-off cold start, no browser discovery, no WebRTC DataChannel, no authenticated peer admission, and no production interoperability were tested.

The later `connectivity/lan-decision` materials choose a hybrid discovery/carrier direction for further validation only: Android NSD/mDNS as an untrusted endpoint hint and WebRTC DataChannel as a candidate common carrier, with plain TCP remaining an experiment unless separately secured and reviewed. D13 (final carrier), D14 (advertising default), and M6 (offline trust freshness) remain open. ADR 0009 explicitly says production LAN is NO-GO. This is not authorization to implement or enable it.

### Required feasibility demonstration — NOT DONE

Before production LAN integration, a later, separately scoped feasibility task must demonstrate, without enabling production behavior:

1. Real Android devices on real Wi-Fi.
2. Internet unavailable before connection setup.
3. Local discovery with untrusted hints only.
4. Authenticated peer admission bound to expected verified device identities and conversation.
5. Exchange of already encrypted envelopes only.
6. Restart/offline behavior and teardown.
7. Relay fallback without changing existing authorization.
8. Duplicate prevention under delayed/overlapping delivery.
9. Web/Android interoperability evidence, with browser constraints recorded rather than assumed.
10. Security, privacy, permissions, battery, and resource review.

Discovery ≠ authentication; connection ≠ trust. No trust, session, identity, or verification changes may be caused by a path event.

## Product roadmap outside the connectivity foundation

**PLANNED, NOT IMPLEMENTED BY THIS FOUNDATION:**

- File sharing.
- Notifications.
- Video calling.

They must be considered in future module boundaries and resource/lifecycle design, but they are not delivery-coordinator features and do not authorize changes to encryption, trust, relay, or call behavior in this phase. Existing voice calling is distinct from planned video calling.

## Gates before production LAN

All gates are required; a passing test in one area does not waive another.

| Gate | Required evidence | Current state |
|---|---|---|
| **1 — Delivery foundation accepted** | Review and adopt the relay-only delivery boundary, Web sender-history/inbound recovery, M1 identity behavior, ACK boundary, rollback, and their regression evidence into the authoritative implementation baseline. Coordinator wiring, if adopted, must remain relay-only. | **BLOCKED** — improvements are branch-only; do not claim main contains them. |
| **2 — Android validation complete** | Kotlin unit/messaging/persistence/shared-fixture tests and all required instrumentation tests pass on the guarded disposable AVD; separately plan physical-device evidence where required. | **BLOCKED** — 121 unit executions passed on closure; all five instrumentation tests failed. |
| **3 — Dedupe horizon defined and tested** | Owner-approved maximum reappearance age and expiry semantics, plus Web/Android retention/cleanup and boundary tests covering outbox, relay, offline, restart, and future copies. | **OPEN** — no finite shared horizon can be derived. |
| **4 — Cross-platform envelope fixtures verified** | Shared M1 fixtures execute on every supported implementation; restart/duplicate behavior and platform retention are compatible. State exactly which runtimes were executed. | **PARTIAL / BLOCKED for LAN** — TypeScript and Kotlin fixture tests passed on branches; Android instrumentation failed; no Rust M1 consumer exists. |
| **5 — Connectivity specifications reconciled** | Adopt immutable normative revisions for delivery states, M1, receipts, capabilities/downgrade, peer admission, freshness, and transport selection; explicitly resolve contradictions and owner decisions. | **BLOCKED** — specifications remain distributed across unmerged branches; D-R/M6/D13/D14 are not fully resolved. |
| **6 — LAN security/peer-admission protocol reviewed** | Reviewed versioned admission/transcript, channel binding, capability/downgrade, freshness/replay, privacy, old-client, and failure rules with shared fixtures. | **OPEN** — no production admission protocol is approved. |
| **7 — Real-device LAN feasibility demonstrated** | Complete the evidence list above on real devices and supported Web/Android configurations with Internet disabled and relay fallback tested. | **BLOCKED** — only isolated dummy spike measurements exist. |

**PRODUCTION LAN remains NO-GO until all seven gates pass and a separate implementation review authorizes a default-off production adapter.** Direct Internet transport and multipath need their own gated decisions; this handoff does not approve them.

## Exact next engineering step

**DECISION:** Start with Android instrumentation-failure triage on a separate branch, using only `k3ncrypt-instrumentation-disposable`. Preserve the guard. Determine whether the missing Room database directory and emulator Keystore failure are test-fixture issues or application issues; fix only after that diagnosis and rerun the same tests. Do not infer Android validation from the 121 passing unit executions.

Next, obtain an owner decision for the maximum envelope reappearance age and post-expiry behavior. In parallel, identify immutable specification revisions and explicitly reconcile their conflicts before merging any connectivity implementation. Keep `main` relay-only while those gates are closed. Do not begin LAN feasibility implementation, multipath, or direct transport until the relevant review gates pass.

## Final state table

| AREA | STATE | EVIDENCE | NEXT GATE |
|---|---|---|---|
| Authoritative baseline | **IMPLEMENTED IN MAIN** | `origin/main` is `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f`; no connectivity handoff/files in that tree before this branch. | Keep branch provenance explicit; review handoff before any adoption. |
| Production messaging path | **IMPLEMENTED IN MAIN — RELAY ONLY** | Web `ModernConversation` → single `SocketIoRelayTransport`; Android `AndroidMessagingRepository` → `SocketRelay`; no production LAN/direct path. | Gate 1. |
| Delivery coordinator/path policy | **BRANCH-ONLY** | Relay-only coordinator at `connectivity/delivery-coordinator` `f34b981`; not wired into main. | Gate 1. |
| Stage 0 hardening | **BRANCH-ONLY; VALIDATED on branch** | `connectivity/stage0-contract-hardening` `dc54ca1`/`f123519`; commitment and browser ownership regressions. | Review/adopt separately; Gate 1. |
| Web outbox/acceptance recovery | **BRANCH-ONLY; VALIDATED with limits** | `8f9ad2b` plus delivery-foundation and closure reports; deterministic IndexedDB fault injection and reload, no physical crash proof. | Gate 1. |
| Stable envelope identity | **BRANCH-ONLY; VALIDATED for TS/Kotlin fixtures** | M1 code/fixture in delivery-foundation branch; Kotlin unit fixture passed on blocker run; Android instrumentation failed. | Gates 3–4. |
| Dedupe horizon | **OPEN** | Outbox age is unbounded; relay mailbox TTL is 7 days; retention policies differ; future path-copy expiry undefined. | Gate 3. |
| ACK/receipt semantics | **DECISION; OPEN for future peer receipts** | “Relay/transport acknowledgements do not mean peer persistence.” No authenticated peer-persistence or read receipt. | Gate 5; protocol review only if product later requires it. |
| Android verification readiness | **BRANCH-ONLY; INSTRUMENTATION BLOCKED** | `verification/readiness` `11b4517`; closure-based unit run passed, five disposable-AVD instrumentation tests failed. | Gate 2; readiness branch requires its own validation. |
| Invitation/verification | **MAIN behavior plus branch-only readiness** | Invitation does not prove identity; Android explicit-state/join-introduction work is not in main. SAS remains not implemented/not ready. | Independent verification-protocol review before any SAS work. |
| LAN spike | **BRANCH-ONLY; VALIDATED EXPERIMENT ONLY** | Dummy multicast/TCP results; unauthenticated, no real Wi-Fi or delivery guarantee. | Gate 7 after Gates 1–6. |
| Production LAN | **BLOCKED / NO-GO** | Android instrumentation, dedupe, spec reconciliation, peer-admission, and real-device evidence remain incomplete. | All seven gates. |
| File sharing / notifications / video calling | **PLANNED** | Product roadmap only; outside connectivity foundation. | Separate product and architecture tasks. |
