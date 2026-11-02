# M1a security hotfix: Render cutover checklist

Owner-operated. Nothing here authorizes a push, deploy, variable change or DB operation by an agent.
Candidate: branch `m1a/security-fixes` (5 fix commits on `release/beta-baseline` `cc10a86a`).

## 0. Read first: this is not a 5-commit hotfix if production runs 871fa99

`m1a/security-fixes` sits on the web release line, **58 commits ahead of `871fa99`** (the last
owner-confirmed live SHA). Six of those commits add durable-routing code. If production is
still on `871fa99`, this deploy ships all of that too. `backend/db/migrations.ts` is unchanged
since `871fa99`, so no new index or migration is required.

Decide before the window:
- Live SHA is `0cb64866` or a descendant on this line: this is a small hotfix. Continue.
- Live SHA is `871fa99`: this is the full web release line. Continue only if you accept that,
  and follow `docs/RENDER_FREE_MAILBOX_CUTOVER.md` in full.
- Live SHA is anything else: stop and ask.

## 1. On Render, before the window (record, change nothing)

- [ ] Live deployed commit SHA (Deploys page). Write it down: it is your rollback target.
- [ ] Linked branch, **Auto-Deploy: Off**, instance count **1**.
- [ ] Build command: `npm ci --include=dev && npm run client:build && npm run build-service-sdk && npm run build:backend`
- [ ] Start command: `npm run serve`. Health check path `/api/health`.
- [ ] Environment (presence and shape only; never paste values anywhere):

| Variable | Required |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI`, `MONGO_DB_NAME` | set (Atlas) |
| `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` | set, at least 32 chars, **unchanged** (changing it invalidates every device proof) |
| `K3NCRYPT_ALLOWED_ORIGINS` | `https://…` origin(s) only |
| `CHAT_LINK_DOMAIN` | `https://…` |
| `K3NCRYPT_TRUST_PROXY` | `true` |
| `K3NCRYPT_INSTANCE_COUNT` | unset or `1` |
| `CHATE2EE_ENABLE_DEBUG_LOGS` | unset or `false` |
| `K3NCRYPT_MUX_MESSAGE_DELIVERY`, `K3NCRYPT_MUX_PRODUCTION_OPT_IN` | unset (mux stays off) |
| `K3NCRYPT_DURABLE_ROUTING` | **record the current value and do not change it in this deploy** |
| `K3NCRYPT_MAINTENANCE_MODE` | `false` or unset before the window |

- [ ] Encrypted backup exists and an isolated restore of it was readable (Atlas Free has no
      managed backups). Without this, do not continue.

## 2. Cutover

1. Set `K3NCRYPT_MAINTENANCE_MODE=true` and manually deploy the exact candidate SHA in the
   same action.
2. Confirm on Render that the deployed SHA equals the candidate SHA.
3. `curl -fsS https://<origin>/api/health` and `/api/ready` both return 200. API calls return
   503 while the gate is on.
4. Set `K3NCRYPT_MAINTENANCE_MODE=false` and redeploy the **same** SHA.
5. Confirm the SHA again, then run the smoke tests.

## 3. Smoke tests (two disposable accounts, two separate browsers or profiles)

- [ ] `/api/health` and `/api/ready`: 200.
- [ ] A creates an account, B joins A's invitation; both see each other.
- [ ] A and B exchange a text message both ways.
- [ ] B closes the tab, A sends a message, B reopens and unlocks: message arrives (offline delivery).
- [ ] **P0-1:** A verifies B, B does **not** verify A. A sends a small file. B's file card reads
      "Verify this contact to open files." with no download button. B verifies A, then the file opens.
      The save link is titled "Save file".
- [ ] **Passphrase:** reload B (locked), choose "I have an invitation", paste a new invitation from A,
      press Continue with an empty passphrase: "Enter the passphrase you already use to unlock this
      device." Wrong passphrase: "That passphrase did not unlock this device…". Correct: it joins.
- [ ] Audio call A↔B after both verified (if both on the same network).
- [ ] Render logs: no `startup_failed`, no `unhandled_rejection`, no restart loop.

Stop and roll back on: unexpected 403/503 after the gate is off, messages stuck as queued,
any crash or restart loop.

The P1-1 crash fix is proven locally with a hostile packet. Do not send hostile packets to
production unless the deployed SHA is confirmed; on an old SHA it takes the service down.

## 4. Rollback

- M1a adds **no** schema change, migration or stored-format change visible to the server. The
  only new local data is a client-side outbox marker that older clients ignore.
- Rollback = set `K3NCRYPT_MAINTENANCE_MODE=true`, manually deploy the SHA recorded in step 1,
  confirm health/ready, then set maintenance `false` and redeploy that same SHA.
- If production was on `871fa99` **and** `K3NCRYPT_DURABLE_ROUTING` was turned on at any point
  after this deploy, do **not** roll back to `871fa99` (it ignores durable ownership). Stay in
  maintenance and ask. See `docs/validation/FINAL_WEB_OWNER_GUIDE.md`, "Rollback boundaries".
- Never restore or delete database contents to undo a deploy.

## 5. Android

M1a changes no wire format. Android still needs its own check that it does not open files or
v1 media from unverified contacts.
