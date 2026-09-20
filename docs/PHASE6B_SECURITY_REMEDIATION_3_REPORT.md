# Phase 6B Security Remediation 3 Report

## Scope

This remediation hardens lifecycle state integrity and the existing local
persistence boundary. It does not change Vodozemac, CryptoSession internals,
messaging, mailbox, attachments, media, calls, recovery, or introduce a
database.

## Implemented protections

- Every lifecycle read validates the device-list schema and recomputes the
  canonical SHA-256 commitment. A mismatch fails closed.
- Persisted records now include a version, highest accepted epoch, bounded
  commitment history, and authorization records.
- Lifecycle writes validate the expected epoch and previous commitment, require
  the next list to be exactly the next epoch, recompute the next commitment,
  reject duplicate transaction nonces, and verify the persisted record after
  writing.
- A process-local per-scope mutex serializes concurrent writers. Stale writers
  fail compare-and-swap checks rather than overwriting a newer mutation.
- A separate encrypted high-water record rejects restoration of an older valid
  lifecycle record after a newer epoch has been accepted. If the high-water
  record is missing or inconsistent, the adapter fails closed or establishes it
  only during explicit initialization migration.
- Same-epoch divergent device lists are rejected by `assertNotRollback`.
- A failed write leaves the prior record available; if a storage backend reports
  an ambiguous partial write, subsequent commitment/high-water validation fails
  closed rather than trusting uncertain state.

## Attack tests

Added tests for:

- modified stored commitment;
- corrupted lifecycle record;
- concurrent duplicate/stale writers;
- rollback of an older record against the high-water mark;
- same-epoch device-list forks;
- simulated partial write failure and recovery of the prior state.

## Boundary and limitations

The local adapter can serialize writers within the process and provides an
explicit CAS-style expected epoch/commitment boundary. A production deployment
with multiple browser processes, workers, or hosts still requires a shared
transactional adapter with atomic compare-and-swap, uniqueness constraints, and
durable high-water storage. No fake database implementation was added.

## Validation

Validated with npm clean-install dependencies, full Jest, service TypeScript,
ESLint, client production build, npm audit, and `git diff --check`.

