# Phase 1D crash-consistency validation report

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

1. Real WASM Vodozemac state, encrypted IndexedDB vault and browser process kill/restart at R1/R2/R3 and S1/S2.
2. Android Room process-death fault injection around its inbound transaction.
3. Disposable relay/database test for live ACK loss, `received` loss, mailbox replay and stale server events.
4. Cross-platform envelope-ID fixtures and retention bound covering legitimate retry/mailbox lifetime.

ADR 0002 remains undecided. Multipath and `peer-persisted` remain disabled.
