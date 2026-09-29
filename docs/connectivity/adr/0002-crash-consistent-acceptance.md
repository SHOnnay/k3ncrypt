# ADR 0002: Crash-consistent message acceptance

Status: Characterization and options only; no option selected.

## Current behavior

See `current-behavior.md` and `crash-consistency.md`. Web decrypt advances the session, then the consumer stores the message, then the seen marker is written. Outbound encryption precedes outbox persistence. Android inbound instead commits account/session/message/dedupe together through `CryptoStateStore.commitInbound()` before publishing the session.

## Options for later review

A. One transaction covering ratchet/account state, message and dedupe marker. This is only feasible if storage primitives actually support a shared transaction.

B. A durable pending-accept record coordinated atomically with session state, then finalized. Requires a replay/recovery state machine.

C. Persist dedupe before consumer and require an idempotent consumer keyed by stable envelope identity. This avoids duplicates but must not acknowledge before durable content acceptance or suppress a message permanently after a crash.

Phase 1 must inspect the actual `SecureStorage` port, web IndexedDB and Android Room transaction boundaries, then document tradeoffs and obtain approval before production changes. Phase 0 records current behavior at CP1–CP6 only.
