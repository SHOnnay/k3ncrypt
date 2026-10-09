# K3NCRYPT Web Beta: Single-Instance Release Checklist

This checklist describes a controlled release for the current integration line. It does not authorize a deployment, production migration, or production Mux enablement.

## Release constraints

- Run exactly one backend process/instance. Device sockets, room ownership, Mux wakeups, delivery pumps, and immediate revocation eviction use process-local registries. Mongo claim leases protect mailbox rows across workers, but they do not provide cross-instance socket routing or immediate remote-worker eviction.
- Keep production Mux disabled for the current candidate. The current server gate rejects Mux in production and the Web client gate is development-only. Do not set production opt-in variables; production gate support is not part of this candidate.
- Keep the legacy path available. A room has one active delivery owner. A legacy/Mux ownership conflict is rejected; clients do not silently downgrade after a failed Mux authorization. Mixed client versions may use a room sequentially, but not concurrently as competing owners.

## Before a release window

1. Build and validate the exact candidate commit: full Jest, disposable-Mongo integration, client build, backend TypeScript build, service SDK build, ESLint, and `git diff --check`.
2. Confirm the Render service is configured for one instance and will not autoscale or run overlapping old/new workers during the rollout.
3. Take a recoverable production database backup. Verify that the backup can be restored to an isolated database and that the restore includes `offline_messages` records and indexes. Do not send or paste the connection string or backup contents into logs or chat.
4. In a read-only preflight, inspect the `offline_messages` index key and partial filter, count rows without `state`, count active and rejected rows, and check for duplicate `(channel, mailbox, slot)` values among rows that will be active. Confirm the target database by its approved deployment metadata without exposing credentials.
5. Schedule a maintenance window and stop or quiesce message writes before the migration. The migration replaces the old slot index in separate drop/create operations; do not serve the upgraded application while that unique index is absent.

## Migration and rollout

1. With the application quiesced, run the existing `npm run migrate` command against the verified production database. The command is additive/idempotent at the index level and backfills missing mailbox `state` values to `active`; it also performs the other application schema/index setup in `backend/db/migrations.ts`.
2. Verify migration completion and the expected partial unique index on `{ channel: 1, mailbox: 1, slot: 1 }` with `{ state: 'active' }`. Confirm the pre-migration queued-message count and representative record checksums/identifiers remain accounted for. Do not inspect or log ciphertext contents.
3. Deploy the single-instance application with Mux still disabled. Verify `/api/ready`, legacy messaging, and mailbox replay before ending the maintenance window.
4. Observe restart/reconnect behavior. Socket ownership is rebuilt after reconnect; durable messages remain in Mongo and leased claims become available after the lease expires. A reconnect/replay is required to resume work after a process restart.

## Failure and rollback

- If migration fails, stop rollout and keep message writes quiesced. The migration may have backfilled `state` and dropped the old slot index before partial-index creation fails. The rehearsal confirms that this failure path leaves queued and terminal documents intact, but the index is incomplete. Retry the migration to completion after correcting the cause, or restore the pre-migration backup to an isolated/approved target. Do not resume writes with the slot index missing.
- There is no verified automatic down migration. Rolling back after successful schema migration requires a tested compatibility decision and may require a DBA-approved compensating index migration or restoring the pre-migration backup. Do not assume code rollback alone restores the old index semantics.
- If the application rollback is needed, preserve the failed deployment and sanitized logs. Do not delete mailbox records or manually acknowledge them as a recovery shortcut.

## Mux release gate

Mux remains disabled for this release candidate. A future Mux release requires reviewed production opt-in support on both server and client, explicit configuration agreement, production/mismatch/reconnect tests, disposable-Mongo validation, and a controlled single-instance rollout. No production setting should be changed until that work is approved and complete.
