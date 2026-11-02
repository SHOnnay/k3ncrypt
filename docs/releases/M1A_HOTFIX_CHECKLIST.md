# Hotfix: relay crash + device clock tolerance, on top of live production `f868cd5`

Owner-operated. No agent pushes, deploys, merges or changes Render settings.

**Branch:** `hotfix/relay-crash` = `f868cd5` (owner-confirmed live, 2026-11-02) +
- `5660d313` fix(relay): never call client-supplied non-function acks
- `95ec49ce` fix(backend): bound lifecycle clock skew consistently with device proofs (from `0cb64866`)
- `f5fde33f` test: bootstrap accepts a client clock 1–4 s ahead
- plus this checklist.
**Fixes:** (1) one anonymous packet (`emit('chat-message', {}, 'x')`) crashed the relay process; (2) a new device whose clock ran even milliseconds ahead of the server was refused at bootstrap or enrollment. It now gets the same 5-second tolerance signed device proofs already have; expiry, signatures, epochs and replay checks are unchanged.
**Evidence:** cherry-pick of `ebaf53e4` applied cleanly. `ackSafety.test.ts` 24/24 and all backend tests pass [unit test]. On a real server with `K3NCRYPT_DURABLE_ROUTING=true`, the probe kills unpatched `f868cd5` (`TypeError: ack is not a function`) and does not kill this branch, health 200 [integration test]. Clock fix: backend tests 282 pass [unit test]; on real Mongo, bootstrap with a client clock 0, 1 ms, 4 ms, 1 s, 2 s, 3 s, 4 s, 4.999 s and 5 s ahead is accepted, 5.001 s ahead and expired or tampered requests are refused; routing and device-trust suites pass, 31/31 [integration test]. Crash probe re-run on the final head: health 200 [integration test].

## 0. Gate
- [ ] Render's deployed commit is exactly `f868cd5`. If it is anything else, stop: rebuild the hotfix from that SHA.
- [ ] Auto-Deploy Off, one instance. Record `f868cd5` as the rollback target.
- [ ] **Never deploy `871fa99` (current `origin/main`) or anything older.** With durable routing on, an owner-unaware build ignores durable ownership. See `docs/validation/FINAL_WEB_OWNER_GUIDE.md`, "Rollback boundaries".

## 1. What does not change (confirmed)
- No database change and no migration: `backend/db` and `scripts` are untouched between `f868cd5` and the hotfix. Do not run `npm run migrate`.
- No new environment variable. Leave everything as is: `K3NCRYPT_DURABLE_ROUTING=true` stays on, `K3NCRYPT_MAINTENANCE_MODE` stays as currently set, mux stays off.
- No wire-format change. The clock fix only widens the server's time check by 5 s; clients are unchanged.
- One new log event, `unhandled_rejection`, carrying only the error type.

## 2. Get the branch to Render
Render tracks `main`, and `origin/main` is `871fa99`, which does **not** contain `f868cd5`. `f868cd5` is only on `origin/release/k3ncrypt-web-usability`. So production was deployed from a commit that is not on the tracked branch; confirm on Render how that was done.

**Recommended: fast-forward `main` to the hotfix.** `871fa99` is an ancestor of the hotfix, so no force-push is needed. This also makes `main` equal what production runs, which removes the risk of someone deploying "latest main" (`871fa99`) by mistake.

```sh
cd ~/Documents/ChatGPT/chatapp-hotfix
git push origin hotfix/relay-crash
git push origin hotfix/relay-crash:main     # fast-forward only; refuses if main moved
```
Note: the repo is public. This publishes the 58 release-line commits on `main`; they are already public on `release/k3ncrypt-web-usability`.

Alternative, if you don't want `main` moved yet: push only the hotfix branch, temporarily switch the Render service's branch to `hotfix/relay-crash`, deploy, and **leave it there** until `main` is updated. Do not switch back to `main` while it is `871fa99`.

## 3. Deploy
1. Set `K3NCRYPT_MAINTENANCE_MODE=true`. In the same action, Manual Deploy → "Deploy a specific commit" → the head of `hotfix/relay-crash` (run `git rev-parse hotfix/relay-crash`; the head is this checklist commit; code is identical to `f5fde33f`).
2. Confirm on Render that the deployed SHA is that head SHA.
3. `curl -fsS https://<origin>/api/health` and `/api/ready` return 200.
4. Set `K3NCRYPT_MAINTENANCE_MODE=false` and redeploy the same SHA. Confirm the SHA again.

## 4. Smoke tests (two disposable accounts)
- [ ] Both accounts open; a text message goes each way.
- [ ] A message to a closed account arrives when it reopens.
- [ ] If an Android phone is available: set up a new device and confirm bootstrap succeeds.
- [ ] Logs: no `startup_failed`, no restart loop, no `unhandled_rejection`.
- Optional, only after step 3 confirms the head SHA: send the hostile packet once and confirm `/api/health` stays 200.

## 5. Rollback
Set maintenance on, deploy `f868cd5`, confirm health and ready, set maintenance off and redeploy `f868cd5`. No data to undo. Never roll back to `871fa99`.
