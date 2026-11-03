# Release candidate 1: deploy `m3/hardening` to Render

Owner-operated. No agent pushes, migrates, deploys or changes Render settings.

**Candidate:** the head of `m3/hardening` (this document's commit). Record it before you start:

```bash
git -C ~/Documents/ChatGPT/chatapp-phase0 rev-parse m3/hardening
```

**Live today:** `f927941` (= `f868cd5` + relay-crash fix + device clock tolerance). Rollback target.
**Delta:** 49 commits on top of `f927941`. `f927941` is an ancestor, so `main` fast-forwards (no force-push).

## What ships

| Milestone | User-visible change |
|---|---|
| M1a | Relay no longer crashes on a non-function ack. Files and legacy media need a checked contact. Clear error for a wrong passphrase on a locked profile. |
| M1c | Plain-language contact check (scan / compare numbers / Android path). One connection status. Contacts grouped. Own invitations only on the Invite screen. Chats open in review mode after a number change. |
| M1b | Transfer metadata expires (Mongo TTL on `purgeAt`). |
| M2 | File requests time out after 60 s (no stuck "Sending"). |
| M3 | Rate limits (API 300 per 5 min; socket join/replay/ack limits; 10 sockets per device and 64 per IP). Storage caps with a "full" message. Start-up fails closed without `K3NCRYPT_DURABLE_ROUTING`. Calls end when this device loses trust. HSTS and COOP headers. Host-trust disclosure in Settings → About security. Crypto WASM rebuilt reproducibly. |

No wire-format change between `f927941` and this candidate. No new required environment variable: `K3NCRYPT_DURABLE_ROUTING=true` and `K3NCRYPT_TRUST_PROXY=true` are already required by `f927941`.

## Test evidence for this candidate

Run on 2026-11-03 against `0a15b9f9` (the WASM replacement; this document adds no code). Local Mac, arm64, Docker Mongo 8.0, Chromium.

| Suite | Command | Result |
|---|---|---|
| Unit (Jest) | `npm test` | **1196 passed**, 0 failed, 78 skipped (the Mongo-gated suites below) [unit test] |
| Mongo integration | `bash scripts/test-mongo.sh` | **78/78 passed** (17 + 8 + 27 + 21 + 2 + 3) [integration test] |
| Production stage | `bash scripts/prod-stage.sh npx playwright test -c playwright.prod-stage.config.ts` | **1/1 passed**: production build behind HTTPS, message, photo and call, all headers, zero CSP violations [local browser run] |
| E2E, one full pass | `K3NCRYPT_M0_OUT=test-results/rc1 bash scripts/m0-e2e.sh` (35 specs, 14 min) | **51 passed, 7 failed, 22 skipped** [two-browser E2E] |
| Crypto WASM | `bash scripts/build-wasm.sh` | all four files `same` (3 independent runs) |

**The full E2E pass is not green.** The 7 failures, re-run individually right after the full pass:

| Spec | Full pass | Re-run alone | Verdict |
|---|---|---|---|
| `call-after-switch`, `call-history`, `call-usability` | fail: caller stays "Ringing..." after accept (20 s timeout) | pass | Flaky under a long sequential run. `first-call` and the production-stage call passed in the same session. Not a release blocker, but not understood yet. |
| `check-contact` | fail: wrong-code warning not shown in the scan test | pass (4/4) | Flaky. Same caveat. |
| `composer-persistence` | fail | fail | Known and accepted (remount; UX milestone). |
| `conversation-persistence-mux` | fail | pass with `PLAYWRIGHT_MUX_STAGE1=true` | Needs the mux flag; the default runner does not set it. Mux is off in production. |
| `mux-stage1b` | fail | fail, also with the mux flag ("Download protected file" missing in Carol's room) | Known gap, recorded in `docs/CONVERSATION_PERSISTENCE_REPAIR_ACCEPTANCE.md`. Mux is off in production. |

The 22 skips are opt-in suites the default runner does not enable: `routing-lifecycle` 9, `phase37-staging` 3, `phase4b-staging` 3, `file-timing` 3, `file-stability` 1, `phase4c-file-feedback` 1, `mux-stage1b-ack-security` 1, `security-panels` 1.

**Rehearsed locally:** every Docker command in steps 2–4 (dump, count, restore, count diff, `npm run migrate` twice, index check) was run against a throwaway local `mongo:8` standing in for production. All gave the expected output. Not rehearsed: a real Atlas `mongodb+srv://` URI and Atlas Free speed.

## Order of operations

Do these in order. Each step has a stop condition. Steps 1–4 happen with production in maintenance mode, so nothing is written between the backup and the migration.

0. Gate
1. Maintenance on (still `f927941`)
2. Backup
3. Verify the backup and rehearse the migration locally
4. Migrate production
5. Push
6. Deploy the candidate (maintenance still on)
7. Maintenance off
8. Smoke tests

Expected total: about 45–60 minutes, most of it the local check and the two Render deploys.

## 0. Gate

- [ ] Render's deployed commit is exactly `f927941`. Anything else: stop.
- [ ] Auto-Deploy is Off. One instance.
- [ ] Render's Build Command is `npm ci --include=dev && npm run client:build && npm run build-service-sdk && npm run build:backend` and the Start Command is `npm run serve`.
- [ ] Docker Desktop is running on your Mac. Your current public IP is on the Atlas **Network Access** list (the backup and the migration connect from your Mac).
- [ ] You have the production `MONGO_URI` and `MONGO_DB_NAME` (Render → Environment). Do not paste them into a file, a chat or a command line.
- [ ] Never deploy `871fa99` or older.

## 1. Maintenance on

`f927941` already contains the maintenance gate (`K3NCRYPT_MAINTENANCE_MODE`).

1. In Render → Environment, set `K3NCRYPT_MAINTENANCE_MODE=true` and save without deploying.
2. Manual Deploy → Deploy a specific commit → `f927941`.
3. Wait until the deploy is live and Render shows the old instance has stopped.
4. Check:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<origin>/api/health
   ```

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<origin>/api/ready
   ```

   ```bash
   curl -sS -i https://<origin>/ | head -12
   ```

   Expected: `200`, `200`, then `HTTP/2 503` with `retry-after: 60` and `{"error":"maintenance"}`. The gate runs before the static client, so every path except the two probes gives 503. Anything else: stop and set the variable back.

## 2. Backup (free, from your Mac)

The dump holds encrypted envelopes, public keys and device records. Keep it on your Mac only, outside the repository.

Open a new terminal tab for steps 2–4 and close it when done. `read -s` keeps the URI out of shell history, out of `ps` and off the screen. `docker run -e NAME` (no `=value`) passes the variable from your shell without writing it on the command line.

```bash
mkdir -p ~/k3ncrypt-backups && chmod 700 ~/k3ncrypt-backups
```

```bash
printf 'Production MONGO_URI: '; read -rs MONGO_URI; echo; export MONGO_URI
```

```bash
printf 'Production MONGO_DB_NAME: '; read -r MONGO_DB_NAME; export MONGO_DB_NAME
```

```bash
export STAMP=$(date -u +%Y%m%dT%H%M%SZ); echo "$STAMP"
```

Dump (Atlas Free M0 supports `mongodump`; a 512 MB database takes about 1–5 minutes):

```bash
docker run --rm -e MONGO_URI -e MONGO_DB_NAME -e STAMP -v "$HOME/k3ncrypt-backups:/backup" mongo:8 \
  sh -c 'mongodump --uri="$MONGO_URI" --db="$MONGO_DB_NAME" --gzip --archive="/backup/k3ncrypt-$STAMP.archive.gz"'
```

If `mongodump` reports a conflict between `--db` and the database in the URI, run it again without `--db="$MONGO_DB_NAME"`.

Expected: one `done dumping <db>.<collection> (N documents)` line per collection and exit code 0. Then record the size and checksum:

```bash
ls -lh ~/k3ncrypt-backups/k3ncrypt-$STAMP.archive.gz && shasum -a 256 ~/k3ncrypt-backups/k3ncrypt-$STAMP.archive.gz
```

Record the production document counts. Maintenance is on, so they must match the dump exactly:

```bash
docker run --rm -e MONGO_URI -e MONGO_DB_NAME mongo:8 sh -c 'mongosh "$MONGO_URI" --quiet --eval "
  const d = db.getSiblingDB(process.env.MONGO_DB_NAME);
  d.getCollectionNames().sort().forEach((c) => print(c, d.getCollection(c).countDocuments({})));
"' | tee ~/k3ncrypt-backups/counts-production-$STAMP.txt
```

## 3. Verify the backup and rehearse the migration locally

### 3a. Restore into a local Docker Mongo

```bash
docker run -d --name k3n-restore -p 127.0.0.1:27217:27017 -v "$HOME/k3ncrypt-backups:/backup:ro" mongo:8
```

```bash
sleep 5; docker exec -e STAMP k3n-restore sh -c 'mongorestore --gzip --archive="/backup/k3ncrypt-$STAMP.archive.gz"'
```

Expected: `N document(s) restored successfully. 0 document(s) failed to restore.`

### 3b. Compare counts

```bash
docker exec -e MONGO_DB_NAME k3n-restore mongosh --quiet --eval "
  const d = db.getSiblingDB(process.env.MONGO_DB_NAME);
  d.getCollectionNames().sort().forEach((c) => print(c, d.getCollection(c).countDocuments({})));
" | tee ~/k3ncrypt-backups/counts-restore-$STAMP.txt
```

```bash
diff ~/k3ncrypt-backups/counts-production-$STAMP.txt ~/k3ncrypt-backups/counts-restore-$STAMP.txt && echo "BACKUP MATCHES"
```

Mongo's TTL monitor keeps deleting expired rows during maintenance (`prekey_bundles`, `offline_messages`, `device_proof_nonces`), so those three counts can drop slightly between the dump and the count. A difference only there, and only downwards in production, is expected. Any other difference, or no `BACKUP MATCHES` for other collections: stop. Production stays in maintenance on `f927941`, which is safe; take a new dump.

### 3c. Build the candidate in a clean worktree

A fresh worktree has no `.env`, so nothing local can override the production values.

```bash
git -C ~/Documents/ChatGPT/chatapp-phase0 worktree add --detach /tmp/k3n-rc1 m3/hardening
```

```bash
cd /tmp/k3n-rc1 && git rev-parse HEAD && npm ci --include=dev && npm run build:backend
```

The printed SHA must be the candidate you recorded at the top.

### 3d. Rehearse the migration on the restored copy

Run it in a subshell, so the local URI never replaces the production one in your shell:

```bash
cd /tmp/k3n-rc1 && ( export MONGO_URI='mongodb://127.0.0.1:27217/?directConnection=true'; time npm run migrate )
```

Expected: `K3NCRYPT migrations applied successfully.` and exit code 0. The `time` line tells you how long production will take; on Atlas Free expect it to take a few times longer than on your Mac. Run it a second time: it must succeed again (the migration is idempotent).

Then run the index check from step 4c against the local copy, by replacing `"$MONGO_URI"` with `'mongodb://127.0.0.1:27217/?directConnection=true'`. Expected: `ALL REQUIRED INDEXES PRESENT`.

Any failure: stop. Production is untouched and still in maintenance.

## 4. Migrate production

### 4a. What it changes

`npm run migrate` (`scripts/migrate.ts` → `backend/db/migrations.ts`) is additive and idempotent. Compared with what `f927941` needs, it:

- **Creates one index:** `offline_messages` `senderDevice_1_state_1` (partial: `senderDevice` exists), used by the per-device storage cap.
- **Backfills `purgeAt`** on existing rows that lack it:
  - `file_ledgers_v2`: latest transfer expiry + 1 day, capped at now + 7 days; **now** if the ledger has no transfers.
  - `attachment_metadata`: the earlier of `expiresAt` + 1 day and `createdAt` + 7 days.
  - `attachment_chunks`: `storedAt` + 7 days.
  - `attachment_access`: now + 7 days.
- **Creates four TTL indexes** `purgeAt_1` (`expireAfterSeconds: 0`) on those four collections.
- Re-applies every older index (no-ops if they already exist).

**Retention deletes.** Mongo's TTL monitor runs every 60 seconds. Within a few minutes of the migration it **permanently deletes** every row above whose `purgeAt` is already in the past: empty file ledgers, ledgers whose transfers expired more than a day ago, expired attachment metadata, and chunks stored more than 7 days ago. All existing `attachment_access` rows are deleted 7 days from now. The only copy of these rows is the backup from step 2.

No message, contact, room, device or key collection changes, except the new index on `offline_messages`.

Until this runs, the candidate's `/api/ready` returns 503 ("Required database migrations are incomplete"), because readiness checks for `purgeAt_1` and `senderDevice_1_state_1`. Running it while `f927941` is live is safe: `f927941` ignores the new field and indexes.

### 4b. Run it

Use the same terminal tab, where `MONGO_URI` and `MONGO_DB_NAME` are still the production values from step 2:

```bash
cd /tmp/k3n-rc1 && time npm run migrate
```

Expected: `K3NCRYPT migrations applied successfully.` and exit code 0, in under a minute for a database this size (compare with the time from your rehearsal). On failure the script prints only `K3NCRYPT migrations failed.` and exits 1: leave maintenance on, check that your IP is on the Atlas access list and that the URI and database name are right, and run it again. Re-running it is safe. If it still fails, stay in maintenance and stop.

### 4c. Verify

```bash
docker run --rm -e MONGO_URI -e MONGO_DB_NAME mongo:8 sh -c 'mongosh "$MONGO_URI" --quiet --eval "
  const d = db.getSiblingDB(process.env.MONGO_DB_NAME);
  const need = {
    file_ledgers_v2: [\"transfers.context.transferId_1\", \"purgeAt_1\"],
    links: [\"hash_1\"],
    prekey_bundles: [\"expiresAt_1\", \"channel_1_address_1\"],
    offline_messages: [\"expiresAt_1\", \"dedupeKey_1\", \"channel_1_mailbox_1_slot_1\", \"channel_1_mailbox_1_claimedUntil_1_expiresAt_1\", \"senderDevice_1_state_1\"],
    attachment_metadata: [\"id_1\", \"expiresAt_1_status_1\", \"purgeAt_1\"],
    attachment_chunks: [\"attachmentId_1_index_1\", \"attachmentId_1_storedAt_1\", \"purgeAt_1\"],
    attachment_access: [\"attachmentId_1\", \"purgeAt_1\"],
    device_lifecycle: [\"accountIdentityReference_1_deviceId_1\"],
    device_identity_registry: [\"deviceId_1\"],
    device_proof_nonces: [\"proofId_1_deviceId_1\", \"expiresAt_1\"],
    private_network_members: [\"networkId_1_deviceId_1\"],
    private_network_membership_events: [\"eventId_1\"],
  };
  let ok = true;
  for (const [c, names] of Object.entries(need)) {
    const have = new Set(d.getCollection(c).getIndexes().map((i) => i.name));
    const missing = names.filter((n) => !have.has(n));
    if (missing.length) { ok = false; print(\"MISSING\", c, missing.join(\",\")); }
  }
  for (const c of [\"file_ledgers_v2\", \"attachment_metadata\", \"attachment_chunks\", \"attachment_access\"]) {
    print(c, \"rows without purgeAt:\", d.getCollection(c).countDocuments({ purgeAt: { \$exists: false } }),
      \"due for deletion now:\", d.getCollection(c).countDocuments({ purgeAt: { \$lte: new Date() } }));
  }
  print(ok ? \"ALL REQUIRED INDEXES PRESENT\" : \"INDEXES MISSING\");
"'
```

Collection names come from `backend/db/const.ts` and `backend/db/index.ts`. If your deployment overrides them, use those names.

Expected: `ALL REQUIRED INDEXES PRESENT`, and `rows without purgeAt: 0` for all four collections. "Due for deletion now" drops to 0 within a few minutes, once the TTL monitor has run.

Then clear the production values from this tab:

```bash
unset MONGO_URI MONGO_DB_NAME
```

## 5. Push

The repository is public. This publishes M0–M3 (49 commits) on `main`. The old crypto WASM, which embeds the builder's home path, is already public on `main` today; this release replaces it but leaves it in history.

```bash
cd ~/Documents/ChatGPT/chatapp-phase0 && git status --short --branch
```

The tree must be clean and on `m3/hardening`.

```bash
git push origin m3/hardening
```

```bash
git push origin m3/hardening:main
```

The second push is fast-forward only. It is refused if `origin/main` has moved since `f927941`; in that case stop and find out why. Never force-push.

## 6. Deploy the candidate (maintenance still on)

1. Leave `K3NCRYPT_MAINTENANCE_MODE=true`. Check that `K3NCRYPT_DURABLE_ROUTING=true` and `K3NCRYPT_TRUST_PROXY=true` are still set.
2. Manual Deploy → Deploy a specific commit → the candidate SHA.
3. Confirm Render shows exactly that SHA as live and that the `f927941` instance has stopped.
4. Check:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<origin>/api/health
   ```

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<origin>/api/ready
   ```

   ```bash
   curl -sSI https://<origin>/ | grep -iE 'strict-transport-security|cross-origin-opener-policy|content-security-policy'
   ```

   Expected: `200`, `200`, and all three headers. `/api/ready` returning 503 means the indexes are missing: go back to step 4c.
5. Logs: `messaging_relay_ready`, no `startup_failed`, no restart loop.

Note: browsers that receive `Strict-Transport-Security: max-age=31536000; includeSubDomains` remember it for a year. A rollback does not undo that. This is harmless while the origin stays HTTPS-only.

## 7. Maintenance off

1. Set `K3NCRYPT_MAINTENANCE_MODE=false` and save.
2. Manual Deploy → the same candidate SHA. Confirm the SHA again.
3. Run the `curl` checks from step 6 again. `curl -sS -i https://<origin>/ | head -1` must now return 200, not 503.
4. Wait until Render shows the gated instance has stopped.

## 8. Smoke tests on real devices

Use two accounts you control. Tick each item:

**Web ↔ web (two devices or two browsers)**
- [ ] Both accounts open. The connection status shows connected.
- [ ] Text message each way.
- [ ] Close account B, send from A, reopen B: the message arrives.
- [ ] Check the contact (scan the QR, or compare the 30-digit numbers). The contact shows as checked.
- [ ] Send a small file each way between the checked contacts. It finishes (no stuck "Sending").
- [ ] With a new, not-yet-checked contact: file sending is refused with an explanation, not offered.
- [ ] Voice call between the checked contacts, both directions.
- [ ] Settings → About security shows the host-trust note.

**Android (installed build) ↔ web**
- [ ] Existing Android contact: message each way.
- [ ] Set up a new Android device (pending from the hotfix): bootstrap succeeds.
- [ ] Android ↔ web call, if you use calls on Android.
- [ ] Leave the Android app open for 5 minutes with several conversations: nothing shows "Too many connections from this device.", "Too many connections from this network." or "Rate limit exceeded."

**Logs (Render, first hour)**
- [ ] No `startup_failed`, `unhandled_rejection` or restart loop.
- [ ] No repeated "Too many connections from this network." (one IP holding 64 sockets) or `device-socket-limit` join rejections (one device holding 10).
- [ ] No "K3NCRYPT is full right now."

Any failure in messaging, contact checks or start-up: roll back (below). For a failure that only affects files or calls, decide between rolling back and fixing forward.

## Rollback

1. Set `K3NCRYPT_MAINTENANCE_MODE=true`. Manual Deploy → `f927941`. Confirm the SHA, `/api/health` 200, `/api/ready` 200.
2. Set `K3NCRYPT_MAINTENANCE_MODE=false`. Deploy `f927941` again. Confirm the SHA.
3. If `main` was already pushed: Render deploys a specific commit, so `main` can stay where it is. Keep Auto-Deploy Off until a fixed candidate is ready.

**Leave the indexes.** `f927941` ignores `purgeAt_1` and `senderDevice_1_state_1`, and its readiness check does not require them. One caveat: rows `f927941` writes after a rollback have no `purgeAt`, so they never expire. The next `npm run migrate` backfills them.

**Data deleted by retention is not restored by a rollback.** If you need it back, restore those collections from the step 2 archive, with maintenance on (`mongorestore --nsInclude="<db>.<collection>"` to a scratch database first, then copy the rows you need). Never run `mongorestore --drop` against production for the whole database.

Never roll back to `871fa99` or older.

## Older Android builds and the new limits

There is no wire-format change; older Android builds talk to this relay as before. Three server limits are new:

| Limit | Value | What an Android user sees when hit |
|---|---|---|
| Concurrent sockets per proven device | 10 (`MAX_SOCKETS_PER_DEVICE`), checked at `chat-join` after the device proof is verified; the slot is freed on disconnect | Join refused with `{"error":"Too many connections from this device."}` and the socket is closed. Android records it as `join-rejected`. A phone uses at most 8. |
| Concurrent sockets per client IP | 64 (`MAX_SOCKETS_PER_ADDRESS`), checked at connect | Connection refused with `Too many connections from this network.` The Socket.IO JS client does not retry a server-middleware refusal on its own; the Android Java client's behaviour here has not been tested, so that conversation may stay offline until the app reconnects it. |
| `chat-join`, `mailbox-replay` | 10 burst, 1 per second, per socket | Ack `{"error":"Rate limit exceeded."}` with no `status`. Android treats the join as rejected (`join-rejected`) or the replay as not accepted, and retries on its own schedule. |
| `received`, `recipient-rejected` (delivery acks) | 128 burst, 20 per second, per socket | A 64-message replay fits. Android sends `received` without an ack callback, so a limited ack is dropped silently and the server delivers the message again on the next replay. |
| Storage caps | 4,000 waiting envelopes in total; 256 per sending device; 10,000 rooms; 2,000 devices | Send fails with `K3NCRYPT is full right now. Try again later.` Older builds show their generic send-failed state. |

**Socket math.** The newest Android code (`codex/android-beta23-stabilization`) opens one Socket.IO connection for the open conversation and up to 7 more for background conversations: up to 8 per phone, under the per-device cap of 10. A web tab holds one live conversation socket and opens background conversations one at a time. Three phones on one home Wi-Fi use 24 of the 64 per-IP ceiling; `backend/socket.io/deviceSocketLimit.test.ts` admits exactly that (3 devices × 8 room sockets from one IP) and refuses a device its 11th [integration test]. Mobile carriers that put many users behind one IP (CGNAT) share the 64 across strangers. The per-IP count uses the client IP from `X-Forwarded-For` with one trusted proxy (`K3NCRYPT_TRUST_PROXY=true`), the same rule the HTTP rate limiter already uses in production. Sockets on the multiplexed path (off in production) bind their device elsewhere and are bounded only by the per-IP ceiling. If either refusal shows up in the logs during smoke tests, raise the cap in a follow-up release; do not disable it.
