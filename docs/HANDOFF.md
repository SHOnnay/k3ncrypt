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
| 8 | E2E release gate | `scripts/e2e-gate.sh` (14 specs, fresh relay each, durable routing on). Needs 3 green passes in a row. | in progress |
| 2 | Domain + own web origin | Waiting for the owner's domain decision | — |
| 9, 11–18 | Fixtures parity, mux, monitoring, parity features | Pending | — |

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

## Known limits and risks
- Remove contact is only "hide" until milestones 3–4 land: the server-side revoke exists (`DELETE /api/chat-link/:channel/routing/:address`) but no client calls it [read code].
- An incoming call while Android is in the background or closed does nothing until milestone 6 is proven [physical device].
- Android: one socket per chat, at most 8 (1 foreground + 7 background). Relay caps: 10 sockets per proven device, 64 per IP.
- Android hardening (FLAG_SECURE, app lock) is off; file-receive gate parity with web must be re-checked on `android/n1`.
- No TURN (optional public STUN "connection helper" only). No backup: a lost phone is a lost identity.
- Web users trust the host that serves the code (disclosed in the app).
- Full sequential E2E is not green: three call specs fail only in the long run ("Ringing..."), pass alone; two mux specs are known gaps (mux is off in production).
- Atlas Free 512 MB; rooms and devices are never deleted yet.
- 200+ historical phase reports in `docs/` are not current; trust this file and the code.

## History (short)
- 2026-11-03 RC1 (`m3/hardening`) deployed: fail-closed routing, storage and socket caps, reproducible WASM, HSTS/COOP/CSP.
- 2026-11-04 UX Part A2 deployed; optional connection helper (STUN).
- 2026-11-05/06 Shared identity comparison fixture (Jest + Kotlin); call fixes.
- 2026-11-09 Web N1 (sounds, unread badges, mute, notification offer) and content-free FCM wake on `main`; Windows test runner.
- 2026-11-10 Android A5 on the owner's phone, A6 built (`K3NCRYPT-A6.apk`); call wake relay + web drafted on `feat/call-wake`.
