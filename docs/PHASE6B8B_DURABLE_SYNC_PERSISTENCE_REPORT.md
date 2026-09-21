# Phase 6B.8B Durable Sync Persistence and Crash Recovery

## Implemented boundary

The sync runtime now exposes durable persistence contracts for checkpoints, admission/transfer state, received sequence progress, terminal status, and atomic transaction operations. `SyncPersistence.transaction()` is a compare-and-swap style adapter boundary; production implementations must provide serializable transactions, uniqueness for replay claims, and durable recovery across processes. No database implementation is included.

Replay claims are performed inside the same transaction that records the validated checkpoint/state update. Duplicate claims therefore cannot be separated from the associated state transition by a process crash.

## Recovery model

The durable state record captures the current admission phase, checkpoint, received sequences, and terminal outcome. A restart can restore this record through `readState`; an adapter must resume only from verified durable evidence and otherwise suspend. Stale expected checkpoints are rejected by the transaction boundary. Completion and failure are terminal records and must not be reopened.

## Validation

Coverage includes durable state recording, atomic replay-claim usage, duplicate replay rejection, admission sequencing, authenticated session identity binding, stale epoch/commitment rejection, and wrong-session rejection. Full repository validation is run for the milestone.

## Deployment requirements

The repository intentionally does not ship a fake production store. Deployment must supply a durable adapter implementing atomic compare-and-swap, transaction recovery, bounded replay/tombstone retention, concurrent-writer rejection, corruption detection, and multi-instance consistency.
