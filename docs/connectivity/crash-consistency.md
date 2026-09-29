# Current crash-consistency characterization

Phase 0 records outcomes; it does not repair them. Failure injection must use existing test seams or test doubles. Production hooks/source edits are out of scope.

| Point | Failure location | Current TypeScript expectation | Current Android expectation | Classification |
|---|---|---|---|---|
| CP1 | After decrypt/session advancement, before message consumer write | No seen marker; volatile ratchet may already be advanced; same-envelope retry may fail | Inbound commit has not occurred; processor invalidates volatile state after mutation | Web known gap; Android recovery path to characterize |
| CP2 | During consumer persistence | No seen marker; partial consumer write depends on storage atomicity; redelivery can duplicate/fail | Room commit should roll back account/session/message/dedupe together | Web known gap; Android transaction characterization |
| CP3 | Consumer persisted, before seen marker | Message may exist without replay marker; duplicate suppression depends on consumer ID handling | Atomic commit includes message and dedupe | Web known gap; Android should be atomic |
| CP4 | After durable acceptance, before relay ACK/report | Relay retries/replays; receiver duplicate handling should return accepted without duplicate UI | Same durable digest returns Duplicate/accepted | Transport/receiver retry known gap to characterize end-to-end |
| CP5 | After encrypt/session advancement, before outbox persistence | Message has no durable retry item; ratchet may have advanced | Must inspect Android sender commit order separately | Web known gap; Android uncharacterized |
| CP6 | After outbox persistence, before/submission failure | Same encrypted envelope remains for retry, not re-encrypted | Existing send path should preserve pending envelope; characterize restart/failure | Intended behavior, test required |

The full acceptance invariant for future delivery changes is: after recovery, no accepted message is lost, stored content is not duplicated, no positive peer ACK precedes durable acceptance, and an unrelated/duplicate receipt cannot clear pending work. Phase 0 does not assert this invariant passes at every point.

## Executed Phase 0 evidence

`phase0InboundCharacterization.test.ts` injects consumer failure and seen-marker write failure into the current receive implementation. It confirms rejection without a seen marker for CP1/CP2, and a second consumer invocation after CP3. Its deterministic fake decryptor does **not** model ratchet advancement, so it cannot prove that a real ciphertext will decrypt a second time after a failed consumer write. A successful receive followed by replay returns accepted without a second decrypt (CP4 receiver side); actual Socket.IO ACK loss is not simulated there.

`phase0OutboxCharacterization.test.ts` confirms CP5 leaves no durable outbox item after an injected write failure, and CP6 resends the same stored envelope after a transport failure without a second encryption. `phase0RelayAcknowledgements.test.ts` confirms the relay's absent-recipient response has `stored:true` while a live accepted callback returns only relay ID/time. These tests are characterization, not repairs. Android `testDebugUnitTest` exercises the existing inbound transaction tests and the new shared-fixture/unknown-frame tests; no Android crash injection was added in Phase 0.
