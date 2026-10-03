# K3NCRYPT delivery foundation closure

Branch: `connectivity/delivery-foundation-closure`

Review base: `connectivity/delivery-foundation-review` at `35afc151357ba08edddcb99b0a44abf1eee10ab2`

Scope: close or characterize the delivery-foundation review gates. No LAN, direct, multipath, SAS, or receipt protocol was implemented.

## 1. Closure summary — PARTIAL

The Web sender-history recovery gap is closed for new application sends at the existing local-acceptance boundary. Plaintext sender history, the advanced Vodozemac session, and the exact encrypted outbox envelope are committed together in the existing encrypted secure-record transaction. When the existing relay `delivered` event clears an outbox entry, its local history status is updated in the same compare-and-swap transaction. Browser reload and deterministic transaction-abort tests exercise these boundaries; they do not establish physical power-loss safety.

The remaining delivery foundation is not ready for another path. A safe shared deduplication horizon cannot be derived; no recipient-authenticated envelope-bound receipt exists; Android tests could not run without an SDK/AVD; and full TypeScript/Kotlin/Rust fixture parity was not executable or implemented. Normative design documents were located on sibling branches and are referenced below, but are not part of this branch.

## 2. Web sender-history recovery — PASS

Before this closure, `ModernConversation` atomically saved the advanced session and exact encrypted envelope to `modern-outbox`, then submitted it. `ChatContext.sendMessage()` added the plaintext sender row to React state after `sendWithReceipt()` returned, and a later effect persisted the row. A reload between the outbox/session commit and that later history write could leave retryable ciphertext without recoverable plaintext history. If relay completion then removed the outbox row, the local plaintext copy could not be reconstructed from ciphertext.

`sendWithReceipt()` now accepts a caller-owned history-update builder. `ChatContext` uses the service-generated client ID to prepare the existing `product-messages` encrypted record update. `ModernConversation` includes it in the same atomic record transaction as the advanced session, exact ciphertext outbox item, and any existing renewal correlation metadata. The service remains independent of product-store types. Sending/recovery continues to reuse the saved ciphertext; no message or wire envelope format changed.

On the existing relay completion callback, the history delivery update and matching outbox removal are committed together. The history update is monotonic and only changes an existing outgoing row. If its CAS fails, the outbox remains available for retry. Existing `writeMessages()` merging prevents a stale React projection from regressing a stronger saved delivery state. A stable local client ID prevents duplicate history rows for the same send.

Evidence: service tests assert the session, ciphertext outbox and plaintext row are committed as companion records; an injected history CAS failure leaves the prior session/outbox/history intact; delivery update tests assert history advancement and outbox removal share a CAS. Browser E2E uses the real Vodozemac WASM runtime and encrypted IndexedDB, reloads twice, and verifies the same envelope and one history row survive; an injected IndexedDB abort rolls back the transaction. These tests demonstrate application reload and deterministic storage failure behavior, not OS process termination, power loss, or hardware-level durability.

Limits: the pre-existing product-history cap remains 2,000 rows. A pre-fix outbox item that already lacks plaintext history cannot be reconstructed from its ciphertext. The guarantee here is that a newly accepted send does not enter the former immediate crash window; it is not an infinite history-retention promise.

## 3. Dedupe horizon — OPEN

The current implementations do not establish a common elapsed-time horizon:

- Web stores both legacy JSON digests and stable M1 IDs in bounded lists of at most 1,024 entries. This is count-bounded, not time-bounded; an older marker is evicted as new messages arrive.
- Android stores inbound digests and M1 IDs in Room without an observed per-message age/count pruning policy. This is effectively unbounded until store reset and differs from Web retention.
- The relay mailbox has a seven-day TTL and a 64-message per-mailbox limit. Its duplicate mailbox insertion suppression lasts only while the associated record exists; expiry/deletion permits a later retry to be stored again.
- Web retries the exact saved ciphertext periodically while the conversation is active and has no finite maximum retry age in the reviewed path. Android retries persisted outbox ciphertext after reconnection without a shared maximum age.
- A future path copy could remain offline longer than the relay TTL. No maximum path-copy lifetime or clock/expiry contract exists.

The stable M1 value is `SHA-256(UTF8("k3ncrypt/envelope-id/v1") || u32be(len(UTF8(conversationId))) || UTF8(conversationId) || u32be(len(UTF8(olmMessage))) || UTF8(olmMessage))`, represented as `v1:` plus lowercase hex. It identifies a conversation-scoped exact ciphertext locally. It is not sent to the relay and does not authenticate a sender or receipt. The shared fixture SHA-256 is `dc6751fcd712acf448df56bd3af86b30b2a056c7f1d98aae22a65750dc6da08a`.

No retention number is selected or implemented. The missing protocol facts are a hard upper bound for sender retries, relay/offline copies, and any future path-copy lifetime, plus a cross-platform compaction/tombstone rule and behavior after expiry. Until those are decided and tested at the boundary, duplicate suppression across arbitrarily delayed paths is not guaranteed. No multipath use is authorized.

## 4. Receipt semantics — PARTIAL

Current positive signals mean:

| Signal | What it establishes | What it does not establish |
| --- | --- | --- |
| `chat-message` Socket.IO ACK | The relay accepted the send operation. If the receiver was offline or did not acknowledge promptly, the relay returns success only after opaque-envelope mailbox persistence. If a live receiver handler answered `accepted: true`, the relay returns success after observing that response. | It is not a cryptographically authenticated recipient receipt. The common client result omits the `stored` distinction. A malicious relay can lie about its own result. |
| Receiver handler `{accepted: true}` / `received` event | Under the normal client implementation, `ModernConversation.receive()` returned after durable inbound acceptance or duplicate recognition; `received` informs the relay of that result. | The message is not accompanied by a recipient signature/MAC that the sender can independently verify. A duplicate acknowledgment does not mean another message was stored. |
| Relay `delivered` event | The relay reports that a live receiver handler accepted the envelope or that mailbox replay was acknowledged; it correlates the report using the relay's delivery ID. | The event is relay-controlled, not cryptographically bound to the stable envelope ID, conversation, and recipient identity. It is not proof against a malicious relay of peer persistence. |
| `mailbox-replay` ACK `{status: "accepted"}` | The relay accepted/completed the replay request handler. | It does not assert that each replayed envelope was accepted or persisted by the recipient. |
| Android `sendEnvelopeAwait()` result | The relay returned a positive send ACK. Android then removes the outbox entry and updates local history. | It does not uniformly mean the peer has persisted the message; in particular the relay may have acknowledged mailbox storage. |

There is no separate authenticated `peer-persisted` receipt today. The Web UI now says “Relay acknowledged”; Android says “Relay accepted”/“Relay acknowledged”; the SDK event documentation no longer describes the relay event as a peer-authenticated success. These copy changes do not alter the wire protocol, ACK payloads, retry timing, or state transitions. They prevent the current UI/docs from claiming more than the relay reports.

An authenticated receipt would require a reviewed protocol decision for recipient identity binding, conversation binding, stable envelope binding, freshness/nonces, replay/idempotency, signature/MAC verification against already authenticated peer identity, and durable acceptance semantics. The local M1 ID alone is not a receipt. No construction is added here. Relay-only operation may use relay ACKs for relay queue/outbox management, but must not present them as authenticated peer-persistence proof or use them to authorize multipath completion.

## 5. Android validation — BLOCKED

Environment checks found `ANDROID_HOME` and `ANDROID_SDK_ROOT` unset, no `$HOME/Library/Android/sdk`, no `android/local.properties`, and no `adb` or `emulator` executable. There is no disposable AVD available. Android unit, Room/messaging/persistence, Kotlin fixture, restart, and instrumentation tests therefore were not run. No persistent beta emulator was touched, and no result is inferred from source inspection.

The source path reviewed stores outbound session, exact ciphertext, outbox identity, and sender history through the existing Room transaction; inbound `InboundMessageProcessor` uses the existing transactional persistence boundary before it reports acceptance. These are code observations only until Android tests/build and disposable-device restart tests run. The Android message-status copy changed in this branch but could not be compiled in this environment.

## 6. Cross-platform fixtures — PARTIAL

- TypeScript Jest executes the shared `protocol-fixtures/v1/envelope-identity.json` through `service/src/delivery/envelopeIdentity.test.ts`; it also executes the shared encoding, control-signature, encrypted-envelope, device-proof/lifecycle fixtures through backend tests.
- Kotlin has tests consuming the shared envelope-identity fixture (`android/messaging/.../EnvelopeIdentityTest.kt`), identity-fingerprint fixture (`android/crypto/.../IdentityFingerprintTest.kt`), and encoding/signature/device lifecycle fixtures (`android/network/.../SharedProtocolFixturesTest.kt`). They could not be compiled or run because Android SDK/Gradle platform dependencies are unavailable.
- Both TypeScript and Kotlin source implement the same M1 domain-separated, length-prefixed UTF-8 hash by inspection. The shared vector is present and TypeScript passes, but executable byte-for-byte Kotlin parity is not demonstrated here.
- The Rust crates (`crypto-wasm` and `android/native-crypto`) provide Vodozemac bindings/primitives, but no stable M1 envelope-identity implementation or consumer of `envelope-identity.json` was found. Therefore TypeScript↔Rust or Kotlin↔Rust M1 parity cannot be tested or claimed.
- Web has `join-introduction-v1` support in `service/src/crypto/modernConversation.ts`; no Android implementation or shared cross-platform introduction fixture was found. Existing signature/fingerprint fixtures are separate and do not establish introduction parity.
- SAS is not implemented and no SAS fixtures were created.

Result: relevant TypeScript fixtures executed; cross-platform fixture execution is incomplete. No byte-for-byte three-language compatibility claim is made.

## 7. Documentation traceability — PARTIAL

The review's missing connectivity documents were searched in the current branch and all local branch refs. Current branch sources include `docs/connectivity/delivery-foundation-review.md`, `delivery-foundation-report.md`, `web-outbox-recovery.md`, and `adr/0002-crash-consistent-acceptance.md`.

Related documents were found on sibling branches, not included in this branch:

- `connectivity/spec`: `docs/connectivity/HANDOFF.md`, `current-behavior.md`, `envelope-identity-v1.md`, `receipts-v1.md`, `path-eligibility-v1.md`, `transport-control-v1.md`, and connectivity ADR/threat/test-matrix material.
- `connectivity/delivery-state`: `docs/connectivity/delivery-state-v1.md` and delivery-state decisions.
- `connectivity/crash-validation`: `docs/connectivity/crash-acceptance-v1.md`, `crash-validation-report.md`, and crash validation plan/ADR material.
- `connectivity/transport-policy`: `docs/connectivity/transport-selection-v1.md` and capability/coordinator tests/design material.

These locations restore traceability, but sibling-branch documents are not merged into this closure branch and should not silently be treated as adopted authority. In particular, a ratified common retry/path-copy lifetime, dedupe compaction rule, authenticated-receipt protocol, and authenticated capability/downgrade contract are still absent from the current branch. Do not recreate those decisions from memory.

## 8. Security findings — PARTIAL

- End-to-end encryption/session ownership, identity verification, relay authorization, mailbox authorization, and message envelope formats are unchanged.
- New sender-history plaintext is written through the existing encrypted secure-record storage. It is not sent to the relay by this fix.
- The relay still sees routing/envelope metadata required by the existing service and controls relay IDs, mailbox retention, and its own ACK/event claims. No cryptographic receipt authenticates those claims to the sender.
- Stable M1 IDs remain local correlation/dedup metadata. The relay does not receive them. Android uses its M1 value as a Room record key, which can correlate database snapshots if the database is separately exposed; this work does not change that storage layout.
- Web's 1,024-marker eviction versus Android's unbounded markers is a cross-platform replay/retention mismatch. It is not fixed here.
- A malicious relay can forge a `delivered` event and cause current outbox completion behavior; changed UI wording accurately attributes the status to the relay, but does not make the signal cryptographically trustworthy. This remains a blocker for treating it as peer-persisted or multipath evidence.

## 9. Regression evidence — PARTIAL

Validation executed on this branch:

| Check | Result |
| --- | --- |
| Root Jest, `npm test -- --coverage=false --runInBand` | PASS — 105 suites passed, 3 skipped; 548 tests passed, 7 skipped. |
| Service Jest, `npm test --workspace=service -- --runInBand` | PASS — 73 suites, 430 tests passed. |
| Focused sender-history Jest | PASS — `modernConversation.test.ts` and `messageStore.test.ts`; 2 suites and 51 tests passed. |
| Browser reload/persistence E2E, `npx playwright test -c e2e/web-outbox-recovery.config.ts` | PASS — 14 Chromium tests, including repeated reload recovery and injected sender-history transaction abort. |
| Client production build | PASS — TypeScript and Vite build; Vite reports the existing large-chunk advisory. |
| Service SDK build | PASS — production bundle and type definitions generated. |
| Lint | PASS — `npm run lint`. |
| `git diff --check` | PASS. |
| Android unit/build/instrumentation | BLOCKED — required SDK/adb/emulator/AVD absent. |
| Rust execution of shared M1 fixtures | BLOCKED/NOT IMPLEMENTED — no Rust M1 implementation or fixture consumer exists. |

The root Jest suite emits an existing open-handle warning after all tests pass. Test-injected IndexedDB aborts appear in the Vite console as expected failure injection. Neither is represented as a passing production crash/power-loss test.

## 10. Remaining blockers — OPEN

1. Define and implement a reviewed shared dedupe retention/compaction contract only after retry and path-copy maximum lifetime are explicit.
2. Decide whether authenticated peer-persisted receipts are required and, if so, review an envelope/conversation/identity/freshness/replay-bound construction before implementation.
3. Run Android unit/build/Kotlin-fixture/instrumentation tests on a configured environment and disposable AVD, including restart and duplicate-after-reopen cases.
4. Establish executable shared M1 compatibility coverage for Kotlin and, if Rust is part of the protocol surface, add/approve a Rust implementation/fixture consumer before claiming three-language parity.
5. Resolve Web/Android parity for join introduction before claiming cross-platform introduction compatibility.
6. Ratify/merge authoritative connectivity specs from sibling branches, especially retention, receipt, capability/downgrade, and path eligibility decisions.

## 11. LAN readiness decision — BLOCKED

**LAN READINESS = NO.** This closure branch adds no LAN/direct/multipath behavior. The production app's current message path remains relay-only: Web `ModernConversation` uses `SocketIoRelayTransport`; Android messaging uses `SocketRelay`. An experimental private-network module exists in the repository, but it is not wired as a production message transport.

Final gate answers:

- **A. Is sender-history recovery closed? YES** for new Web sends at the local encrypted-storage transaction boundary. Old historyless pending outbox entries and the existing finite history cap remain limitations; physical power-loss safety is not claimed.
- **B. Is dedupe retention sufficiently defined? NO.** Count/age mismatch and no finite retry/path-copy lifetime leave the horizon open.
- **C. Are receipt semantics safe? PARTIAL.** Relay acknowledgements are now described as relay assertions and are not presented as peer-authenticated persistence proof. No authenticated envelope-bound receipt exists.
- **D. Is Android validated? NO.** Blocked by absent SDK/AVD tooling; source review is not execution evidence.
- **E. Are Web/Android fixtures verified? NO.** TypeScript executes; Kotlin is not runnable here, Rust M1 is absent, and Android introduction parity is absent.
- **F. Is the production path still relay-only? YES.** No alternate message transport was activated.
- **G. Is the delivery foundation ready for LAN feasibility? NO.** Dedupe, receipt, Android, fixture, and documentation-adoption gates remain open.

No LAN feasibility implementation should begin from this branch until the security-critical blockers above are explicitly resolved.
