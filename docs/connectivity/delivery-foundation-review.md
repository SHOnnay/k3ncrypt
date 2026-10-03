# K3NCRYPT delivery foundation review

Review branch: `connectivity/delivery-foundation-review`\
Reviewed branch: `connectivity/delivery-foundation`\
Reviewed head: `77caacbf0d810f877f3b366a999e84aedc456588`\
Base: `8f9ad2b9610fe8b4f8c7243020d11b715ebba4d1`\
Scope: read-only review of M1, M2, Android evidence, sender history, retention, relay-only behavior, and security. No production code changed.

## 1. Executive finding

**Overall: PARTIAL — do not accept the delivery foundation for multipath work yet.** M1's algorithm is implemented consistently in TypeScript and Kotlin and passes the runnable TypeScript fixture tests. Web inbound acceptance now groups the session, message, and replay markers in an IndexedDB transaction. Android source groups equivalent receive records in a Room transaction. However, Android could not be built or tested here, real process-kill/device-crash behavior has not been demonstrated, Web sender-visible history is outside the outbox/session transaction, and there is no defensible deduplication retention horizon. These gaps prevent the evidence from supporting a LAN/direct rollout.

The application paths reviewed remain relay-only. This review did not add or activate another path.

The requested handoff files `HANDOFF.md`, `current-behavior.md`, `envelope-identity-v1.md`, `transport-control-v1.md`, `receipts-v1.md`, and `path-eligibility-v1.md` are not present at the reviewed branch head. The only connectivity report there is `delivery-foundation-report.md`. The available tracked copies from the earlier connectivity specification refs were consulted as design references, but their absence from this branch is a traceability gap; this review treats source and executable tests as the evidence for implementation claims.

Reviewed commits on the delivery-foundation branch:

- `2632bc04da90e2ce9260470309627ef30bdd539a`
- `bff1f337b20763695f1207d698c6da0c32c353b8`
- `4e80615740f8ece476e1c5b03d0ab10742de7e8d`
- `77caacbf0d810f877f3f3b366a999e84aedc456588`

## 2. M1 result — PARTIAL

`service/src/delivery/envelopeIdentity.ts` and `android/messaging/src/main/kotlin/com/k3ncrypt/messaging/EnvelopeIdentity.kt` implement the same M1 construction:

```text
UTF8("k3ncrypt/envelope-id/v1")
|| u32be(byteLength(UTF8(conversationId))) || UTF8(conversationId)
|| u32be(byteLength(UTF8(olmMessage))) || UTF8(olmMessage)
```

The result is SHA-256, encoded as `v1:` followed by lowercase hexadecimal. Both implementations reject unpaired UTF-16 surrogates before UTF-8 conversion. TypeScript first validates the v2 envelope shape and hashes the exact validated inner `olmMessage`; it does not serialize the envelope again for M1. Kotlin parses the envelope and hashes the extracted string. The ID binds both the conversation identifier and exact ciphertext string, so the same ciphertext string in different conversations yields different inputs/IDs. The ID is local dedupe/correlation metadata; it is not sender authentication, trust evidence, or a delivery receipt.

`protocol-fixtures/v1/envelope-identity.json` has the same SHA-256 in this branch and the available `connectivity/envelope-identity` reference: `dc6751fcd712acf448df56bd3af86b30b2a056c7f1d98aae22a65750dc6da08a`. TypeScript fixture tests passed. Kotlin tests reference that fixture and test parser/identity parity, but were not compiled or run because Android SDK/AVD tooling is absent. Therefore the algorithm and fixture agree by inspection, but runtime cross-platform parity is not yet validated.

Call sites reviewed:

- Web outbound: `ModernConversation.sendUnlocked()` computes the ID after encryption and stores it beside the exact ciphertext in the local outbox. `readPendingSnapshot()` recomputes and checks it when loading old/new outbox entries.
- Web inbound: `ModernConversation.receive()` computes the ID before duplicate checking/decryption and stores it in the same secure acceptance transaction as the session/message updates.
- Android outbound: `AndroidMessagingRepository` stores the ID with the exact encrypted envelope in the Room outbox record; retry submits the saved envelope string.
- Android inbound: `InboundMessageProcessor.receive()` computes the ID from the parser-extracted ciphertext; `CryptoStateStore.commitInbound()` rechecks the ID inside its Room transaction.
- The relay wire payload does not include M1's envelope ID.

No change to the current wire envelope was found. The algorithm is suitable as a deterministic local identifier for duplicate copies of the same exact ciphertext in one conversation. **It is not yet sufficient evidence for enabling overlapping paths:** retention and cross-platform execution gates below remain open.

## 3. Deduplication result — PARTIAL

### Current receive order

Web receive is serialized by the conversation receive mutex and, outside connection setup, the tab lock. It validates the envelope, computes stable M1 and legacy JSON digest, checks both replay stores, and only then reaches the crypto runtime. On acceptance, the Vodozemac session, product message update, legacy digest, and M1 ID are committed together. Only after the commit does the transport handler return `true`; the Socket.IO adapter then emits `received` and returns `{accepted: true}`. A duplicate found before decryption returns accepted without another decrypt or history update, allowing the current relay delivery to be acknowledged.

Android's processor mutex serializes receives in one repository instance. It checks both legacy digest and M1 ID before crypto, then checks them again inside `CryptoStateStore.commitInbound()`'s Room transaction. That transaction stores account/session state, the message, both dedupe records, and inbound delivery metadata. A duplicate transaction returns `DUPLICATE` without replacing the session. Android ACKs the mailbox delivery only after `receive()` returns accepted/duplicate.

### Required duplicate cases

| Case | Finding |
|---|---|
| Same envelope twice quickly | **PASS in tested Web receive boundary.** Mutex plus stable/legacy pre-decrypt lookup suppresses second decrypt and duplicate history. Android source has processor mutex plus transaction-level recheck; its test was not run. |
| Duplicate after restart | **PARTIAL.** Durable Web/Room markers are read from persisted storage. Web E2E reload tests prove abort recovery and exact redelivery when the failed transaction left no marker; unit tests cover accepted duplicates in one runtime. No E2E test explicitly reloads after a successful commit and then redelivers that already-committed ciphertext. Android instrumentation checks reopened Room state in source, but was not run and is not an OS process-kill test. |
| After legacy seen-list eviction | **OPEN.** Web caps both lists at 1,024 entries. Once the M1 ID is evicted, a reordered serialization also misses the legacy `SHA-256(JSON.stringify(envelope))` digest. The crypto session may reject the replay, but the application-level dedupe guarantee is no longer established. Android stores per-message dedupe records without an observed age/count pruning policy, which creates unbounded growth and a different retention contract. |
| Same envelope through two logical adapters | **PARTIAL.** A unit test calls the receive boundary twice with outer JSON keys reordered and proves one decrypt/history projection. Actual adapters are relay-only today, so concurrent multi-adapter delivery and shared persistence arbitration are not exercised. |
| Duplicate after failed persistence | **PASS for Web injected transaction abort.** The message/session/seen updates abort together; exact ciphertext redelivery can then be accepted. Android's equivalent Room transaction is visible in code, but platform tests did not run. |
| ACK another envelope by mistake | **PARTIAL.** Receiver ACK refers to the current relay delivery ID; Web sender outbox completion correlates a `delivered` event by relay ID, not M1 ID. UUID-style relay IDs are generated by the server, but no authenticated receipt binds that event cryptographically to the envelope. Tests cover a stale old relay ID not clearing an item after retry and repeated/unknown IDs not completing an item. Collision/reuse or malicious-relay behavior is not proven by those tests. |

The stable ID is local and absent from relay/path metadata. Android uses the deterministic M1 ID as a Room `recordId` (primary key); its encrypted record value does not encrypt the key column. This does not expose the ID over the network, but a copied database can correlate the same ciphertext ID across snapshots. Treat this as **PARTIAL metadata minimization**, especially before adding paths or receipts. Web stores the list inside the encrypted vault value.

## 4. M2 crash-consistency result — PARTIAL

Web `VodozemacRuntime.decryptAndCommitInbound()` holds the session mutex, checks the persisted session snapshot, decrypts in memory, obtains durable acceptance updates from the caller, serializes the next session, and submits the session plus acceptance updates in one secure compare-and-swap. The IndexedDB persistence adapter executes that CAS in one read-write transaction. It updates the live session snapshot only after commit; on failure it checks durable values, restores the old session when safe, and quarantines ambiguous state. First pre-key acceptance includes the mutated account, new session, and acceptance updates in the same transaction.

Android `CryptoStateStore.commitInbound()` uses `Room.withTransaction` for account/session/message/dedupe records; `commitAndRememberSession()` publishes the in-memory session only after the transaction succeeds. Source ordering is consistent with M2, but Android execution evidence is blocked.

| Point | Loss / duplicate / session outcome | ACK and outbox outcome | Evidence |
|---|---|---|---|
| **CP1 — after decrypt, before persistence** | Web decrypt mutation is in memory; durable session/message/seen remain old. A retry of the same ciphertext can recover. First-prekey failure additionally locks/quarantines the mutated identity runtime; reload is needed. Contact/route/session-audit side effects in the Web first-session message builder occur before the final CAS, so an unverified contact/route may remain even though the message was not accepted. | No positive receive ACK before commit. No sender outbox mutation caused by this receiver window. | Web WASM/IDB injected-abort test covers transaction failure and exact redelivery; there is no literal process-kill at the instruction boundary. Android source only. |
| **CP2 — during persistence** | IndexedDB transaction either commits all listed records or aborts them; source plus injected abort tests show no partial message/session/replay write. Room transaction is designed to roll back as a unit. | No positive receive ACK until commit returns. Sender outbox remains governed by existing relay behavior. | Real Web IndexedDB abort test; Android Room source only. |
| **CP3 — message persisted before replay marker** | No separately persisted gap: Web message/session/legacy+stable markers share the CAS; Android message/session/digest/stable ID share Room transaction. | No independent ACK window between those records. | Web injected abort plus code path; Android source only. |
| **CP4 — replay marker persisted before ACK** | Durable message/session/marker exist. A redelivery is suppressed before decrypt while marker remains retained. Eviction makes long-delay duplicate behavior unproven. | A crash before handler ACK can cause relay retry; current dedupe is intended to ACK that duplicate. This is not a signed peer receipt. | Web unit and transaction tests; explicit process-kill/restart after successful acceptance is not demonstrated. Android source only. |
| **CP5 — after encrypt, before outbox persistence** | Web encrypt/session/outbox use an atomic CAS. Before commit, no durable pending envelope exists; safe recovery preserves prior ratchet snapshot, but the user's plaintext may be absent after app restart. Android transaction groups session/outbox/outbound history by source inspection. | Nothing should be submitted before outbox commit. No relay ACK is possible in this window. | Web outbox fault-injection/reload tests. Android tests were not executed. |
| **CP6 — after outbox persistence, before submission** | Web reload restores and resubmits the exact saved ciphertext, without re-encryption. Android retry reads the exact serialized envelope. | Web retains pending work until existing relay `delivered` correlation; Android removes its outbox after any successful relay submission receipt, including mailbox-stored response. Neither means authenticated peer persistence in all cases. | Web Playwright recovery tests passed; Android source only. |

Evidence categories are deliberately separate:

- **A. Deterministic fault injection: PASS for Web paths tested.** Tests use actual Vodozemac WASM, encrypted IndexedDB, injected transaction aborts, and exact-ciphertext retry.
- **B. Process restart/reload: PARTIAL.** Browser `page.reload()` exercises application reload and persisted browser storage. It is not evidence of an OS process kill. Room reopen tests are present in the branch but were not run.
- **C. Actual OS/device crash: BLOCKED / not demonstrated.** No Android SDK, AVD, `adb`, emulator binary, or physical-device run was available.

## 5. Android validation — BLOCKED

This checkout has no `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `android/local.properties`, `adb`, `emulator`, or `$HOME/Library/Android/sdk`. `./gradlew test` was run and failed during Gradle project configuration with “SDK location not found.” Instrumentation cannot run without the SDK and disposable AVD. No persistent beta emulator was touched and no Android test result is inferred from source inspection.

Required evidence: run Android unit tests and `assembleDebug connectedAndroidTest` on a configured machine with a disposable AVD; include the shared M1 fixture, Room rollback, committed-duplicate after database/process restart, exact outbox retry, and established/pre-key session persistence tests. Record whether the test is database reopen, app process kill, or actual device power-loss; do not conflate them.

## 6. Web sender-history result — OPEN

`ModernConversation.sendUnlocked()` atomically persists the advanced session and encrypted envelope in the outbox, then submits/retries it. It does not put the sender's plaintext chat-history row in that atomic update. `ChatContext.sendMessage()` adds the outgoing plaintext message to React state only after `sendWithReceipt()` returns. A React effect subsequently calls `writeMessages()` asynchronously.

Therefore a crash after durable outbox/session commit but before `addMessage()`/history persistence can leave a retryable ciphertext with no recoverable local plaintext history. If the recipient already accepted it and the relay completion removes the outbox before the UI history write is durable, the peer can have the message while the sender's history lacks it; the ciphertext cannot reconstruct the plaintext for the sender UI. The message is not necessarily lost to the recipient, but the sender-visible copy is unrecoverable from the currently persisted outbox. No duplicate local history was demonstrated; send history is added once per returned client ID and delivery callbacks update that ID.

This needs a product/storage-boundary decision: whether outbound plaintext history is part of the same atomic acceptance transaction, or whether a separately recoverable local history intent is required. This review does not choose or implement either solution.

## 7. Dedupe-horizon decision — OPEN

No numeric horizon is justified by current evidence.

- Web stable and legacy seen lists retain at most 1,024 entries, not a time interval.
- Android's inbound digest and stable-ID rows have no per-entry pruning observed; they grow with accepted messages until store reset.
- Relay mailbox entries expire after seven days (`OFFLINE_TTL_MS`). Relay `dedupeKey` suppresses duplicate mailbox inserts only while its record remains; expiry/deletion permits a later retry to create another mailbox record.
- Web retries pending exact ciphertext periodically while its conversation is active; no finite maximum retry age was found. Its persisted outbox may outlive the seven-day relay mailbox record.
- Future LAN/direct overlap can keep another copy delayed beyond the mailbox lifetime. No path-copy expiry contract exists yet.
- Offline operation and storage growth require a defined policy rather than an arbitrary cap.

Alternatives requiring an explicit decision:

1. **Permanent per-conversation envelope-ID tombstones.** Strongest duplicate suppression across arbitrary delayed paths; unbounded storage unless paired with a safe compaction rule.
2. **Time-bounded tombstones.** Bounded storage, but safe only after every sender retry, relay mailbox, offline queue, and path-copy lifetime has a hard upper bound and the tombstone lifetime exceeds their combined maximum plus clock/cleanup margin.
3. **Cryptographic-session replay rejection as a fallback.** Reduces reliance on long tombstone retention, but does not provide path-independent application dedupe, stable ACK behavior, or exactly-once UI projection; it cannot substitute for an agreed horizon.

**Decision: OPEN.** Before multipath, specify maximum lifetime for an envelope copy and retry, retention/compaction semantics for each platform, and behavior after expiry. Then test the maximum delayed cross-path duplicate against persistent session recovery. Do not broaden the current Web list or silently assume seven days is sufficient.

## 8. Relay-only verification — PASS for the shipped app paths

- `ModernConversation` constructs `SocketIoRelayTransport` and wraps it in `DefaultTransportManager` when no manager is injected.
- The client runtime call site creates `new ModernConversation(secureVault, loadVodozemacBindings)` without injecting a custom manager.
- `DefaultTransportManager` owns one `Transport`; it has no candidate enumeration or selection policy.
- `RelayPathAdapter` is a wrapper and is not wired into the current conversation runtime.
- Android messaging uses `SocketRelay`; no LAN/direct transport selector or discovery registration was found.
- No LAN discovery or WebRTC data channel is registered as a message path in the reviewed runtime.

The service constructor permits an explicit custom `TransportManager` injection for other consumers/tests. That is not automatic eligibility or multipath selection in the K3NCRYPT app. A future adapter cannot be silently selected by the current app code; adding it would require a runtime wiring change.

## 9. Security findings

| Finding | Status | Evidence / consequence |
|---|---|---|
| Conversation binding and exact ciphertext identity | **PASS** | M1 domain and length framing bind exact UTF-8 conversation ID and `olmMessage`; vectors cover changed conversation/ciphertext and unusual JSON ordering. |
| Cross-platform execution parity | **PARTIAL** | Same shared fixture and matching source algorithm; Kotlin test/build not run. |
| Envelope ID sent as clear path metadata | **PASS (not found)** | Relay payload forwards the existing envelope and recipient route; M1 ID is local. |
| Local ID correlation leakage | **PARTIAL** | Android Room record key contains deterministic envelope ID in a non-encrypted key column. It can correlate database snapshots; it does not prove a network leak. |
| Stale dedupe records / replay | **OPEN** | Web count-bounded eviction can remove old IDs; Android retention differs and is unbounded. No cross-path horizon is defined. |
| ACK/envelope authentication | **OPEN for multipath** | Relay ID and `delivered` are server-controlled correlation signals, not a peer-signed receipt cryptographically bound to M1 ID. A malicious relay can lie about relay-level state; existing code does not claim otherwise. |
| Session advances on accepted duplicate | **PASS for tested boundary** | Stable/legacy duplicate lookup precedes decrypt; Android transaction rechecks before writes. Kotlin/runtime evidence remains unexecuted. |
| Metadata written before Web first-message CAS | **PARTIAL** | Contact registry, route mode, and session audit can be written while preparing first-session acceptance before session/message/replay CAS. An abort can leave unverified route/contact metadata without an accepted message. It does not mark the contact verified or persist the message as accepted. |
| Retry/re-encryption | **PASS for Web tested path** | Persisted outbox contains exact ciphertext and reload resubmits it; no retry re-encryption was observed. Android source behaves similarly. |
| Transport metadata used as trust evidence | **PASS for reviewed change** | M1 ID and relay ACK do not change contact verification state. No trust transition was found on transport metadata. |

No defect in the reviewed changes justified an in-scope narrow production fix. Several OPEN items require cross-platform evidence or an architecture/product decision; they are documented rather than silently changing retention, sender history, ACK, or trust semantics.

## 10. Test evidence

Validation was run on this review branch with no source changes. Counts below are this run, not copied from the implementation report.

| Check | Result |
|---|---|
| Root Jest `npm test -- --coverage=false --forceExit` | **PASS:** 105 suites passed, 3 skipped; 544 tests passed, 7 skipped. The sandbox initially blocked a Supertest local listener; rerun with local-listener permission completed successfully. Jest reported an existing worker/open-handle warning and used `--forceExit`. |
| Service Jest `npm test --workspace=service -- --coverage=false --forceExit` | **PASS:** 73 suites, 427 tests passed. Jest reported a worker not exiting gracefully; `--forceExit` completed the run. |
| Focused Jest (envelope identity, modern conversation, Vodozemac runtime, secure vault) | **PASS:** 4 suites, 79 tests passed. |
| Browser persistence/outbox E2E `npx playwright test -c e2e/web-outbox-recovery.config.ts` | **PASS:** 12 Chromium tests passed. Expected injected IndexedDB abort errors appeared in the test server output. |
| Client production build | **PASS:** TypeScript + Vite build completed. Existing Vite advisory: a 565 kB minified chunk exceeds 500 kB. |
| Service SDK build | **PASS:** production bundle and declarations generated. |
| Lint `npm run lint` | **PASS.** |
| Android unit `./gradlew test` | **BLOCKED:** Gradle reports no Android SDK location. |
| Android build + instrumentation `./gradlew assembleDebug connectedAndroidTest` | **BLOCKED:** no SDK, AVD, `adb`, or emulator available; instrumentation not run. |
| `git diff --check` | Run after adding this review document; result recorded in final commit check. |

## 11. Remaining blockers

1. **Android execution evidence — BLOCKED.** Unit/build/instrumentation tests must run on a configured Android SDK and disposable AVD; include a process-restart duplicate-receive case.
2. **Dedupe horizon — OPEN.** Define maximum envelope retry/path-copy age and per-platform retention/compaction. Current Web count cap and Android unbounded rows are not a shared contract.
3. **Web sender-history recovery — OPEN.** Choose how durable outbound plaintext history relates atomically or recoverably to the encrypted outbox/session commit.
4. **Crash claim — PARTIAL.** Web injected transaction abort/reload is useful evidence, not OS/device crash testing. Do not claim physical crash safety from it.
5. **ACK semantics — OPEN for multipath receipts.** Current relay callbacks and delivered IDs do not prove a cryptographically authenticated peer-persisted receipt bound to an envelope.
6. **Specification traceability — PARTIAL.** The handoff/state/receipt/path-eligibility documents requested for this review are absent from the reviewed branch head. Carry the normative docs into the next gate or link exact immutable source revisions.
7. **Android local metadata — PARTIAL.** Decide whether deterministic M1 IDs may remain clear Room record keys before exposing IDs to path/diagnostic metadata or adding cross-device receipt behavior.

## 12. Exact next implementation gate

**Phase 1 is not ready to be accepted for multipath.** The next work should be a review/readiness gate that closes the blockers above, not LAN implementation. The planned name `connectivity/lan-feasibility` is appropriate only after that gate passes; it must remain a feasibility/specification stage and must not enable LAN in production by itself.

Before any LAN path is enabled, require all of this evidence:

1. Android unit tests and instrumentation pass on a disposable AVD, including shared M1 vectors, atomic Room rollback, duplicate after restart, outbox retry, and session persistence.
2. Web and Android prove identical M1 IDs by executing the same fixtures, and their replay retention policy is explicit and compatible.
3. A reviewed, finite envelope retry/path-copy lifetime or a justified permanent tombstone/compaction design is specified, implemented, and tested at the expiry boundary.
4. Web sender history can recover consistently across a crash between outbox commit, relay submit/completion, and history persistence.
5. CP4 redelivery after durable acceptance is tested across an actual application process restart on each platform; any stronger OS-crash claim has corresponding device-level evidence.
6. Relay ACKs remain classified as relay/live-handler signals. Any future peer-persisted receipt must be authenticated and bound to conversation, envelope ID, sender/receiver identities, freshness, and replay state before UI or coordinator code treats it as that state.
7. The normative handoff, delivery-state, identity, receipts, and path-eligibility documents are available at immutable revisions in the implementation/review branch.
8. The relay-only assertion remains true until a separately reviewed transport adapter and explicit policy gate are implemented.

Until these are satisfied, keep Relay as the only active production message path and do not begin LAN production integration.
