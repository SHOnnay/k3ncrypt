# Stage 0: delivery, identity and persistence boundaries

Date: 2026-10-03. Branch: `connectivity/stage0-contract-hardening`.
Base: updated `origin/main` = `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f`.
Authority: the independent connectivity audit supplied in the task, with findings rechecked against **main**, not assumed from another worktree.

## Scope and branch reconciliation

`git fetch origin` confirmed main has not absorbed the later connectivity/readiness sequence. No branch was merged or cherry-picked. The original dirty working tree was preserved; this work used a new worktree. `docs/connectivity/HANDOFF.md` is absent on main. Its version on `verification/readiness` and the prior audit were consulted as references, not copied into main as implemented behavior.

| Existing work | Commit / branch | Present in main? | Disposition |
|---|---|---|---|
| Relay delivery boundary | bf807a4 / connectivity/delivery | No | Do not duplicate |
| Delivery coordinator | f34b981 / connectivity/delivery-coordinator | No | Do not duplicate; main still retries in ModernConversation |
| Transport policy | a80672f / connectivity/transport-policy | No | Specification/fake tests only |
| Web atomic inbound acceptance | bb958ec / connectivity/web-atomic-acceptance | No | Requires separate reviewed integration; current main acceptance remains non-atomic |
| Stable envelope identity | e31555a (ancestor of connectivity/envelope-identity) | No | Specification, not deployed stable IDs |
| Authenticated receipts | 374bf1b | No | Specification; no receipt protocol introduced here |
| Authenticated capabilities | 0b9b83e | No | Specification; relayed hints are not authenticated negotiation |
| Android explicit contact trust | ed02b49 / invitation-redesign/trust-state | No | Important integration prerequisite; not silently imported |
| Verification readiness | 11b4517 / verification/readiness | No | Native signature/intro parity and tests remain on their branch |
| LAN architecture decision | bf71235 / connectivity/lan-decision | No | No production carrier |
| Isolated dummy LAN spike | 9658bbf / connectivity/lan-spike | No | Not imported or repeated |

## What was confirmed / disproved

Confirmed: Web ratchet persistence precedes outbox persistence. A failed outbox write leaves a valid advanced session without the just-created ciphertext. There is no marker left to recover that outbound item. Retrying **durably queued** work uses the original envelope and does not encrypt again. Retrying an application send after a pre-outbox failure is a new send, not recovery of the missing envelope.

Confirmed: Web submission is not completion. Pending work remains until `delivered` matches the currently saved relay ID. A later retry can overwrite that ID, making a delayed older event ineffective. Android removes pending work after a submission response which can mean mailbox storage. Neither is independently authenticated peer persistence.

Confirmed: main's existing-session metadata repair allowed an arbitrary valid fetched descriptor when both the saved commitment and contact were missing. The orchestration tests deliberately make decrypt succeed and show this was enough to create contact metadata. This is not a demonstration of breaking Olm; it demonstrates the missing authorization check after decrypt.

Disproved: "Web's lease is a complete owner fence." It blocks a second live lease, but previously a resumed heartbeat could overwrite a newer owner. Queued work previously did not recheck after obtaining the Web Lock. Even with the narrow fixes, an already-running callback can finish after lease takeover when Web Locks are unavailable. Two independent restored runtimes can persist stale session snapshots. A per-runtime mutex is not a global account/session owner.

Disproved for **main**: Android already has explicit verified/unverified persistence. `savedTrustedConversations` still derives the label from route/fingerprint presence via `SavedConversationIndex`. The explicit-state fix exists on ed02b49. This pass adds no automatic trust; it cannot certify the old baseline's implicit trust model as safe.

## Narrow production changes

Only `service/src/crypto/modernConversation.ts` changes application behavior:

1. Existing-session contact repair now requires a nonempty saved commitment matching the fetched identity. Missing or mismatching commitment rejects before registry observation, route persistence, message callback, or seen-marker creation. A successful decrypt is not sufficient authorization.
2. A queued tab operation rechecks the lease owner inside the Web Lock callback before invoking the operation.
3. A heartbeat renews only a lease still owned by that instance. It cannot overwrite a new owner's lease.

Tests were run against the original main source: missing-commitment, stale-heartbeat, and queued-operation regressions all failed (3 failures). The same tests pass with these changes. The intentionally failing baseline run left a conversation timer alive; its test process was terminated after results, and the modified source was restored.

Compatibility impact: a legacy restored conversation missing BOTH contact metadata and its commitment no longer repairs identity from a fetched descriptor. It fails closed. No automatic repinning or trust upgrade is added. The existing successful restoration test now supplies the retained invitation commitment explicitly. This is intentional loss of unsafe recovery availability, not evidence of complete metadata repair.

The check occurs after main's persisted decryption; rejecting metadata can therefore leave consumed ciphertext without application acceptance. Fixing that crash/acceptance boundary is separate from authorizing the identity. No claim is made that this patch makes rejected-message recovery atomic.

`android/app/build.gradle.kts` adds Room KTX **only to androidTestImplementation** so tests can abort an enclosing transaction. No release dependency or Android runtime behavior changes.

## Crash/restart matrix

A–F browser probes use real Vodozemac WASM, BrowserSecureStorage, encrypted IndexedDB, document reload, unlock and session restoration. They do not use a live relay. E/F use a test-owned submission sink. Unit tests separately execute ModernConversation's real retry path with a fake carrier.

| Boundary | Durable state after restart on this baseline | Outcome / evidence |
|---|---|---|
| A: before encryption | Original session; no outbox; no mutation marker | Session restores; no queued-send claim |
| B: encrypt mutated, session write fails | Prepared marker; prior session initially remains | Runtime quarantine; restart recovery deletes unsafe session; no outbox. Safe refusal, not transparent recovery |
| Session written, marker deletion fails | Interrupted marker remains | Existing runtime/unit recovery discards session; no claim of rollback to usable ratchet |
| C: session persisted, before outbox | Advanced usable session; no marker; no ciphertext outbox | **Confirmed loss window**; cannot regenerate the exact missing envelope from a retry |
| D: after outbox persistence | Advanced session + exact ciphertext | Queued work survives reload and can retry without encryption |
| E: after submission | Same durable outbox; test sink saw identical ciphertext | Submission is not completion |
| F: after submission, evidence lost | Same as E from sender's durable perspective | Unknown outcome; unchanged ciphertext remains retryable |
| Web receive: decrypt persisted before consumer/seen | Non-atomic on main | Unmerged bb958ec addresses related acceptance boundary; do not claim it is present here |
| Android outbound: outer Room abort | Previous account/session; no new outbox/message | Real Room/Keystore test closes and reopens database, then verifies rollback |
| Android outbound: committed, reopen | Exact serialized envelope/account/session/message | Cleanup of unknown ID is harmless; duplicate cleanup is idempotent |
| Android inbound: outer Room abort | Previous session, no digest/new message | Redelivery can be attempted; synthetic-state test plus existing native interop test |
| Android inbound: same digest committed twice | First state/message retained; second state not written | Duplicate does not overwrite session |

IndexedDB CAS abort test verifies neither of two writes survives a transaction abort and reload. This proves the storage primitive's atomicity, **not** that current outbox/session code uses that transaction.

Reload is not an OS power-loss or disk-loss test. Android database/native-handle reconstruction is not an end-to-end force-stop/reconnect test. No physical-device interoperability claims are made.

## Identity/session association evidence

Current existing-session order is: validate bound route -> replay lookup -> session decrypt/persist -> if metadata absent, fetch descriptor -> validate saved commitment -> observe registry -> persist route -> message callback -> seen marker. Bundle lookup is not always before session lookup, and ordinary complete metadata does not trigger a new lookup.

Tests cover:
- Correct restored session + retained commitment: repair succeeds as **unverified**, then explicit verification remains a separate action.
- Successful decrypt + no commitment: rejects, no registry/route/message/seen acceptance.
- Wrong Curve25519 descriptor and changed Ed25519 key: mismatching commitment rejects.
- Commitment changes while the asynchronous bundle lookup is outstanding: rejects after lookup.
- Changed/stale route while a route is already pinned: rejected before decrypt.
- Restored session and invalid framing: no contact creation.
- Repeated accepted envelope: one decrypt and one message callback, remains unverified.

Limits: fake session handles in orchestration tests are not proof of native peer-key extraction. Runtime session storage persists a session pickle separately from the descriptor. The native session-to-public-identity association for legacy missing metadata and simultaneous replacement still requires a reviewed durable binding. This patch refuses ambiguous recovery rather than inventing that binding. Signed introduction and new inbound session behavior are preserved, with the existing regression suites run.

## Ownership/concurrency evidence

| Case | Evidence | Status |
|---|---|---|
| Second live browser owner | Deterministic production lease test rejects before callback | Pass |
| Suspended owner heartbeat after takeover | Unit regression + two actual browser pages | Fixed |
| Queued operation after ownership replacement | Controlled Web Lock scheduler | Fixed |
| Simultaneous outgoing sends in one owner | Real ModernConversation delivery mutex; distinct pending IDs | Pass |
| Message + call/control in one runtime | Authenticated facade and message encryption serialize persistence writes | Pass |
| Two restored runtime snapshots | Counter-model session demonstrates newer persisted state overwritten by stale instance | **Unresolved**; not a claim that native ratchet replay is safe |
| In-flight callback after owner takeover without Web Locks | Deterministic barrier demonstrates stale callback completes | **Unresolved** |
| Multiple conversations sharing one account marker | Failed conversation A marker is overwritten/deleted by B's mutation | **Unresolved**; global `vodozemac-commit:local` is not per-conversation ownership |
| Incoming while other tab owns lease | Same lease entry gate used by subscribed message handler; direct lease rejection tested | Full actual subscribed receive/process-suspension integration still needed |

No large locking rewrite is attempted. Required follow-up: ownership generation bound to persisted snapshot, shared account mutation serialization, stale-owner callback suppression, and real multi-tab message/control acceptance. These are production LAN stop conditions.

## Exact current delivery evidence

`protocol-fixtures/stage0/current-delivery.json` is a test-only contract consumed by TypeScript and Kotlin. Four direction labels enumerate expected semantics, not executed live journeys. Fixture assertions are supplemented by production relay handler tests, production Web retry/cleanup tests, Android mailbox acceptance helper tests and Room persistence tests.

| Name | Current observation | What it does NOT prove |
|---|---|---|
| SUBMITTED | Adapter returned / submission attempted | Durable relay storage, receiver acceptance, trust |
| RELAY_STORED | Relay `{id,timestamp,stored:true}` | Peer acceptance or persistence |
| RELAY_DELIVERED | Live `{id,timestamp}` after callback or later `delivered(id)` | Independently authenticated peer evidence |
| PEER_ACCEPTED | Local receiver callback `accepted:true` | A sender-verifiable receipt; current Web main's entire acceptance is not atomic |
| Peer persisted | No authenticated wire receipt implemented | Must never be inferred from the above |
| Receipt lost | No sender evidence; unresolved pending on Web | Not proof of failure or success |
| Retry | Web uses same queued envelope; relay attempt ID can change | Not a new cryptographic message |
| Duplicate receipt | Matching cleanup is idempotent | No trust transition |
| Delayed receipt | Old replaced relay ID cannot clear newer pending attempt | Stable-envelope receipt association absent |
| Relay mailbox cleanup | Authorized receiver `received` removes row; relay forwards notification | No independently signed persistence assertion |
| Sender restart | Web reloads pending ciphertext; Android reloads only items not already cleaned on submission | No cross-platform equal completion semantics |

Relay tests exercise absent receiver, positive acceptance and declined acceptance: decline retains the same envelope in mailbox; only explicit storage response contains `stored:true`. No ACK meanings, outbox cleanup timing, mailbox behavior or UI labels are changed here.

## Decisions / stop conditions

- Do not integrate LAN, NSD, DataChannel, offline-delivery claims or a new coordinator in this branch.
- Do not implement a receipt protocol from a specification fixture.
- Do not call this baseline multi-tab safe or fully crash consistent because its characterization tests pass.
- Integrate/review existing trust-state and atomic-acceptance branches separately before duplicating their work.
- Close Web sender atomicity/recovery, native identity/session association, account-wide ownership and stable dedupe/retention before multipath.
- Unverified messaging policy and explicit verification remain separate from route discovery. The old Android mainline trust defect remains visible and must not be normalized by tests.

## Validation

Execution results are recorded below after final runs. No secrets, invitations, fingerprints, private keys or real message content are emitted by new diagnostics; no production diagnostics were added.

Final execution:

- Root Jest: **103 suites passed, 527 tests passed, 3 suites / 7 tests skipped** (`npx jest --runInBand --coverage=false`). Initial run timed out in unchanged `backend/api/controlPlane.test.ts`; isolated rerun and full rerun passed without code changes. Existing open-handle warning remains.
- Service Jest: **71 suites / 412 tests passed** (`npm test --workspace=service -- --runInBand --coverage=false`). Existing open-handle warning remains.
- Browser: **8 Chromium tests passed** (`npx playwright test --config=e2e/stage0.config.ts`); real WASM/encrypted IndexedDB A–F, two pages, transactional abort/reload. The deliberately aborted IDB request reports an expected browser AbortError. No live relay or live four-platform messaging was performed.
- Android unit: **26 suites / 58 tests passed** (`./gradlew testDebugUnitTest`).
- Android debug app and instrumentation APKs: build passed (`:app:assembleDebug :app:assembleDebugAndroidTest`).
- Android instrumentation: **5 tests passed** (`:app:connectedDebugAndroidTest`) on the API 35 ARM64 `k3ncrypt-instrumentation-disposable` emulator, including Stage0StorageBoundaryTest, AndroidCryptoPersistenceInteropTest and SessionRenewalPersistenceTest. The final clean run required wiping only this disposable AVD because it contained a newer test APK; Android Keystore tests then required a temporary emulator lock-screen PIN. With those test-environment prerequisites set, all five instrumentation tests passed. The persistent beta emulator was not targeted, and no application code or guard was changed.
- Lint, client production build, service SDK build, `git diff --check`: passed.
- Known baseline warnings: Vite chunk >500 kB; Jest open handles; npm install audit reports 36 high-severity dependency findings. No dependency upgrade or unrelated fix was attempted.

This is characterization plus narrowly proven fail-closed fixes, **not closure of all Stage 0 blockers**. No transport, SAS, crypto primitive, invitation/verification UX, relay authorization, authenticated receipt wire format, or Android application behavior was changed. Production LAN remains absent/disabled. No offline or multipath claim is authorized.
