# K3NCRYPT Web Beta: Owner-Operated Single-Instance Release Runbook

This runbook prepares a controlled Render Web Beta upgrade. It does not itself authorize a production deployment, environment change, or migration. The owner/operator performs the production steps and records each result in the release record.

**Render Free cutover addendum:** For the existing Free service, follow [`RENDER_FREE_MAILBOX_CUTOVER.md`](./RENDER_FREE_MAILBOX_CUTOVER.md) for maintenance, process replacement, and migration execution. It supersedes the paid-service Pre-Deploy/upstream-gate procedure below where Free-plan behavior differs. Do not treat Free as having built-in maintenance mode, pre-deploy commands, or one-off jobs.

## Release invariants

- Run exactly one backend instance. Disable autoscaling and prevent old/new backend overlap. Socket registries, room ownership, Mux delivery pumps, and immediate revoked-device eviction are process-local. Mongo leases do not provide cross-instance live routing or immediate remote-worker eviction.
- Never start the upgraded app against a production database until the approved migration has completed and its indexes have been verified.
- The current Mux gates are production-capable but default off. Production requires exact `true` values for both server variables and both Web build variables. Missing, malformed, false, or mismatched values fail closed. This release may be run with Mux disabled; if Mux is intentionally included in the candidate, set the four variables together as described below.
- Keep the legacy messaging path available. A room has one receive owner at a time; ownership conflicts are rejected. There is no silent fallback after failed Mux authorization.
- Never put credentials, Mongo URIs, message contents, ciphertext, attachment contents, or private keys in the release record or logs.

## 1. Select and identify the release candidate

1. In the repository `SHOnnay/k3ncrypt`, check out `integration/main-product`. Record `git rev-parse HEAD`, `git status --short --branch`, and the tested commit. Require a clean tree.
2. Compare local and `origin/integration/main-product`. Synchronize with a normal pull/fast-forward and push only after owner review. Stop if branches diverged or unexpected commits appeared; never force-push. The Render candidate must resolve to this exact reviewed SHA.
3. In Render, identify the existing K3NCRYPT production Web service by its approved service ID and domain. Record those identifiers privately. In the service's deploy details, record the currently deployed commit and deployment ID; do not infer a version from `/api/health` alone.
4. Confirm the configured Build Command is:

   ```sh
   npm ci --include=dev && npm run client:build && npm run build-service-sdk && npm run build:backend
   ```

   Confirm the Start Command is:

   ```sh
   npm run serve
   ```

   `npm run build:backend` creates the production `dist/index.js` expected by `scripts/production.cjs`.
5. Confirm the active deployment reports the selected SHA. Before the release window, check `/api/health` and `/api/ready`; readiness must be HTTP 200. A different or unverifiable running SHA is a stop condition.

## 2. Prove the candidate before touching production data

1. Run the exact candidate's full Jest suite, all 17 release-relevant isolated-Mongo tests listed under **Mongo-gated release tests**, client production build, backend TypeScript build, service SDK build, ESLint, and `git diff --check`.
2. Rehearse the migration and failure/resume path against disposable Mongo only. Run the file-ledger restart test against its dedicated disposable container. Do not point test variables at production.
3. Build the client once with all four Mux variables absent or false and confirm Mux is off. If the proposed rollout includes Mux, separately build/test with the exact four production values and test both mismatch directions. The production browser bundle captures `VITE_` variables at build time; changing only server runtime variables does not change the bundle.
4. Save build logs and test counts with the candidate record. A failing test, an unexplained shutdown warning, or an unaccounted skip blocks the release.

### Mongo-gated release tests

The prior full run had 17 skipped tests in four Mongo-gated suites. The release-verification run for this candidate executed those same suites against a fresh disposable local MongoDB: **17 passed, 0 failed, 0 skipped**. The test server was loopback-only and was destroyed after validation. No production database or credentials were used.

| Suite | Count | Gate | Release treatment |
|---|---:|---|---|
| `backend/db/mongo.integration.test.ts` | 9 | `MONGO_URI` and database name matching the disposable `k3ncrypt_playwright_*` pattern | Must pass before migration. Covers schema/index setup, migration failure/resume, FIFO claims, poison entries, retry/lease expiry, dedupe, and capacity. |
| `backend/security/durableDeviceTrust.mongo.integration.test.ts` | 4 | `MONGO_URI` and `MONGO_DB_NAME` | Must pass before release. Covers durable device enrollment, proof persistence, bootstrap replay, and concurrent bootstrap. |
| `backend/attachments/fileLedger.mongo.test.ts` | 2 | Dedicated `K3NCRYPT_FILE_MONGO_PORT` container | Must pass before release. Covers concurrent quota/index behavior and persistence across a disposable database restart. |
| `backend/privateNetwork/membershipSecurity.mongo.integration.test.ts` | 2 | `MONGO_URI` and `MONGO_DB_NAME` | Must pass before release: `index.ts` initializes this relay and the service SDK exports the private-network surface, even though this task does not expand that feature. |

All 17 cases are release gates for this candidate. Keep using isolated disposable databases/containers and tear them down. The file-ledger test restarts its named disposable container, so use a stable loopback port for the other Mongo suites in the same serial run. Never point test variables at production.

## 3. Prove database recovery and compatibility

Do not assume an Atlas backup, PITR window, or restore capability exists.

1. Before scheduling a migration, the database owner must identify an available backup/recovery point and demonstrate a restore to an isolated database. Verify that the restored `offline_messages` documents and indexes are present and readable by the candidate. Record the recovery point, restore destination identifier, completion time, and verifier without exposing connection details. **No successful isolated restore proof means NO-GO; do not migrate.**
2. Against the verified production target, run a read-only preflight using an approved secure operator session. Confirm target identity through approved metadata, then record only counts and index metadata:
   - `offline_messages` indexes, including key, uniqueness, and `partialFilterExpression`;
   - counts with missing `state`, `state: "active"`, and terminal/rejected states;
   - active-or-missing-state rows with absent `channel`, `mailbox`, or `slot` fields;
   - duplicate `(channel, mailbox, slot)` groups among rows that will be active after backfill;
   - existing `file_ledgers_v2` transfer index and other readiness-critical indexes.
3. Require zero active duplicates and no malformed active rows before proceeding. Resolve any conflict while writes remain live and before the release window. Do not inspect documents or print ciphertext.
4. Record pre-migration mailbox counts and safe row identifiers/checksums sufficient to reconcile the queue after migration. Never record envelope content.

## 4. Quiesce writes and preserve the single-instance boundary

The checked-in runtime is one Node process: `index.ts` connects Mongo, starts the Express app, and attaches the legacy Socket.IO server plus the sync and private-network Socket.IO relays to the same HTTP server. `app.ts` mounts `/api` on that server. The repository has no application maintenance switch and no checked-in Render Blueprint or edge-maintenance configuration. The actual Render service settings and any external proxy were not accessible during this preparation, so their existence and behavior are **owner-verification requirements**.

1. In Render, confirm the existing backend Web Service ID, plan, linked branch, instance count, autoscaling state, health-check path, build/start/pre-deploy commands, and whether a pre-deploy command is available. The current process-local room, socket, Mux pump, and revocation registries require one configured serving instance. Disable autoscaling and automatic deploys for the window.
2. Before the window, identify an already-operating upstream maintenance control that can cover both the custom domain and the direct Render service hostname. It must deny every application write/API path and all three Socket.IO paths (`/socket.io`, `/sync/socket.io`, `/private-network/socket.io`), reject new WebSocket upgrades, and actively terminate existing upgraded/polling sessions. Preserve only the Render health-check path if required. Test the control with disposable browser/API/WebSocket clients before relying on it. A maintenance HTML page or HTTP-only block is insufficient.
3. At the window, enable the tested upstream block. Confirm writes return the maintenance response through every public hostname, new Socket.IO handshakes fail, existing test sockets observe disconnect, and in-flight requests have completed or been terminated. Keep this block in place through migration, deploy, and post-deploy checks.
4. Render's normal zero-downtime deploy keeps the old instance serving while the candidate builds/starts, then sends `SIGTERM` to the old instance after the replacement receives traffic. The paid-service pre-deploy command runs separately while the old instance is still running. Therefore the upstream write/socket gate and verified socket drain are mandatory before a migration in that command; they must remain active until the old instance has stopped. If the service does not provide the required pre-deploy capability or the gate cannot cover the direct origin and terminate existing sockets, stop. Do not substitute a static page, HTTP-only middleware, or an overlapping migration worker.
5. During the final deploy overlap, keep all client ingress closed and verify Render shows exactly one healthy candidate instance and the old instance has terminated before lifting maintenance. If the owner's single-instance policy forbids even a quiesced Render deploy overlap, the currently available repository/Render evidence does not establish a safe procedure; stop and obtain a stop-before-start method before the migration window.

## 5. Run and verify the migration

1. For the existing paid Render Web Service, set the one-time **Pre-Deploy Command** to exactly `npm run migrate` for the reviewed candidate deployment. Render documents that this command runs on a separate instance before the new service instance starts, and that the old service instance continues to serve during that step; this is safe only while the maintenance gate above is proven active and every existing socket has been closed. This makes the migration use the candidate's compiled `dist/scripts/migrate.js` via `scripts/production.cjs` with `NODE_ENV=production`. Verify the command is supported by the actual service plan; if it is not, stop and obtain an approved exact-candidate migration execution method rather than using a stale one-off build. [Render deploy sequence and pre-deploy commands](https://render.com/docs/deploys) · [Render one-off jobs use the service's latest successful build](https://render.com/docs/one-off-jobs).
2. Trigger one reviewed deployment of the exact candidate SHA. Require successful pre-deploy migration completion before the candidate starts. If it fails, keep traffic paused and do not start the upgraded server. Do not launch a second serving backend or an unverified migration process.
3. Wait for successful process completion. Verify `offline_messages` contains a unique index named `channel_1_mailbox_1_slot_1` on `{ channel: 1, mailbox: 1, slot: 1 }` with the exact partial filter `{ state: "active" }`. Verify the required `file_ledgers_v2` index and all readiness-required indexes.
4. Reconcile mailbox counts and safe identifiers/checksums with the preflight. Confirm there are no lost queued rows and no unexpected terminal-state changes. Do not log message contents.

### Migration reversibility

`backend/db/migrations.ts` backfills every row missing `state` to `active`, then may drop the prior slot index before creating the partial unique replacement. The backfill is not automatically reversible because, after new writes, there is no migration marker that distinguishes rows backfilled by this migration from rows that legitimately acquired `state: "active"`. A failure between index drop and create leaves the documents intact but the required index absent. Re-running the idempotent migration after correcting the cause is the supported recovery path.

There is no verified down migration. Reverting application code does not restore the old index or safely undo the backfill. After a successful schema change, application rollback is allowed only if compatibility with the migrated schema was tested; otherwise keep traffic paused and use an approved forward repair or restore the proven pre-migration backup. Never resume writes with the required unique index missing.

## 6. Configure the matched production feature gates

Choose one configuration before building/deploying. Apply the values as one reviewed Render environment change while traffic is paused; rebuild the client and backend after changing them.

**Mux disabled (safest initial legacy smoke):** leave all four variables unset or set all four to exact `false`:

```text
K3NCRYPT_MUX_MESSAGE_DELIVERY=false
K3NCRYPT_MUX_PRODUCTION_OPT_IN=false
VITE_K3NCRYPT_MUX_STAGE1=false
VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN=false
```

**Mux enabled for the controlled candidate:** set all four to exact `true` together:

```text
K3NCRYPT_MUX_MESSAGE_DELIVERY=true
K3NCRYPT_MUX_PRODUCTION_OPT_IN=true
VITE_K3NCRYPT_MUX_STAGE1=true
VITE_K3NCRYPT_MUX_PRODUCTION_OPT_IN=true
```

The first two are server runtime gates. The `VITE_` values are embedded into the production Web build. Never enable only one side. Missing, false, malformed, contradictory, or mismatched values mean NO-GO; Mux will be unavailable and clients do not silently fall back to legacy delivery. A normal code rollback does not clear Render variables; explicitly restore the complete chosen pair set and redeploy a newly built bundle.

## 7. Deploy and verify, without overlapping backends

1. Build and deploy the exact recorded SHA to the existing Render service. Keep the one-instance limit and prevent old/new overlap. Do not create another production service or run the candidate on a second backend.
2. Check the Render deployment ID and deployed SHA. Check `/api/health` and `/api/ready`; require HTTP 200 from both. Review sanitized startup logs for migration/index readiness, `messaging_relay_ready`, and `sync_relay_ready`; omit secrets and user data.
3. While maintenance is still active, run the browser acceptance checklist below with disposable accounts. First verify legacy messaging and encrypted attachment transfer. If the Mux-enabled configuration was selected, verify Mux background delivery and reconnects too. Confirm no duplicate acceptance, dropped queue item, unauthorized delivery, or unexpected loss.
4. Verify voice/video only in an active room. Mux call signals are live-only; durable call invitations/replay for a room that is not open/subscribed are not implemented. Do not claim background calling works.
5. If all checks pass, end maintenance, ask the three testers to reconnect, and observe readiness, reconnect, and safe error categories. Keep the service at exactly one instance.

## 8. Rollback and recovery decision tree

- **Before migration:** any mismatch, failed check, unproven restore, duplicate slot, or unavailable write pause means stop; leave the current deployment and database unchanged.
- **Migration process fails:** keep all writes paused. Verify current index state. Correct the cause and rerun the supported migration to completion, or use the approved recovery point. Do not start application traffic with the partial unique index absent.
- **Migration succeeds but deploy is not healthy:** keep traffic paused. Do not assume reverting application code reverses the schema. Use a tested app/schema compatibility decision; otherwise restore the verified pre-migration recovery point or perform an approved forward repair.
- **Mux-only failure with legacy healthy:** atomically set all four Mux variables to false/unset, rebuild the Web bundle, redeploy one instance, and verify legacy behavior. Do not leave the Web build Mux-on while the server gate is off (or vice versa).
- **Legacy failure, readiness failure, data mismatch, duplicate/lost acceptance, or device-authorization failure:** keep maintenance active, capture sanitized logs and deploy identity, and stop. Do not manually delete, acknowledge, or rewrite mailbox rows as a shortcut.
- Preserve the failed deployment and migration logs. Recovery/restore actions require the database owner's normal incident approval.

## 9. Three-browser acceptance checklist

Use three independent browser profiles and disposable Alice, Bob, and Carol accounts. Use the exact deployed SHA. Record visible state and safe failure categories only; never copy secrets, fingerprints beyond the product's approved compare UI, ciphertext, ICE strings, IP addresses, or media.

1. Create/unlock each account. Exchange identity fingerprints through a separate trusted channel; compare them and explicitly verify each contact. Confirm the UI reports verified only after the user's action.
2. Alice opens Bob and Carol, then selects Carol. Bob sends Alice an encrypted text message. Confirm it is accepted once and appears in Bob's conversation on Alice while Carol remains selected. Reply both directions.
3. Disconnect Alice's browser, send a message from Bob, and confirm the sender shows a durable pending/stored state rather than false acceptance. Reconnect Alice, open Bob, and confirm replay is accepted once. Repeat by closing/restarting Alice's browser. Check no message loss or duplicate history entry.
4. Send a small random file both directions. Download it and compare its SHA-256 with the original. Confirm the filename/content is not exposed in backend diagnostics.
5. Start Alice↔Bob active-room audio and video calls. Check outgoing/ringing, accept, connected media, mute/unmute, camera off/on, hangup and cleanup. Decline and caller-cancel once. Do not test or claim calls reach a closed/non-subscribed background room.
6. Revoke a disposable test device. Confirm that device is disconnected, reconnect/subscription is rejected, and an independently authorized device remains usable. Do not test revocation against a real user's device.
7. Repeat a message after refresh/reconnect. Verify one recipient acceptance, correct sender/room, and preserved encrypted history.

**Implemented in this candidate:** E2EE room messaging, durable mailbox replay, explicit identity verification, durable device authorization/revocation checks, encrypted attachment transfer, exclusive receive ownership, and production Mux gates. Production Mux is optional and remains off unless the coordinated four-variable configuration is selected.

**Not a supported behavior:** durable/background call invitations for unopened rooms, push notifications/background calling, or Mux delivery across multiple backend instances. Do not represent these as working beta features.

## Go/no-go record

Record the candidate SHA, Render service/deployment identity, one-instance proof, backup/isolated-restore evidence, migration/index evidence, exact gate mode, all test/build results, and three-browser acceptance results. A missing item is **NO-GO**. This checklist cannot establish that a backup exists, that Render is currently single-instance, or that production currently runs a particular commit; the operator must provide that evidence during the release window.
