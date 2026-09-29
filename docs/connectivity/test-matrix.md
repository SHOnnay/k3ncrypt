# Connectivity characterization and acceptance matrix

## Phase 0 baseline coverage

| Area | Existing evidence to run | New characterization required | Record |
|---|---|---|---|
| Invitation, join, introduction | `inviteCrypto.test.ts`, `modernConversation.test.ts` join-introduction cases | Verify creator/joiner route and unverified state survive refresh | baseline pass/gap |
| Contact persistence/restore | modern conversation and contact registry suites | missing metadata restoration via authenticated receive | baseline pass/gap |
| First sessions | `modernConversation.test.ts` first-message tests | both initiation orders and simultaneous attempts | baseline pass/gap |
| Outbox/retry | modern conversation retry test | CP5/CP6 and restart with unchanged ciphertext | baseline pass/gap |
| Relay/mailbox/ACK | `listeners.test.ts`, `sync/relay.test.ts`, DB offline message tests | absent, live-accepted, live-declined, replay, lost ACK semantics | ACK table in current behavior |
| Receiver persistence | Modern conversation and Android inbound processor tests | CP1–CP4 with injected failures; classify known gaps | crash-consistency.md |
| Verification/lifecycle | contact registry, device lifecycle/trust suites | revocation on existing socket; evidence unavailable | pass/fail and logs |
| Calls | calls security/integration/negotiation suites | invite/end/remote end, relay forwarding ACK vs remote transition | baseline pass/gap |
| Replay window | current seen-set | exactly 1,024 and overflow/retry lifetime | retention risk |
| Unknown frames | TS and Kotlin decoders | enumerate current parse/reject/display behavior | transport-control ADR |
| Fixtures | current fixture consumers | new envelope/path fixture shape read by TS and Kotlin | fixture tests |

## Mixed-version matrix

| Sender | Receiver | Path | Phase 0 expectation |
|---|---|---|---|
| Current | Current | Relay | Existing behavior unchanged |
| Future | Current (no feature) | Relay | Never send control frame; normal messaging/calls continue |
| Current | Future | Relay | Future endpoint accepts existing envelope and relay ACK path |
| Future | Future, feature off | Relay | Relay-only behavior |
| Future | Future, feature on | LAN/direct | Only after feature/admission/receipt gates; Phase 0 does not implement |
| Any | Unknown version/control | Any | Characterize current parser; future rule is fail closed without changing session/trust |

## Real-device acceptance after later phases

Android-to-Android verified contact; no internet for LAN test; app cold start; same ciphertext via LAN and relay overlap; Wi-Fi client isolation; process death; revocation/freshness change; switch between networks; TURN and blocked UDP. Browser support is recorded separately. Emulator-only success is insufficient for LAN claims.

## Phase 1B specification gates (future tests; not enabled by this document)

| Gate | Evidence required before multipath | Expected result |
|---|---|---|
| State evidence | Live relay acceptance, offline `stored:true`, submission timeout, replay-loop completion | Each maps only to the claim in ADR 0006; no adapter/relay result asserts `peer-persisted`; timeout remains unknown |
| Stable ID | Same validated ciphertext through Web/Android and reordered JSON; changed ciphertext or conversation; legacy seen records | Identical cross-platform ID for identical conversation/ciphertext; distinct for changed inputs; legacy duplicates recognized during migration |
| Retention | Replay at 1,024 entries and after supported maximum retry/mailbox lifetime | No accepted envelope reaches a second decrypt while it may legitimately be retried; establish an explicit bound before implementation |
| Sender crashes | Before/after encrypt, before/after outbox write, after submit and after lost ACK | No false completion; a durable pending item retries the same ciphertext after restart; pre-outbox failure is reported accurately |
| Receiver crashes | After decrypt, during content write, after content write, after dedupe write and before ACK | After restart: one persisted message, recoverable session and dedupe, no positive acceptance before durable commit; use real ratchet/storage boundaries |
| Duplicate delivery | Live ACK lost then mailbox replay; future path overlap; repeated receipt | One authenticated acceptance/consumer effect; duplicates handled before second decrypt; receipts change state at most once |
| Forged/stale receipt | Wrong device, conversation, ID, version, changed identity, expired ID, raw relay/path ACK | Rejected without outbox removal or trust/session mutation |
| Mixed versions | Current/current, current/future, future/current, future/future with feature disabled/enabled | Relay-only remains compatible; no future receipt/control sent to an unadvertised peer |

The Phase 0 fake decryptor does not establish real crash recovery. Run the existing relay, service, client and Android suites as compatibility checks after any later production change; perform disposable-database fault injection before making a durability claim.

### Phase 1G stable envelope identity specification tests

`envelope-identity-test-plan-v1.md` defines the acceptance suite before runtime adoption. At minimum, TypeScript and Kotlin must consume the same public fixture file and assert exact identical `v1:` IDs. Cover multibyte UTF-8, JSON metacharacters within `olmMessage`, empty/oversized/invalid Unicode rejection, changed conversation, changed ciphertext, property-order/whitespace changes in the outer JSON wrapper, and identical ciphertext with distinct relay attempt/mailbox IDs.

Migration tests must seed legacy Web and Android markers in their native formats, redeliver the corresponding validated envelope, and prove dual-read prevents a second decrypt while new acceptance atomically writes a v1 marker. Restart, concurrent-tab/process races, marker-capacity pressure, expired delivery, rollback to an old reader, and authenticated receipt mismatch/replay cases are required before multipath or receipts use the ID.

## Phase 1C crash-acceptance design tests (future work)

Use `crash-acceptance-v1.md` as the sequence reference. With real persisted Web Vodozemac state and an isolated vault, stop/restart at S1, S2, R1, R2 and R3; inject failed writes independently for session, outbox, product message and seen marker. Record which records survived and whether the identical envelope can be retried without content loss or duplicate display. Test first inbound prekey establishment separately from existing-session receive. Repeat R4 with dropped live callback and lost `received` event, followed by mailbox replay; R5 must deliver identical ciphertext over overlapping adapters only after those adapters exist. Android tests must kill/restart around the Room transaction and verify account/session/message/digest remain consistent; do not infer this from a fake storage implementation.

Candidate acceptance criteria: one persisted message per authenticated envelope after recovery; no peer receipt or positive receiver callback before durable acceptance; unchanged ciphertext on retry; no unrelated, forged or duplicate receipt clears pending work. Test envelope IDs on Web and Android against exact cross-platform fixture bytes, altered JSON wrapping, different conversations and beyond the supported replay lifetime. Existing characterization tests document current failures and should not be rewritten as passing guarantees before an approved fix.

### Phase 1D execution record

`service/src/crypto/phase1dCrashValidation.test.ts` adds five current-behavior tests: S1 missing outbox after injected write failure; S2 restart/same-envelope retry and lost `delivered`; R1/R2 failed product write after modeled ratchet persistence; R3 seen-write failure followed by duplicate product write; and duplicate/delayed relay-ID ACKs. These are observation tests, not acceptance tests. The fake ratchet and in-memory store cannot settle real Vodozemac/process-death behavior. See `crash-validation-report.md` for outcomes and outstanding real-state/disposable-database tests.

### Phase 1E execution record

| Probe | Test | Observed | Still open |
|---|---|---|---|
| Web R1/R2, existing session | `e2e/real-crash-validation.spec.ts`: real WASM/IndexedDB, decrypt, reload before product write | Session survives, product/seen absent, identical ciphertext rejected on redelivery | OS browser kill, first prekey session, full receive callback |
| Web R3 | Same Playwright file: persist product, reload before seen write | Product survives, seen absent, identical ciphertext rejected | Seen restoration/idempotent full callback |
| Android rollback | `AndroidCrashRecoveryValidationTest`: JNI/Keystore/Room, injected outer transaction abort | No second message/digest; previous message retained; ciphertext decrypts from restored session | All physical disk-loss timings |
| Android process death | Same test, `crashPhase=prepare`, `kill`, `verify` across runner processes | Kill phase intentionally crashes inside uncommitted Room transaction; verify phase confirms atomic rollback and redelivery decrypt | First prekey-session kill, complete app/relay lifecycle |

The Android test requires a disposable unlocked emulator with a secure PIN because the production Keystore key requires device authentication. These are characterization results, not permission to enable multipath. Sender S1/S2 with real persisted state and live ACK-loss remain pending.

## Phase 0 execution record

- Clean `main` baseline: `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f`; ancestor check passed before branching.
- New tests: Web inbound consumer/seen failures, duplicate and 1,024-entry overflow; outbound CP5/CP6; relay live versus mailbox ACK; shared fixture vectors in TypeScript and shape checks in Kotlin; Kotlin unknown-frame rejection. The current unknown printable TypeScript control behavior is recorded as a gap.
- Existing suites (unchanged): invitation/join/intro, contact restore, first-message direction, retry/restart, verification/device trust, call lifecycle, and relay authorization. These provide baseline coverage; they do not establish real-device LAN/direct behavior.
- Validation: lint, client production build and service SDK build passed. Root Jest: 106 suites/510 tests passed, 3 suites/7 tests skipped. Service Jest: 73 suites/396 tests passed. Android `testDebugUnitTest` passed with `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- The default root Jest coverage collector reported a nonfatal TypeScript resolution error for `client/vite.config.ts`; this is a tooling/coverage warning, not a test failure. The final run uses `--coverage=false` to report test outcomes without that warning. The service suite emitted Jest's open-handle warning even though its tests passed.

### Unclosed Phase 0 acceptance items

The fake Web decryptor does not establish real Vodozemac ratchet recovery at CP1/CP2. Android crash-point fault injection and actual network ACK-loss/restart with a disposable database have not been performed. LAN/direct and mixed-version real-device trials are intentionally future-phase work. Security reviewer approval of the Phase 0 specifications is still required before implementation of Phase 1.

## Phase 1F Web atomic acceptance

| Case | Test | Expected/observed invariant |
|---|---|---|
| Atomic write failure | `e2e/web-atomic-acceptance.spec.ts` injects an IndexedDB CAS failure during real WASM first-prekey acceptance | Account remains unchanged and no session, message, recovery inbox, or replay marker commits. |
| Reload and redeliver | Same test reloads/unlocks and replays the original first-prekey ciphertext | One message, account mutation, session, and marker commit; no accepted ciphertext is lost. |
| Duplicate after commit | Verify the durable replay marker before redelivery; service test exercises `ModernConversation.receive()` duplicate path | Duplicate does not decrypt again or create another product message; pending projection is retried from the encrypted recovery record if needed. |
| Session usable after restart | Same test restores the sender session fixture and decrypts a subsequent real ciphertext | Restored receiver ratchet remains usable. |
