# ADR 0002: Crash-consistent inbound message acceptance

Status: Accepted for this delivery-foundation branch. Web uses option A for inbound acceptance. Android keeps its existing Room transaction and adds the M1 envelope ID to that transaction. No relay or acknowledgement semantics change.

## Context and evidence

The base commit is `8f9ad2b9610fe8b4f8c7243020d11b715ebba4d1` (`connectivity/web-outbox-recovery`). It already commits a Web outbound ratchet update and encrypted outbox record together. It does not make inbound message acceptance atomic: before this branch, Web persisted the advanced session before the application persisted history and the seen marker. Android's `CryptoStateStore.commitInbound()` already grouped account, session, message, digest and mailbox-delivery correlation in one Room transaction.

The prior approved Phase 1F decision in the connectivity design history selected a single transaction for Web's inbound acceptance. This ADR records the decision and the narrow implementation on this branch. Existing Web secure storage exposes `compareAndSwapRecords`; its IndexedDB adapter checks and writes all records in one read-write transaction. Android's existing `database.withTransaction` provides the corresponding Room boundary. No new schema or message-wire format is required.

## Options evaluated

| Option | Atomic boundary and recovery | Migration, retry, compatibility | Platform feasibility and sender implications | Assessment |
|---|---|---|---|---|
| A. One transaction for message, seen marker and session state | Web commits the ratchet snapshot, durable product history and both legacy/stable replay markers in one IndexedDB transaction. First pre-key acceptance also commits the consumed account state and new session. Android already commits its account/session/message/digest set in one Room transaction; this branch adds the stable ID there. Abort leaves the previous ratchet and acceptance records authoritative; exact ciphertext can be retried. | No wire or database schema migration. Legacy Web seen arrays and Android digest records remain readable. Outbound retry remains the saved ciphertext. Existing ACK timing remains after successful receiver acceptance. | Feasible with current Web IndexedDB CAS and Android Room transaction. Sender behavior is independent: Web outbound atomicity is already in the base; Android already stores message/outbox/session together. | Selected. It directly closes the partial-acceptance window using existing storage primitives. |
| B. Two-phase pending-accept record, then finalization | A pending record must be atomic with the ratchet mutation, then recovery must decide whether to complete content and replay state. It adds an intermediate state and requires startup/retry recovery. | Requires record versioning, recovery policy and tests for stale/partial pending records. Old clients would not understand the state if they encounter it. Sender retry still needs exact saved ciphertext. | Feasible in principle on both stores, but does not improve atomicity over A where all records already fit one transaction. | Rejected for this scope as unnecessary extra state. Reconsider only if a future store cannot transact all records. |
| C. Seen marker first, then idempotent consumer keyed by envelope ID | Marker-before-content can suppress redelivery after a crash before consumer persistence, losing the message. Consumer-first recreates the message-before-marker duplicate window unless writes are one transaction. The session ratchet also must be coordinated. | Requires a durable recovery/outbox-like pending record and idempotent consumer, so it becomes a variant of B. Old-client compatibility is difficult if marker semantics change. | Both stores can persist a marker, but a standalone marker is not a complete acceptance boundary. Sender semantics remain unchanged only if no ACK is sent early. | Rejected as a standalone solution; idempotent UI projection remains useful after durable acceptance. |

## Decision and invariants

Web calls the application acceptance builder while plaintext is still in memory. The builder creates encrypted-at-rest storage updates for the message and replay state. The crypto runtime adds the advanced session snapshot; the first-message path also adds the updated account snapshot. `compareAndSwapRecords` commits that set atomically. Plaintext and temporary serialized buffers are cleared on success and error paths. Only after a successful commit does the receive path invoke its in-memory projection callback and resolve as accepted.

On an abort or conflict, the full IndexedDB transaction leaves all durable acceptance records unchanged. The established-session runtime restores the exact persisted session snapshot so the same ciphertext can be retried. A first-pre-key failure discards the mutated in-memory account/session; after reload the persisted account still has the pre-key and can process the exact ciphertext again. On redelivery after commit, the legacy digest or stable ID is found before another decrypt, so session state is not advanced twice and product history is not appended again.

The bounded replay window remains 1,024 entries per existing marker. Legacy `modern-seen` data is still read and written; the M1 marker is additive. This does not define a safe elapsed-time replay horizon and does not authorize multipath or authenticated receipts. The stable ID is local metadata and is not sent to the relay.

The durable Web acceptance set is the advanced Vodozemac session, product history, the legacy seen marker, and the stable M1 seen marker; a first inbound pre-key transaction additionally includes the account. Existing conversation/contact metadata updates happen only after successful authenticated parsing and continue to preserve the unverified trust state. Existing ACK and relay mailbox behavior are unchanged.

## Crash-point disposition

| Point | Web on this branch | Android current transaction | Expected effect |
|---|---|---|---|
| CP1: after decrypt, before consumer persistence | No durable ratchet or message advancement has committed; restart uses prior session/account and retries ciphertext. | In-memory decrypt mutation is rolled back with an uncommitted Room transaction on process death. | No accepted message loss; no early ACK. |
| CP2: during consumer persistence | Message, session/account and replay updates are one transaction. | Message, session/account, legacy digest and stable ID are one Room transaction. | All-or-none; exact redelivery remains possible after abort. |
| CP3: after consumer persistence, before seen marker | There is no separate durable boundary; the message and markers commit together. | There is no separate durable boundary; message and markers commit together. | No partial accepted-message state from this point. |
| CP4: after seen marker, before ACK | A committed seen marker implies the message and ratchet committed. A lost ACK causes duplicate detection before decrypt. | A committed digest/stable ID implies the message and session committed. Existing duplicate handling returns `Duplicate`. | ACK may be delayed/lost, but duplicate content is not written and the ratchet is not advanced again. |
| CP5: after encrypt, before outbox persistence | Base commit's outbound Web CAS writes ratchet and exact encrypted outbox atomically. Before commit, no retry item exists. | `commitOutbound()` writes account, session, exact envelope, and sender history in one Room transaction. | A failure before transaction commit has no durable send attempt. UI draft/history behavior remains separate on Web. |
| CP6: after outbox persistence, before submission | Web reload restores the exact saved ciphertext and retry metadata. | Android `retryPending()` submits the exact serialized envelope from Room. | Sender work remains pending and must not be re-encrypted or removed without the existing relay completion callback. |

## Evidence limits

The browser E2E test uses real Vodozemac WASM, encrypted `BrowserSecureStorage`, real IndexedDB, injected transaction aborts, page reload, exact ciphertext redelivery, and an established-session follow-up message. This validates the storage/runtime boundary, not OS-level browser process-kill or power-loss behavior. Android instrumentation cases were added against actual Room and crypto code, but this environment has no Android SDK or disposable AVD, so they have not been executed here. Do not report physical Android process-kill evidence from source changes or unit tests.

Sender outbox recovery is covered by the existing browser persistence suite and existing Android outbox implementation. Web sender UI history is still written in a separate application effect after the outbound session/outbox commit; that pre-existing sender-history boundary remains a separate known gap and is not changed here.

## Consequences and follow-up gates

- Web message acceptance now has one durable IndexedDB commit boundary; Android keeps its current transaction boundary.
- No protocol, relay, ACK, call, trust, identity, or message-encryption behavior changes.
- Stable envelope IDs improve local cross-platform retry/dedup correlation; they do not authenticate senders or receipts.
- Run Android Room/JNI instrumentation on a disposable emulator/device before claiming physical crash-recovery validation.
- Define an elapsed-time dedupe retention horizon before enabling any non-relay path or peer-persisted receipt.
- Keep Web sender-history recovery, OS-level crash testing, and authenticated receipts as separate follow-up work.
