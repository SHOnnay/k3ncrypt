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
| 3 | Remove-contact, web | Next | — |
| 4 | Remove-contact, Android | Pending | — |
| 5 | Call wake, web tests | Pending. Relay `34590d5` and web `f2d2d50` exist on local branch `feat/call-wake` (not pushed); web part is untested. | [read code] |
| 6 | Call wake, Android | Pending | — |
| 7 | Unread counts in the vault | Pending | — |
| 2 | Domain + own web origin | Waiting for the owner's domain decision | — |
| 8–18 | Beta-stable and parity | Pending | — |

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
