# Phase 6B.8A Authenticated Sync Transport and Admission

## Implemented boundary

Sync traffic now has an explicit `AuthenticatedSyncTransport` boundary. It encrypts sync packages through the supplied existing `CryptoSession` signaling channel and binds the decoded package to a pre-established session binding, local identity, peer identity, peer device, scope, and expected receiver. Sender and receiver identity fields are checked against the authenticated binding; they are not accepted as authority by themselves.

`RuntimeSyncController` now requires an explicit admission sequence: authorization → PREPARE → PREPARED → READY → TRANSFER. Transfer packages are rejected unless the current lifecycle trust, epoch, commitment, target, and admission state remain valid.

## Security behavior

- Fake sender, wrong peer/device, unknown or unavailable session, revoked trust, stale epoch, and mismatched commitment fail closed.
- Existing CryptoSession and Vodozemac implementations are unchanged.
- Replay claims remain delegated to the persistence boundary; production adapters must make claims atomic and durable.
- The controller still does not provide a production database, network router, record importer, or full fixed-membership all-to-all admission implementation. Those remain explicit integration requirements for the next runtime milestone.

## Validation

Tests cover authenticated identity binding, wrong-session rejection, revoked/stale trust rejection, admission ordering, and replayed authenticated frames. Repository Jest, TypeScript, ESLint, client build, npm audit, and diff-check validation are run for this commit.
