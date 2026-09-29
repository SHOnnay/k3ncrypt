# Crash-consistency validation report (Phases 1D–1E)

Status: current-behavior evidence, not a fix or multipath approval. Branch baseline: `ef904fc` (`connectivity/crash-consistency`). Test source: `service/src/crypto/phase1dCrashValidation.test.ts`; earlier Phase 0 characterization remains in its own tests. No production source changed.

## Injected observations

| Window | Test observation | Evidence limit |
|---|---|---|
| S1 before outbox write | Injected outbox failure after modeled sender ratchet write leaves no `modern-outbox`, no submission and nothing to retry on restart. | Source trace confirms `VodozemacRuntime.encrypt()` persists session before `sendUnlocked()` writes outbox; this test uses a modeled ratchet, not real WASM or process death. |
| S2 after outbox write | Relay rejection leaves one pending envelope. A new conversation instance retries exact ciphertext without encryption. A successful submission without later `delivered` leaves pending work and can cause another same-ciphertext retry. | In-memory durable-map restart and mocked relay. |
| R1/R2 after decrypt, before/during product write | Injected product write failure leaves modeled ratchet state, no product message and no seen marker. A strict stateful fake rejects replay after restart; no ACK is produced. | Demonstrates an unsafe ordering and possible loss, not actual Vodozemac replay behavior. Runtime source confirms session persistence precedes consumer write. |
| R3 after product write, before seen write | Seen-marker failure leaves one product message and no marker. With replayable fake decrypt, restart invokes consumer again and persists a second copy. | Real ratchet might instead reject replay; neither outcome meets the recovery invariant. |
| R4 lost/duplicate/delayed ACK | Without `delivered`, pending remains and is retried. Repeating a matching relay ID after removal is idempotent. Retry overwrites relay ID, so delayed ACK for old ID does not clear pending; latest ID does. | Direct `acceptDelivery()` tests, not a network ACK-loss run. |

Phase 0 tests also show that a seen duplicate is accepted before decrypt and the 1,024-entry Web seen list evicts the oldest digest. Web hashes serialized JSON; Android hashes raw envelope text. Those IDs cannot be assumed equal across clients or paths.

## Strategy comparison

| Candidate | Evidence-based assessment | Remaining proof |
|---|---|---|
| Transactional acceptance | Investigate first for Web R1–R3: session, message and dedupe need one durable boundary. IndexedDB multi-record CAS and Android Room transaction are relevant primitives. | Prove Web runtime/account/session and product records can join one atomic operation without leaking secrets; cover first prekey session and tab concurrency. |
| Write-ahead acceptance record | Fallback if shared transaction is infeasible. | Journal must be coordinated before or atomically with ratchet advance and contain sufficient encrypted recovery data. A post-advance journal cannot close R1. |
| Idempotent recovery | Helps R3/R4, duplicates and delayed receipts. | Alone cannot recover R1 after durable ratchet advance before message write; pair with transaction or safe ratchet recovery. |

Recommendation: investigate transaction-based Web receiver commit first, but select no implementation until real Vodozemac restart tests and encrypted-vault transaction boundaries are demonstrated. Keep a journal as fallback; stable envelope identity and idempotent consumer behavior are complementary. Sender S1 requires a separate decision on encryption/outbox atomicity or honest local failure semantics.

## Unresolved validation

1. Browser **OS-process** kill/restart and first-prekey-session crash points at R1/R2/R3; real persisted sender S1/S2. Phase 1E completed real WASM/IndexedDB page-reload probes for existing-session R1/R2/R3.
2. Android first-prekey-session process-death and physical disk/power-loss timing. Phase 1E completed an existing-session in-transaction process-kill probe.
3. Disposable relay/database test for live ACK loss, `received` loss, mailbox replay and stale server events.
4. Cross-platform envelope-ID fixtures and retention bound covering legitimate retry/mailbox lifetime.

ADR 0002 remains undecided. Multipath and `peer-persisted` remain disabled.

## Phase 1E: real persistence and native-session evidence

The new Web Playwright cases use the production WASM bindings, `VodozemacRuntime`, `BrowserSecureStorage` and encrypted IndexedDB. They establish a real inbound Olm session, decrypt a subsequent envelope, reload the page, unlock the same vault, restore the session and redeliver the identical envelope. A page reload reconstructs the JavaScript process state but is **not** an operating-system/browser-process kill. These cases exercise the runtime/vault composition directly, not the full Socket.IO/React receive path.

| Window | Confirmed Web result after reload | Limit |
|---|---|---|
| R1/R2: decrypt completed, product write absent | Advanced `vodozemac-session` survives; no `product-messages` or `modern-seen` record; the same ciphertext is rejected by the restored real session. | A crash exactly inside an IndexedDB write was not injected. This proves the after-decrypt/before-product gap, not the probability of hitting it. |
| R3: product write completed, seen write absent | Session and product message survive; `modern-seen` is absent; real-session redelivery is rejected. | No duplicate product callback occurs in this direct-runtime test. The absent marker still prevents a clean seen-duplicate response in the current composition. |

The new Android instrumentation case uses the actual JNI crypto bridge, a real Olm sender/receiver session, authenticated Keystore encryption and an on-device Room database. It commits a first inbound message, decrypts a second envelope, then injects an exception after the second `commitInbound` body inside an outer Room transaction. It also runs in three external phases: prepare, kill the instrumentation process after the nested inbound write but before the outer transaction commits, then start a new instrumentation process and verify. The kill phase intentionally reports `Process crashed`; the following verification passes.

| Window | Confirmed Android result after force-stop/process death and reopen | Limit |
|---|---|---|
| Uncommitted inbound transaction | First message/session remain; second message and digest are absent; restored native session decrypts the second ciphertext on redelivery. | Test targets an existing session and a kill after the inner write returned but before the outer transaction committed. It does not prove every disk/power-loss timing or first-prekey-session crash point. |
| Committed inbound transaction | First message remains after database close/reopen and process restart. | Existing `AndroidCryptoPersistenceInteropTest` additionally exercises first prekey establishment and a restarted session; neither test is a full app UI/relay run. |

### Platform difference and decision

Web has a **confirmed recoverability gap** at R1/R2: the current real ratchet state can make an unpersisted message undecryptable on redelivery. R3 preserves the message but has no seen marker. Android's current Room transaction gives the tested inbound records an atomic boundary across a real process death. The Android evidence does not transfer to Web. A process death before Web decrypt finishes, a write interrupted mid-IndexedDB transaction, a first inbound prekey crash, multi-tab contention, live relay ACK loss and S1/S2 with real persisted sender state remain untested.

Recommended next design investigation: a Web acceptance transaction that commits ratchet/account state, encrypted product message and dedupe together. If the current storage API cannot provide one shared atomic transaction, specify a recovery record coordinated *before or with* ratchet advancement. Stable envelope-keyed idempotence remains complementary, not a repair for R1. ADR 0002 still does not authorize a production implementation or multipath.
