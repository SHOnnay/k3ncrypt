# K3NCRYPT handoff — 2026-11-12

A fresh session should be able to resume from this file alone. Update PROGRESS at the end of every milestone.

Evidence labels: [read code] [unit test] [integration test] [two-browser E2E] [physical device] [production].
Nothing is "working" without the right label. Call-wake, remove-contact, Android hardening and backup need [physical device].

## Plan and source of truth
- Plan: the architecture review of 2026-11-10 (owner's `K3NCRYPT_Architecture_Review.docx`): milestones 1–18 and "Do this next".
- Decisions that stand: two verbs, Archive and Remove, with silent discard for the removed person; pairwise groups later (not now); random 24-word recovery key, never passphrase-derived; Android is primary; the web client moves to its own origin together with the domain move.
- Not in scope: groups code, multi-device, LAN/home node, MLS, sealed sender, design polish beyond touched screens. The cold-start loader uses the owner's "Mark in motion" reference unchanged.
- Invariants (add a guard test whenever one is touched): transport never establishes trust; pinned ≠ checked; checking is explicit only; an identity change invalidates checking and pauses files/calls; files/calls need a checked, unchanged contact; no public directory; names are local only; no trackers, CDNs or third-party fonts; fail closed; minimal metadata; push wakes are content-free (type, random id, timestamps). Never print secrets.

## Where things are
| What | Where |
|---|---|
| Web client + relay (public) | `C:\Users\onnoy\k3ncrypt`, `github.com/SHOnnay/k3ncrypt`, release line `main` |
| Android (private) | `C:\Users\onnoy\k3ncrypt-android`, `SHOnnay/k3ncrypt-android-private`, branch `android/n1` (A6, `0.1.0-beta.29-a6`). It is a full copy of the repo plus the current `android/` tree. |
| Android toolchain | `C:\Users\onnoy\android-toolchain` (JDK 17, SDK). Dot-source `android\scripts\windows-env.ps1`. |
| Release build | `powershell -File android\scripts\build-release-apk.ps1 -Out C:\Users\onnoy\OneDrive\Desktop\K3NCRYPT-<version>.apk` (checks the certificate fingerprint `65:E1:74:59…D2:CF`, signs with the rotation lineage). Install with `adb install -r`. |
| Secrets | Windows Credential Manager, the Render Secret File, `C:\Users\onnoy\k3ncrypt-signing`, `C:\Users\onnoy\k3ncrypt-secrets`. Never in a repo, never printed. |
| Local Mongo | native MongoDB on `127.0.0.1:27117` (replica set `rs0`). Docker/WSL and the Android emulator do not work on this PC; the owner's phone over USB is the device. |

Local test notes (Windows):
- Run `.sh` scripts with Git Bash.
- The root `.env` leaks into Jest through dotenv and makes `backend/api/prekeys.test.ts` fail with 500 instead of 503. Move `.env` aside (or run in CI) for a clean unit run.
- `client/.env` points at localhost, so a production client build needs `CHATE2EE_API_URL=https://<origin>` in the environment.

## Production
- Render (free, 1 instance, Auto-Deploy off) serves `main`. Last deployed code: `66b4acc` (web N1 + content-free FCM wake) per the owner on 2026-11-10; confirm with the Render API before any release.
- `K3NCRYPT_DURABLE_ROUTING=true`, `K3NCRYPT_TRUST_PROXY=true`, `K3NCRYPT_MAINTENANCE_MODE=false`; push configured (Secret File + three `K3NCRYPT_FCM_*` variables). Call wake switch is OFF.
- Release rules: one change type per release (relay, web or Android); backup before migrations; maintenance cutover through the Render API; verify `/api/health` and `/api/ready`; name the rollback commit; wire changes go reader-first. Runbook: `docs/releases/RELEASE_CANDIDATE_1.md`.
- No APK or GitHub Release is published without the owner's OK.

## PROGRESS
| # | Milestone | State | Evidence |
|---|---|---|---|
| 1 | Truth pass | **Done 2026-11-12** (branch `chore/truth-pass`) | see below |
| 3 | Remove-contact, relay + web | **Done 2026-11-12** on branch `beta-now` (= `main` + call-wake commits). Not deployed. | [integration test] [two-browser E2E] |
| 4 | Remove-contact, Android | Code done (`195a763`, private repo `android/n1`). **Waits for the relay release and the phone.** | [unit test] only |
| 5 | Call wake, web | **Done 2026-11-13** (`afd5f48`). Found and fixed: the wake was sent to the caller's own address, so it never worked. | [unit test] [two-browser E2E] |
| 6 | Call wake, Android (callee and caller) | Code done (`e5b28ad`). **Waits for the relay release, `K3NCRYPT_CALL_WAKE_ENABLED=true` and the phone.** | [unit test] only |
| 7 | Unread counts in the vault | Web done (`1b6dc07`) [two-browser E2E]; Android code done (`0576fbf`), waits for the phone | web done |
| 10 | Android hardening on by default | Code done (`637405a`): screenshot block and app lock default on, toggles kept; version A7 `0.1.0-beta.30-a7` | [unit test] only |
| 8 | E2E release gate | **Green 3 passes in a row, 2026-11-14**, on `47c3f5e`: `scripts/e2e-gate.sh 3` (14 specs, fresh relay each, durable routing on). Run it from a separate worktree: editing files in the checkout under test restarts its dev servers and makes specs fail (that is what the earlier red pass was). | [two-browser E2E] |
| 9 | Shared fixtures | `call-wake.json` read by Jest and Kotlin; `scripts/check-fixtures.sh` keeps both repos' copies identical (now identical). File-receive gate parity: Android `AndroidFileOpenGateTest` already requires a checked contact. | [unit test] |
| 12 | Monitoring | `GET /api/metrics` (needs `K3NCRYPT_METRICS_TOKEN` on Render, otherwise 404), identifier-free counters; `.github/workflows/uptime.yml` every 10 min. | [unit test] |
| — | A7 APK built | `C:\Users\onnoy\OneDrive\Desktop\K3NCRYPT-A7.apk`, signer `65:E1:74:59…D2:CF`, sha256 `8586d657…a8be`. **Not installed, not published.** | — |
| 2 | Domain + own web origin | Waiting for the owner's domain decision | — |
| 11–13 | Multiplexed relay | Not started. Known gap: `e2e/mux-stage1b.spec.ts` fails at the reload handoff with `Room subscription rejected.` (see `docs/CONVERSATION_PERSISTENCE_REPAIR_ACCEPTANCE.md`). Beta limit stays: at most 8 chats connected at once on Android. | — |
| 14–18 | Schema v2 + padding, replies/reactions, voice notes, TURN, backup v1 | Not started. Next session starts with 14 (design + fixtures only): extend `RoomMessageV1` kinds; today an unknown kind is a hard reject (`modernConversation.ts:1829`, `RoomMessageV1.kt`), so readers must ship first. | — |
| D | Own web origin + build hash | Waiting for the domain decision. | — |

### Release B1 record — live 2026-11-14 [production]
- Production runs **`fe4e062`** (relay + web), deployed by commit id through the Render API. `origin/main` is still `4acd3b4`: the agent cannot push, so the owner must run `git -C C:/Users/onnoy/k3ncrypt push origin main` (local `main` is already at the release). Until then "deploy latest main" on Render would roll production back. Rollback target: `66b4acc`.
- Backup before the release: `C:\Users\onnoy\k3ncrypt-secrets\backups\k3ncrypt-20261114T121614Z.ejsonl.gz` (15 collections, 1,386 documents, read back and counted, sha256 `7aa0f6f454ab…`). Format: gzip of EJSON lines, written by `k3ncrypt-secrets\backup.ps1` (there is no `mongodump` on this PC). The Mongo URI was not in Credential Manager, so the script read it from the Render service environment through the stored Render API key, in memory only.
- Cutover: maintenance on → deploy → health 200, ready 200, every other route 503 → maintenance off → deploy → health 200, ready 200, `/` 200 with HSTS + CSP + COOP, new bundle served (remove-contact and call-wake copy present, no third-party origins), `/api/metrics` 404 without a token. No migration.
- `K3NCRYPT_CALL_WAKE_ENABLED` is still unset (off). It is to be turned on only with A7 on the phone and the checklist running.
- Live site `shonnay.github.io/k3ncrypt`: no APK link, no `.apk` mention.
- Old GitHub Release assets: all three APKs downloaded to `C:\Users\onnoy\k3ncrypt-release-archive\<tag>\` (sizes verified) and deleted from GitHub. Releases and tags remain, with 0 assets.
- ghcr.io `shonnay/k3ncrypt` (public, tags `main`, `nightly`): scanned all 9 layers (14,122 files) and the image config. No `.env`, key, keystore or credentials file; no secret-looking env names or build args; the only match is the system CA bundle. **Not deleted**: the `gh` token lacks `delete:packages`. Owner: GitHub → Packages → k3ncrypt → Package settings → Delete.
- Helper scripts added outside the repos: `k3ncrypt-secrets\render.ps1` (status / env for the two safe flags / deploy / wait), `backup.ps1`, `smoke.ps1`, `archive-release-assets.sh`.
- Phone session **not done**: the phone was plugged in but adb showed `unauthorized` (the "Allow USB debugging?" prompt needs a tap). A7 is not installed.
- Domain: not chosen. Plan with the stop point before DNS: `docs/releases/DOMAIN_CUTOVER_PLAN.md`.

### Phone session record — 2026-11-14/15 (owner away; agent alone with adb and a throwaway web test account)
Setup: phone = OPPO CPH2719, Android 16. "The other side" = a throwaway web account on production driven by Playwright (`k3ncrypt-secrets\webpeer.cjs`); the phone UI is driven through adb (`ui.cjs`, `phone-*.sh`). The pairing was real: the same 30-digit number showed on both sides before "They match" was pressed on each.

**Corrections to earlier statements in this file**
- **The multiplexed relay is ON in production** (`K3NCRYPT_MUX_MESSAGE_DELIVERY=true`, `K3NCRYPT_MUX_PRODUCTION_OPT_IN=true`, and the `VITE_` twins). The web client uses it for every checked contact with a session. Android uses the legacy transport. The default E2E run has mux off, so it did not test what production runs; the gate now runs four specs with mux on as well.

**Proven** [physical device] [production]
| Checklist line | Result |
|---|---|
| 1 Upgrade A6 → A7 | Pass. `adb install -r`, version `0.1.0-beta.30-a7`, chats and checks kept, vault opened (unlock grace is enabled on this phone). |
| 2 Screenshot block | Pass. The window is a secure surface and `screencap` produced no file. App-lock relock after 60 s was not separately observed: with grace enabled the vault reopens without a prompt. |
| 3 Unread survives restart | Pass. Badge 2 for 2 delivered messages, still 2 after the process was killed and relaunched, gone after reading. |
| 4 Remove contact (phone side) | Pass. Contact gone at once, "finishing" line cleared, still gone after kill + relaunch; the phone showed nothing and got no notification afterwards. |
| 4 Remove contact (other side) | **Fail, fixed in `d207153`, not deployed.** Web showed the chat under "Needs attention — Couldn't connect": the multiplexed subscribe refused a room whose other participant was removed. |
| 11 Phone calls a closed web client | Pass after a fix. "Calling… their phone may need to wake" → web opened → invite delivered → web accepted → Connected on both. The first invite send right after the contact joins can fail; Android now retries it (`b8e373e`, in the rebuilt A7 on the Desktop and on the phone). Cancel while waiting: pass, no invite sent. |
| 6–10, 12, 13 Phone rings from a push | **Not proven.** With the flag on, a web call to a killed app produced only a generic "New encrypted activity" notification: the web caller is on the multiplexed relay, where call wake did not exist. Fixed in `7b6c2f6` (relay `mux-call-wake` + web), not deployed. **`K3NCRYPT_CALL_WAKE_ENABLED` was set back to `false`**, as instructed for a failed step. |
| 5 Remove contact offline | Not run yet. |

**Other findings**
- Web: after a reload the open chat sometimes lands under "Needs attention" for that load and opens fine when clicked or on the next load (seen 3 times with the test account, roughly every other load). Not investigated.
- The release on production (`fe4e062`) does not contain the three fixes above. They are local commits on `beta-now` (`7b6c2f6`, `d207153`) and in the private repo (`b8e373e`). **Nothing new can be deployed until the owner pushes `beta-now`/`main`.**
- A7 on the Desktop was rebuilt (sha256 `6d5da590a5c6…`) with the invite retry; that build is on the phone.
- Test leftovers: the web test account has one dead room with the phone (removed on the phone side). Its profile and passphrase are in `k3ncrypt-secrets\webpeer\` and can be deleted.

### Release B2 and ring session — 2026-11-15
- **B2 live on `d207153`** [production] (relay + web: multiplexed call wake, removed-contact room fix). Backup `k3ncrypt-20261115T091152Z.ejsonl.gz` (1,391 docs, verified). Rollback `fe4e062`. Gate green 1 pass including the four multiplexed specs.
- **How multiplexing got turned on (inferred, no audit record):** Render's API keeps no env-change history. The likely change is the pair of `service_updated` deploys of `855096ed` on 2026-10-25 06:47 and 06:51 UTC (an env change in the dashboard triggers that kind of deploy), the same day as commit `d20f4e3` "preserve authenticated offline Mux sends". The gates were added 2026-10-09 (`fcf4e38`) with the runbook saying keep them off; the 2026-11-02 hotfix checklist expected them unset. The owner's Render dashboard Events page may show who changed it.
- **Env vs this file:** all four mux vars `true` (this file said off); `K3NCRYPT_CALL_WAKE_ENABLED=false` again; `K3NCRYPT_METRICS_TOKEN` not set (metrics off). Everything else matches.
- **Unlock grace:** not on by default in A7. It is on for anyone upgraded from A6, because A6 enabled grace at every unlock while app lock defaulted off, and the setting survives the upgrade. Consequence: app lock does not prompt until grace expires. Relock-with-grace-off retest still to do ("Lock now" turns grace off; needs the owner's unlock).
- **Ring steps** [physical device] [production], new test contact checked by the owner (number 52485 07293 34055 31434 11159 54090):
  - Step 8 (killed, locked, nobody answers): **pass.** Rang ~4 s after the call started ("Incoming K3NCRYPT call / Unlock to see who is calling"), stopped by itself, "Missed K3NCRYPT call" posted.
  - Step 6 (unlock to answer): **fail.** Phone rang; the owner opened it (the activity started over the lock screen at 20:43:12 from the notification); no invite ever reached the phone (no `K3ncryptCall` lines at all). Web showed "Ringing..." at t=2 s, i.e. it did **not** wait for the phone: the wake request's answer was not "absent" (most likely "unknown" from the 1.5 s ack timeout on the multiplexed path), so the invite was sent at once to a phone whose vault was locked and whose sockets were closed (screen-off disconnects them), and the relay dropped it ("no receiver"). Nothing re-sends it when the phone rejoins.
  - Full-screen ringing is not allowed on this phone: `appops USE_FULL_SCREEN_INTENT: default; rejectTime=…`. The heads-up fallback rang.
  - **Flag set back to `false`.** Steps 7, 9, 10, 12, 13 not run; step 5 not run.
  - Proposed fix (not started): (1) the caller re-sends the invite when the contact joins while the call is still ringing (web and Android); (2) raise the wake ack timeout to ~4 s and treat a timeout during the first seconds as "wait", not "call now"; (3) E2E: caller sees presence unknown, callee joins later, call still connects.
- Test account kept on purpose: the ring steps must be re-run after the fix. Its passphrase and profile are only in `k3ncrypt-secrets\webpeer\`.

### Correction and fix — 2026-11-15 evening
- **Step 6 is "not run", not "failed".** At 20:43:12 the owner only unlocked the phone's lock screen. The log shows the system's full-screen intent woke the phone and started K3NCRYPT over the lock screen (`Waking up from Dozing … details=com.android.systemui:full_screen_intent`, then `START … MainActivity` from System UI pid 3238). Full-screen ringing does work on this phone.
- **Callee defect found and fixed (`75f52f5`, private repo):** with unlock grace on, the app could open its vault through grace and move to "Connecting to your caller…" without an Answer tap. Now only an explicit Answer answers, Answer always uses the app's own device authentication, and grace cannot resume while a wake rings or is being answered (guard test `unlockGraceCannotAnswerOrOpenTheVaultDuringACallWake`). The normal incoming-call screen still needs its own Accept.
- **Root cause of the lost invite, refined:** on the multiplexed relay an invite to an absent contact is refused outright, so the web caller's call failed at once. On the legacy path it was silently dropped. Fixed in `5604f5f` (web/service) and `75f52f5` (Android): the call keeps ringing to its normal expiry, and the invite is (re)sent each time the contact joins while unanswered. A receiver that already has it refuses the duplicate. The wake answer timeout went from 1.5 s to 4 s. E2E `call-wake.spec.ts` now includes a test that withholds the wake answer so the invite is lost; it was red before the fix and is green after, on both transports. Release gate green (1 pass incl. multiplexed specs) on `5604f5f`.
- A7 rebuilt with both Android fixes (sha256 `1a5484e164005da7…`) and installed on the phone.
- **Not deployed:** `5604f5f` is local; Render builds only from GitHub and the agent cannot push. Call wake stays `false` until it is live.

### Session 2026-11-16 (B3, relay restart, step 5, relock)
- **B3 live on `1d9c488`** [production] (web: lost invite re-sent on join; wake answer 4 s). Backup `k3ncrypt-20261116T042530Z` (1,394 docs). Rollback `d207153`.
- **Step 6 retry failed, flag set back to `false`** (deploy `dep-dbt8smrbc2fs73df8utg`, live 05:09 UTC). Phone side worked [physical device]: rang at ~22 s, full-screen intent started the app, owner tapped Answer, app unlock, "Connecting to your caller…", then "Missed". The web caller stayed on "Calling… their phone may need to wake" throughout; no invite reached the phone.
- **Cause: the relay instance was replaced mid-call at 04:56:54Z** [production]. Instance `jhlb4` → `xxbls`; no deploy, no Render event, no stack trace; memory 68 MB of 512 MB, CPU ~0. The service is on Render's **free plan** ("Render might restart a Free web service at any time"). Of 33 relay starts in 7 days, 20 are deploys; the rest are mostly cold starts after idle. Restarts do not follow phone reconnects (yesterday's phone session ran 09:18–14:47Z on one instance, through many reconnects and wakes). Local repro (native Mongo, mux, pending wake, contact reconnecting; 3 runs) showed no relay crash, rejection or memory spike [two-browser E2E].
- **Defect behind it:** relay memory (rooms, subscriptions) is lost on restart. When the contact reaches the new relay first, the caller's resubscription answer says the contact is there, but nothing released the caller's wait, and no peer notice ever comes. Fixed on all three transports: web mux (`multiplexedRelayConnection.ts`), web legacy (`socketIoRelayTransport.ts`), Android (`SocketRelay.kt`, private `9238178`). A join or subscribe answer that newly shows the contact releases the waiters, so a waiting call sends its invite and a ringing call re-sends it.
- **Commits:** web/service `253cf99` (flake fix) and `8ae8ad8` (reconnect fix, E2E `e2e/relay-restart-call.spec.ts` + `playwright.restart.config.ts`, added to `scripts/e2e-gate.sh`); Android `9238178`. The restart E2E kills the relay with SIGKILL while Alice waits for Bob. Alice is held off the new relay until Bob is back, as the phone was. The call must ring within 6 s of Alice's own rejoin. Without the fix: red, 9.7 s (only a later, unrelated resubscription by Bob's web client rescued it; a phone would not). With it: green on mux ×2 and legacy [two-browser E2E]. Android unit test `RelayRestartPeerJoinTest`; `:network` and `:app` unit tests green [unit test].
- **Exit logging** `a9f018a`: the relay logs `uncaught_exception` and `process_exit` (code, uptime, RSS) before dying, so the next unexplained restart shows whether the process exited or was killed from outside.
- **Flaky "Incoming call is unavailable" (1 in 3 mux call-wake E2E runs) explained and fixed.** On the callee, a message-triggered call-receiver refresh finished after the invite had rung. It swapped in a new call composition, and the conversation routes signals to the newest one, so Accept found no call. Now a refresh keeps the composition while it holds a live call (`modernConversation.ts`, `repository.hasLiveCall()`), and the receiver stays the same. Regression test in `modernConversation.test.ts`: red without the fix, green with it [unit test].
- **Relock with grace off: pass** [physical device]. 11:45 local "Lock now and revoke grace", 11:46 app unlock, more than 70 s away, 11:49 reopen asked for the app unlock and no chat showed before the fingerprint. Settings shows "App lock is on". The button is the second one in "App protection" at the top of Settings, always shown.
- **Step 5 (remove contact offline): pass** [physical device] [production], with a second throwaway web account "K3 Test Remove" (kept in a local folder outside the repos). Invitation accepted on the phone (not checked); web message "step5 before removal" Delivered and shown. Wi-Fi and data off, then More → About contact → Remove contact (dialog named "Remove K3 Test Remove?") → Remove. Chat and contact rows gone at once while offline; "Finishing on the server" shown. Network restored and the app relaunched: still gone, finishing line cleared within about 2 minutes (still shown at +40 s). Still gone after force-stop and relaunch. The removed web account's next message stayed "Sent", never "Delivered"; no phone notification and nothing shown. The web side shows no removed or couldn't-connect hint.

### Unattended ring session — 2026-11-16 afternoon (owner away)
- Gate green on `8ae8ad8` (1 pass, incl. multiplexed specs and the new relay-restart spec on both transports) [two-browser E2E]. **Not deployed:** the agent cannot push. Production still runs `1d9c488`.
- A7 rebuilt with `9238178` (sha256 `53d363fd49e6e1d8…`) and installed over the app (data kept). The reinstall ended unlock grace, so the app now needs the owner's device unlock.
- **Call wake ON** via maintenance cutover on `1d9c488` (deploys `dep-dbtfb5brjlhs73f6btu0`, `dep-dbtfbtjm8hqs73ap3kog`; health and ready 200; maintenance off).
- Ring steps [physical device] [production], caller = web account "K3 Test Caller", phone app killed and screen locked:
  - Step 8 (nobody answers): **pass.** Rang ~4 s after the web call began, stopped by itself ~50 s later, "Missed K3NCRYPT call" posted. The full-screen ringing screen came up over the lock screen.
  - Step 7 (caller cancels): **pass.** Ringing stopped after the cancel; missed-call notification posted again during the test.
  - Step 9 (decline): **pass.** The ringing screen shows "Unlock to answer" and "Decline". Decline stopped the ringing at once and left no missed-call notice; the caller rang out ("Calling…", never told of the decline).
  - Step 13 (battery saver on): **pass.** Rang, then missed after cancel. Battery saver set back off.
  - 10-ring count: **10/10 rang**, each ~4–5 s after the web call began (web cancels after 20 s).
  - Call wake **left ON**: no ring step failed.
- **Waiting for the owner** (needs a fingerprint, an Answer tap, or a push):
  1. Push: `git -C C:/Users/onnoy/k3ncrypt push origin beta-now` and `git -C C:/Users/onnoy/k3ncrypt-android push origin android/n1` (pre-push word check clean on both). Then release B4 = `abdb56a` (relay exit logging + call fixes; no migration, no wire change; rollback `1d9c488`).
  2. Unlock K3NCRYPT once with the fingerprint (the reinstall ended grace).
  3. Step 6 ×10 (answer and connect): app killed, screen locked, web calls, Answer → app unlock → incoming-call screen → Accept → two-way audio. Best after B4 is live.
  4. Step 10 (app in the background, phone unlocked): heads-up → tap → incoming-call screen without a new unlock.
  5. Step 12: Settings → Apps → K3NCRYPT → Full screen notifications off, repeat step 8 once, then turn it back on (a system setting the agent did not change).
  6. After the checklist: delete both test accounts on production ("K3 Test Caller", "K3 Test Remove") and their local folders.

### What is blocked on the owner (2026-11-13)
1. **Push.** A local hook blocks `git push` for the agent. Nothing since `66b4acc` is on GitHub, so nothing can be deployed (Render builds from GitHub `main`). Run: `git -C C:/Users/onnoy/k3ncrypt push origin main beta-now` and `git -C C:/Users/onnoy/k3ncrypt-android push origin android/n1`. Then say whether `beta-now` may be fast-forwarded into `main` for the release.
2. **Release B1 (relay + web, one Render deploy; they ship together from this repo).** No migration, no wire change that old clients cannot read (new relay events are additive; call wake stays OFF until step 3). Rollback = `66b4acc`. Runbook: maintenance on → deploy → `/api/health`, `/api/ready` → maintenance off → smoke test.
3. **Call wake switch:** set `K3NCRYPT_CALL_WAKE_ENABLED=true` on Render only after B1 is live and the A7 APK is on the phone.
4. **Phone session** (one USB session): the checklist in "Phone checklist A7" below.

### Phone checklist A7 (after B1 is live)
Build: `powershell -File android\scripts\build-release-apk.ps1 -Out C:\Users\onnoy\OneDrive\Desktop\K3NCRYPT-A7.apk`, then `adb install -r`. A second device or the web client is the other side. Record pass/fail and anything odd for each line.
1. Upgrade install over A6 keeps chats and checks; Settings shows 0.1.0-beta.30-a7.
2. Hardening: a screenshot inside a chat is blocked; after 60 s in the background the app asks for the device unlock; both toggles in Settings work.
3. Unread: receive 3 messages in a chat that is not open, force-stop the app, reopen and unlock → badge still shows 3; open the chat → badge gone; reopen → still gone.
4. Remove contact (from Contacts menu): chat disappears; "Removed. Finishing on the server…" goes away within seconds; force-stop and reopen → still gone. From the other side: send a message → it stays "Sent", never "Delivered"; call → rings out. The phone shows nothing and does not ring.
5. Remove contact in airplane mode: chat disappears at once; turn the network back on, unlock → the "finishing" line clears.
6. Call wake, app killed, screen locked: call from the other side → phone rings with "Incoming K3NCRYPT call / Unlock to see who is calling" (full screen or heads-up). Unlock to answer → "Connecting to your caller…" → normal incoming-call screen with the caller's name → Accept → two-way audio. Repeat 10 times; count successes.
7. Same, but the caller cancels before the phone is unlocked → ringing stops, "Missed K3NCRYPT call" notification.
8. Same, nobody touches the phone → ringing stops by itself after about 45 s, missed-call notification; the caller sees "No answer" after 60 s.
9. Decline from the notification → ringing stops; the caller rings out.
10. App in the background (not killed), phone unlocked: call → heads-up rings → tap → incoming-call screen appears without a new unlock.
11. Phone calls a closed web tab or a second phone that is asleep: "Calling… their phone may need to wake"; cancel works; when the other side opens the app the call rings there.
12. Android 14+: Settings → Apps → K3NCRYPT → "Full screen notifications": test line 6 with it on and with it off.
13. Battery saver on: repeat line 6 once.

### Milestone 3 record (remove contact, relay + web)
Not pushed: `main` is 1 ahead of origin (`4acd3b4`, truth pass); a local hook blocks `git push`, so the owner runs `git push origin main`. Until then the site still shows the APK link. `beta-now` is local only.

- Relay (`bcae705`) [integration test, `backend/security/contactRemoval.mongo.test.ts` 4 passed]: `DELETE /api/chat-link/:channel/routing/:address` is repeatable (200 again, 410 if the room is deleted), then deletes waiting mail for that address, withdraws its wake route and ejects its live socket. Mail sent to a self-revoked address is accepted and dropped with the normal "stored" ack (silent discard). The identity lookup still serves the removed side's pinned identity. Not deployed.
- Service: `readContactRemovalRequest`, `purgeRemovedConversation` (`service/src/crypto/modernConversation.ts`), `revokeContactRoute` (`service/src/crypto/contactRemoval.ts`, works from the vault alone so the outbox can retry after a restart).
- Web: `removeContact(roomId)` in `ChatContext`. One vault transaction writes the tombstone, drops the chat from the list and queues the relay notice (`product-session/removal-outbox`); then the live conversation is closed, the session, keys, pinned identity, saved messages, file details and mute entry are deleted, and the outbox is drained (on unlock, on `online`, every 60 s while pending; abandoned after 30 days). "Removed. Finishing on the server…" shows while a notice is pending. Header "Remove contact", Settings "Remove contact" (was Block) and every Remove button use it.
- Evidence: `client/src/product/contactRemoval.test.ts` 5 passed [unit test]; `e2e/remove-contact.spec.ts` 2 passed [two-browser E2E] (peer's later message stays "Sent", never "Delivered"; removed chat gone after reload; offline removal finishes later); full Jest 1347 passed; tsc, ESLint, production build clean.
- Decisions made here: Remove deletes that chat's history on this device (Archive is the choice that keeps it), because nothing could show orphaned history. Removing your own unaccepted invitation does not delete the room; the invitation simply expires (24 h).
- Finding for milestone 8: the default E2E relay runs with durable routing OFF, unlike production. `PLAYWRIGHT_DURABLE_ROUTING=true` turns it on (golden-path, modern-conversation and file-trust-gate pass with it); `remove-contact.spec.ts` skips without it. Consider making it the default.
- Relay release needed before Android can use it: relay-only change, no migration, rollback = current production commit.

### Milestone 1 record
- Site: the public APK download link, its hash line and install steps are removed from `site/index.html`; the page now says Android is a private beta. Takes effect when `main` is pushed (`pages.yml`).
- `npm audit`: 0 high (was 1: `vite` dev server), 9 moderate, 7 low; production tree (`--omit=dev`) 6 moderate, all through `firebase-admin`. `npm audit --audit-level=high` exits 0.
- `android/` (135 stale files) removed from the public repo. The Android backup-rules guard in `backend/security/releaseResources.test.ts` went with it; the same test stays in the private repo next to the real tree.
- Inherited workflows removed: `npm-publish.yml` (published an SDK to npm on every GitHub Release) and `docker-publish.yml` (**ran daily and pushed a signed image of `main` to `ghcr.io`**, last success 2026-11-11).
- `security-check.yml` pinned to `ubuntu-24.04`: it has been red on `main` since `ubuntu-latest` became 26.04, which Playwright 1.59 cannot install on.
- Verification: Jest 1328 passed, 106 skipped, 0 failed with `.env` moved aside [unit test]; `tsc` and ESLint clean; production client build ok.

## Open decisions for the owner
1. **Old GitHub Releases** `v0.1-beta` and `v0.1.0-beta.2` still carry APK assets that anyone with the URL can download. Options: delete the assets (recommended), delete the releases, or keep them. Irreversible, so it waits for the owner.
2. **Published container images** on `ghcr.io/shonnay/k3ncrypt` from the removed daily workflow. Recommended: delete the package or make it private (GitHub → Packages).
3. **Domain** for the relay and the separate web origin (milestone 2 and part D).
4. Two-factor on GitHub, Render, Atlas, Firebase and DNS (owner action).
5. Retention for `links`, `device_lifecycle`, `device_identity_registry`.

## Session 2026-11-16/17 (B4, step 6, U1 proposal)
- **B4 live on `81b1ca5`** [production]: relay exit logging, the receiver-refresh fix and the restart rejoin fix. Backup `k3ncrypt-20261116T142652Z` (1,409 docs, verified). Maintenance cutover, then health and ready returned 200, and the smoke check passed. Call wake is still ON. Rollback `1d9c488`.
- Step 6: 4 out of 10 connected (see Known limits). It must be re-run by the owner, who answers with a fingerprint.
- U1 (usability UI pass): proposal only, nothing built. The file is on the owner's Desktop as `K3NCRYPT-UI-proposal.html`. It covers loader, chat list, chat, call screen, call history (local, in the vault), contact info and settings, Android first and then web, with A/B options. The owner picks, then the build starts. The loader in A7 is Mark in motion for cold start, unlock and call connecting. Opening a chat, busy states and file transfer still use Material progress bars. Open question: the owner asked for a "spinning" mark, while the reference says "never a spinner" (option L1).

## Known limits and risks
(Updated 2026-11-17 to match the evidence from the 2026-11-16/17 sessions.)
- Remove contact works end to end, including offline removal: the contact disappears at once and stays gone after a force-stop, the removed side's messages stay "Sent" and are dropped in silence, and web shows no hint [physical device] [production].
- Call wake is ON in production. With the app killed and the screen locked, it rang 10 out of 10. Caller cancels → Missed, unanswered → Missed, decline, and battery saver all passed [physical device] [production].
- **Answer-and-connect is not reliable:** step 6 connected 4 out of 10 (2026-11-17). Calls 1–6 never rang, and their call messages got no relay delivery receipts. Calls 7–10 rang at about 4 s but took 17–28 s to reach "Connected". The cause is not investigated. Note that Answer needs the owner's fingerprint by design, so step 6 is an owner step: the adb taps used here are not a valid substitute.
- Steps 10 (app in the background, phone unlocked) and 12 (full-screen notifications off/on) are not yet run.
- App lock and FLAG_SECURE are on in A7. Relock with grace off passed, and the screenshot block passed [physical device]. File-receive gate parity with web still needs to be re-checked on `android/n1`.
- The relay restarts without warning on Render's free plan: 2026-11-16 04:56Z, no deploy, 68 MB of 512 MB, no stack trace. It now logs the process exit (B4). The reconnect fix (B4) covers a peer that rejoins after a restart [two-browser E2E], but not the 2026-11-17 missed rings above.
- Android: one socket per chat, at most 8 (1 foreground + 7 background). Relay caps: 10 sockets per proven device, 64 per IP.
- No TURN. The decision is to use Cloudflare's free tier as the opt-in connection helper (not built). No backup: a lost phone is a lost identity.
- No call history: the Calls tab shows only the current call. That is U1, proposed and waiting for the owner's choices.
- Web: after a reload, a chat sometimes lands under "Needs attention" for that load. Not investigated.
- Web users trust the host that serves the code (disclosed in the app). The web vault lives in the browser under the current address, so moving the domain later strands web users' vaults; decide the domain before family uses the web app.
- Full sequential E2E is not green: three call specs fail only in the long run ("Ringing..."), pass alone; two mux specs are known gaps (mux is off in production).
- Atlas Free 512 MB; rooms and devices are never deleted yet.
- 200+ historical phase reports in `docs/` are not current; trust this file and the code.

## History (short)
- 2026-11-03 RC1 (`m3/hardening`) deployed: fail-closed routing, storage and socket caps, reproducible WASM, HSTS/COOP/CSP.
- 2026-11-04 UX Part A2 deployed; optional connection helper (STUN).
- 2026-11-05/06 Shared identity comparison fixture (Jest + Kotlin); call fixes.
- 2026-11-09 Web N1 (sounds, unread badges, mute, notification offer) and content-free FCM wake on `main`; Windows test runner.
- 2026-11-10 Android A5 on the owner's phone, A6 built (`K3NCRYPT-A6.apk`); call wake relay + web drafted on `feat/call-wake`.
