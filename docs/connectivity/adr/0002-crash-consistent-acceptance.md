# ADR 0002: Crash-consistent message acceptance

Status: Characterization and options only; no option selected.

## Current behavior

See `current-behavior.md` and `crash-consistency.md`. Web decrypt advances the session, then the consumer stores the message, then the seen marker is written. Outbound encryption precedes outbox persistence. Android inbound instead commits account/session/message/dedupe together through `CryptoStateStore.commitInbound()` before publishing the session.

## Options for later review

A. One transaction covering ratchet/account state, message and dedupe marker. This is only feasible if storage primitives actually support a shared transaction.

B. A durable pending-accept record coordinated atomically with session state, then finalized. Requires a replay/recovery state machine.

C. Persist dedupe before consumer and require an idempotent consumer keyed by stable envelope identity. This avoids duplicates but must not acknowledge before durable content acceptance or suppress a message permanently after a crash.

Phase 1 must inspect the actual `SecureStorage` port, web IndexedDB and Android Room transaction boundaries, then document tradeoffs and obtain approval before production changes. Phase 0 records current behavior at CP1–CP6 only.

## Phase 1B acceptance gate

The owner must be able to recover from a crash after decrypt but before content persistence, during content persistence, and after content persistence but before dedupe persistence. A positive `receiver-accepted` response or future peer receipt must follow durable acceptance of content and required session/dedupe state. Web currently writes the consumer result and seen marker separately after ratchet advancement; ordering alone does not meet this gate. Android's transaction is evidence for its own inbound path, not proof of Web parity.

Sender recovery must likewise distinguish a crash before the encrypted outbox write (no durable retry item) from one after it (retry the identical ciphertext). An ACK lost after receiver acceptance leaves an unknown sender outcome and requires safe redelivery. Duplicate delivery must be idempotent across live, mailbox and later paths, including after restart. Test doubles that do not advance a real ratchet cannot prove recovery at CP1/CP2. Select A, B or C only after verifying which records can share one actual durable transaction; otherwise document and test a recovery protocol. No option is selected here.
