# K3NCRYPT $0 Render Free Mailbox Cutover

This is an owner-operated procedure for the existing single Render Free Web Service. It does not authorize a production variable change, deployment, migration, or backup access. Do not use production until the owner approves a maintenance window.

## Findings and guarantees

- Render Free does not provide built-in maintenance mode, pre-deploy commands, one-off jobs, SSH, or scaling beyond one configured instance. Deploys still use Render's zero-downtime replacement flow: the new process starts beside the old one; once healthy, traffic switches; 60 seconds later Render sends `SIGTERM` to the old process, followed by `SIGKILL` if its shutdown delay expires. Existing WebSockets stay attached to their original process until it terminates.
- The public custom domain and the service's direct `onrender.com` hostname both reach the same service. The app gate is therefore needed at the application boundary; an external domain-only block would miss direct-origin traffic.
- Production startup connects to Mongo and opens all three Socket.IO servers, but does not run migrations. Offline-mailbox store/claim/ACK/reject/expiry cleanup is invoked by request/socket handlers. No production mailbox background worker was found. The migration is a separate `npm run migrate` command.
- The gate in this candidate blocks every HTTP method/path except `GET`/`HEAD /api/health` and `/api/ready`, rejects all three Socket.IO Engine.IO admissions, and has a per-event guard for already connected sockets. A malformed configured value fails closed. Do not start migration until Render proves the old ungated process is gone; its already-open sockets can keep writing until then.
- During Render's replacement window, old and new processes coexist. The bridge deployment intentionally occurs before migration: the old process remains the only write-capable process until it is terminated, and the bridge accepts only probes. For the post-migration candidate deployment, both the bridge and candidate must be gate-on; thus neither can write during their overlap. This prevents concurrent schema writers but is not a literal single-process transition.
- `$0` is feasible only if the existing Render Free service permits manual deploys of the exact source commits and the owner can run the migration from a controlled local checkout. If Render's actual settings prevent this, stop. Do not add another service or upgrade a plan.

Official Render references: [Free service limitations](https://render.com/docs/free), [deploy sequence and pre-deploy availability](https://render.com/docs/deploys), [WebSocket shutdown behavior](https://render.com/docs/websocket), and [one-off jobs](https://render.com/docs/one-off-jobs).

## Artifacts to prepare before the window

1. Select and review the local compatibility-bridge commit based on the currently deployed `33677df` and the exact upgraded candidate commit containing this gate. Build and test both. Do not substitute branch tips after recording their SHAs.
2. Ensure Render Auto-Deploy stays Off. Record the existing service ID, custom hostname, direct `onrender.com` hostname, current deploy ID/SHA, configured instance count (one), build/start commands, health path, and environment variable names without copying secret values.
3. Owner verifies the already-created encrypted backup is still available and that its isolated restore is readable, has the expected records/indexes, and can be recovered. Keep the recovery destination isolated. No fresh production backup, restore, or production inspection is performed by this procedure until the maintenance gate is verified.
4. Confirm the local operator machine has the reviewed candidate checkout, Node/npm dependencies, and a secure way to supply the production Mongo URI and database name only to the migration process. Never paste or log those values. The migration command sets `NODE_ENV=production`; run it from the exact candidate checkout after `npm run build:backend`.
5. Record pre-migration safe counts/index metadata through the owner's secure Mongo client. Do not export or inspect message envelopes. Require no active-slot duplicates/malformed active rows and an available, tested recovery point.

## Cutover sequence

### A. Deploy and verify the compatibility bridge

1. In Render, reconfirm the exact old deployed SHA is `33677df` (full SHA and deploy ID from Render, not `/api/health`), Auto-Deploy Off, one configured instance, and no other serving backend. Stop on mismatch.
2. Set `K3NCRYPT_MAINTENANCE_MODE=true` in the existing Render service and manually deploy the reviewed bridge SHA in the same deployment action. Do not trigger a separate restart/deploy of `33677df` after changing the variable; that old code does not contain the gate. Do not alter Mux variables. The bridge must build/start successfully and `/api/health` plus `/api/ready` must return 200; these probes remain allowed during maintenance.
3. New requests are routed to the bridge after health succeeds. The old instance may still handle sockets already attached to it during Render's documented 60-second drain and shutdown delay. **Do not start the migration during this period.** Wait for Render to mark the old instance/process terminated and the bridge as the sole live process. If Render does not provide evidence of termination, NO-GO.
4. Verify through both the custom hostname and direct `onrender.com` hostname:
   - `GET /api/health` and `/api/ready` return 200;
   - `POST /api/...`, `OPTIONS`, and `GET /` return 503 with `Retry-After: 60`;
   - Socket.IO handshakes to `/socket.io`, `/sync/socket.io`, and `/private-network/socket.io` fail;
   - a disposable socket connected before cutover is disconnected when its old process terminates. A socket still working on the bridge is a stop condition.
5. Keep the exact maintenance variable set. The bridge only permits diagnostics. No HTTP/API, mailbox, call-signaling, sync, or private-network socket operation is accepted.

### B. Backup, migrate, and reconcile

6. With the bridge as the only live process and both hostnames still gated, take a fresh encrypted production backup using the already approved owner process. Verify the backup can be opened and restored to an isolated database; reconcile the expected database identity, mailbox record counts, and indexes there. A previous synthetic migration rehearsal or earlier backup is not a substitute for this fresh pre-cutover recovery point.
7. Confirm the same backup/recovery proof and preflight conditions again. If a restore cannot be verified, stop with the bridge gate left active.
8. From the reviewed upgraded-candidate checkout at its exact SHA, run `npm ci --include=dev` if needed and `npm run build:backend`. Then, in a secure shell that supplies `MONGO_URI` and `MONGO_DB_NAME` without echoing them, run exactly `npm run migrate`. This local process connects to production only to perform the owner-approved migration. Do not run that command from the bridge checkout or against a guessed database. Render Free has no supported pre-deploy command or one-off job.
9. Require a successful exit. Verify (without reading documents) the `offline_messages` index `channel_1_mailbox_1_slot_1` is unique on `{ channel: 1, mailbox: 1, slot: 1 }` with exact partial filter `{ state: "active" }`; verify other readiness-required indexes, including the `file_ledgers_v2` transfer index. Reconcile pre/post counts and the safe row identifiers/checksums. If any check fails, leave maintenance on; do not start the candidate.

### C. Deploy the upgraded candidate while still gated

10. Confirm `K3NCRYPT_MAINTENANCE_MODE=true`, Mux remains disabled on both server and built Web client, Auto-Deploy Off, one configured instance, and the intended candidate SHA is exact. Manually deploy that upgraded SHA to the same Render service.
11. Require candidate build success, `/api/health` and `/api/ready` HTTP 200, and sanitized startup logs showing the expected relay-ready events. Keep the gate active. Wait until Render confirms the old bridge process is fully terminated. During replacement both processes must be gate-on; if either accepts a write, STOP and restore/forward-repair under maintenance.
12. Re-run the two-hostname checks from step 4 against the candidate. Confirm the direct hostname does not bypass the gate. Confirm one live service process remains.

### D. Release maintenance and acceptance

13. For the release, change `K3NCRYPT_MAINTENANCE_MODE` to exact `false` (or unset it) in Render. This causes another replacement. The currently running candidate remains gate-on until the replacement is healthy; the new candidate receives traffic only after it starts with the gate off. The old gated process remains non-write-capable during Render's 60-second drain. Wait for its termination and confirm exactly one live process.
14. Verify `/api/health` and `/api/ready` are HTTP 200; confirm Render reports the exact candidate SHA/deploy ID; confirm production Mux remains disabled unless separately approved (this task does not enable it).
15. Run the Alice/Bob/Carol checks below with disposable identities. Resume only if no unexpected duplicate, message loss, unauthorized delivery, readiness failure, or device-trust failure appears.

## Failure and rollback

- Before migration: failed deploy, health failure, failed gate probe, or uncertain old-process termination means keep/restore maintenance mode and stop. The live database schema is still old; if the bridge is unhealthy, Render rollback to `33677df` is only a recovery action before any migration starts.
- During migration: keep maintenance active. If the command exits unsuccessfully, inspect only sanitized error category and index metadata. The migration backfill/index replacement has no verified down migration. Correct the cause and rerun the idempotent migration from the reviewed candidate, or restore the verified pre-migration backup. Do not open writes while the partial unique index is absent.
- After migration, application rollback to `33677df` is **not an automatic safe rollback**: reverting code does not undo the `state: active` backfill or restore the previous slot-index semantics. Keep the gate active until the owner chooses a tested schema-compatible code release, a safe forward repair, or the verified backup restore. Restoring the backup loses writes since the backup, so reconcile that explicitly before opening traffic.
- Candidate failure after migration: keep the gate on. Do not set it false to “see if it works.” Use the exact compatibility/schema assessment plus readiness/index checks. If neither candidate nor recovery can be proven safe, remain in maintenance and stop.
- Never enable production Mux as part of rollback unless all four server/client flags are intentionally changed together in a separate authorized action.

## Alice/Bob/Carol acceptance

With three independent disposable browser profiles:

1. Create/unlock accounts; compare identity fingerprints over a separate trusted channel; explicitly verify contacts. Verify an unverified peer is denied where required.
2. Alice opens Bob and Carol, leaves Carol selected; Bob sends Alice encrypted text. Confirm the encrypted message appears once in Bob's conversation and Carol stays selected; reply both directions.
3. Disconnect Alice; Bob sends; reconnect/reopen Bob and confirm one replay/acceptance. Refresh and restart Alice's browser, unlock, reopen and confirm history and deduplication.
4. Send a small encrypted attachment each way, download it, and compare local SHA-256. Do not place file contents in logs.
5. Revoke a disposable device; confirm it cannot reconnect/subscribe or receive new content and an independently authorized device remains usable.
6. Test audio/video only in an actively open room where call UI is implemented. Check accept, decline, caller cancel, hangup, cleanup, and second call. Calls for unopened background rooms, push notifications, and background calling are not supported.
7. Record user-visible status and safe failure categories only. Never capture plaintext, ciphertext, tokens, Mongo URI, private keys, or raw ICE candidates.

## Go/no-go

**GO only after** exact SHA/deploy IDs, one configured service instance, bridge termination evidence, maintenance probes through both hostnames, fresh backup plus isolated restore proof, successful migration, required index and data reconciliation, gated candidate verification, old-process termination, gate release verification, `/api/ready` HTTP 200, and Alice/Bob/Carol acceptance all pass. Any missing item is NO-GO. This engineering task does not perform or authorize those production actions.
