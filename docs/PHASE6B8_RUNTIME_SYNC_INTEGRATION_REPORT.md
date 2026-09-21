# Phase 6B.8 Runtime Synchronization Integration Report

## Scope

This milestone connects the approved synchronization domain to the modern conversation runtime. It does not change Vodozemac, `CryptoSession`, message/mailbox encryption, attachment encryption, media encryption, or call encryption.

## Runtime composition

The runtime path is:

`ModernConversation` → current `DeviceTrustEnforcer` state → `RuntimeSyncController` → `SyncTransferController`.

`ModernConversation.createSyncController()` first requires a current trusted device, a ready modern identity, and an authenticated conversation context. Legacy conversations do not expose this boundary. The controller is scoped to the local identity/device and rejects authorizations addressed to another scope or device.

## Trust and integrity enforcement

Before authorization, the controller checks the current trust snapshot and epoch. Transfer acceptance re-checks trust, scope, sender/receiver identity references, transfer identity, checkpoint epoch/commitment, sequence handling, and payload integrity. Unknown or stale trust state fails closed. A duplicate sequence is idempotent only when its digest matches; a conflicting sequence suspends the transfer.

## Persistence boundary

`SyncPersistence` is an explicit adapter interface for durable checkpoints and replay claims. The runtime does not provide a fake database or server implementation. A production adapter must provide atomic replay claims, durable checkpoints, TTL/cleanup, and shared state across instances. The in-memory test adapter is limited to tests.

## Recovery and conflict behavior

Checkpoint writes occur after an accepted package, allowing restart recovery from the last durable checkpoint. Replay claims reject repeated packages. The existing fencing/conflict domain remains the source of truth for membership conflicts; a conflict suspends synchronization and requires explicit resolution rather than silent merge or last-writer-wins behavior.

## Validation

The runtime boundary has regression coverage for target binding, trust checks, durable checkpoint writes, and replay rejection. Full repository validation is run with the milestone commit and recorded in the final task report.

## Limitations and follow-up

- No production network route or database adapter is introduced here.
- No server-side master sync key or plaintext state path exists.
- UI, transport wiring, and record-specific import/export remain future integration work.
- Crash recovery guarantees depend on a production `SyncPersistence` implementation providing atomic durable operations.
