# K3NCRYPT handoff — 2026-11-03

Scope: web client + Socket.IO relay. Android only where shared protocol is affected.
Evidence labels: [read code] [unit test] [integration test] [local browser run] [two-browser E2E] [production].

## Production
- Render, branch `main`, live on **`b16c92f8`** (RC1 = M0–M3 + RC1), deployed 2026-11-03 06:27 UTC (`dep-dbknsrm7bikc73fe0f1g`). Previous: `f927941` (rollback target).
- `K3NCRYPT_DURABLE_ROUTING=true`, `K3NCRYPT_TRUST_PROXY=true`, `K3NCRYPT_MAINTENANCE_MODE=false`. Auto-Deploy off, 1 instance (free).
- Deploy record [production]: backup `~/k3ncrypt-backups/k3ncrypt-20261103T061112Z.archive.gz` (339 docs, sha256 `864c101f…`, verified by local restore with matching counts); `npm run migrate` ok in 3.3 s, all required indexes present, TTL removed 8 empty `file_ledgers_v2` rows (10 → 2), all other counts unchanged; `main` fast-forwarded `f927941` → `b16c92f8`; deployed under maintenance, then maintenance off. After: `/api/health` 200, `/api/ready` 200, HSTS + COOP + CSP present, served WASM sha256 `acd138dd…`.
- Render's Build Command order (`build:backend` first) is equivalent to the runbook's: byte-identical output for `b16c92f8`.
- **Owner smoke tests on real devices pending.**

## Release candidate 1 (`m3/hardening`)
- **Status: deployed 2026-11-03** (see Production). Smoke tests pending.
- Runbook: [`docs/releases/RELEASE_CANDIDATE_1.md`](releases/RELEASE_CANDIDATE_1.md) — backup (mongo:8 `mongodump`, URI only via env), verified local restore, rehearsed migration, deploy under maintenance mode, smoke tests, rollback to `f927941`. Every Docker/migrate command in it was rehearsed against a throwaway local `mongo:8`; not against Atlas.
- Contains M0, M1a, M1c, M1b, M2, M3, plus the RC1 changes below. `f927941` is an ancestor: `main` fast-forwards.

## Where things are
Repo `SHOnnay/k3ncrypt` (public). Nothing below is pushed except `main`.

| Path / branch | What |
|---|---|
| `~/Documents/ChatGPT/chatapp-phase0`, **`m3/hardening`** | **Resume here.** Release line, RC1. |
| `m2/test-harness` | M0–M2 + merge of `main` (`f927941`). |
| `m1c/verification-ux`, `m1a/security-fixes`, `release/beta-baseline` | Earlier milestones (ancestors of `m3/hardening`). |
| `~/Documents/ChatGPT/chatapp-hotfix`, `hotfix/relay-crash` | Head `f927941` = what production runs. |
| `/tmp/k3n-prod-f927941` | Disposable detached worktree at `f927941`, used for the flaky-spec comparison. Safe to remove (`git worktree remove`). |
| `backup/hotfix-relay-crash-871fa99` | Superseded hotfix build on `871fa99`. Keep, do not deploy. |
| `codex/android-beta23-stabilization` (`76eade5d`) | Newest Android code (199 Kotlin files). Not on the release line. |
| `~/Documents/ChatGPT/chatapp` | Owner's `android-beta` checkout with uncommitted work. **Do not touch.** |

## Milestones
- **M0** Local stack, Docker Mongo, isolated E2E runner (`scripts/m0-e2e.sh`). Bug A root cause: own pending invitation shown as a contact; no cross-account leak.
- **M1a** Relay crash on non-function ack; files and legacy media need a checked contact; queued file refs held after "not checked"; locked-profile passphrase error.
- **M1c** Plain-language check flow (scan / numbers / Android path), new pills and banners, single connection status, contacts grouped, own invitations only on Invite screen, legacy invitation removed, chats open in review mode after a number change, verification QR fixture (Android consumer missing).
- **M1b** Transfer metadata retention via Mongo TTL (`purgeAt`).
- **M2** Mongo runner (`scripts/test-mongo.sh`), golden-path E2E, file timing probe, 60 s timeout on file requests (no more stuck "Sending"), stale specs triaged with cited commits.
- **M3** Bundle check once per transfer + API limit 300/5 with numbers; fail closed without durable-routing setting; call errors classified by code; storage caps; socket event limits; npm audit (production 0); sync can't mark checked; SDK calls fail closed; call ends on device-trust loss; HSTS + COOP; CSP verified on production build (`scripts/prod-stage.sh`); WASM rebuild recipe (`scripts/build-wasm.sh`); host-trust disclosure (SECURITY.md, Settings → About security).
- **RC1** (2026-11-03)
  - Crypto WASM replaced by the reproducible container build (`0a15b9f9`): `scripts/build-wasm.sh`, `rust:1.89.0` pinned by digest; `manifest.json` hash matches; documented in `crypto-wasm/pkg/README.md`. Container pinned to `linux/arm64` (`71073638`): an emulated amd64 build gives the same size with functions reordered, and raw `rustc` output already differs by platform (cause not identified). The old 507,247 → 506,746 drop is the shorter dependency path; the M3k 507,283 figure is unconfirmed.
  - Socket caps (`df8b4562`): **10 concurrent sockets per proven device** (checked at `chat-join`), **64 per IP** at connect. Was 20 per IP, too low for 3 Android phones (8 sockets each) on one Wi-Fi. `backend/socket.io/deviceSocketLimit.test.ts` [integration test].
  - Android security-number decision recorded (`docs/ANDROID_SECURITY_NUMBER_DECISION.md`).

## Test status on `m3/hardening`
- Unit **1198** passed [unit test]; Mongo **78/78** [integration test]; production stage 1/1 [local browser run].
- One full E2E pass (35 specs, on `0a15b9f9`): **51 passed, 7 failed, 22 skipped** (skips are opt-in suites) [two-browser E2E]. Per failure:
  - `call-after-switch`, `call-history`, `call-usability`: 5/5 isolated on m3 **and** 5/5 on `f927941`. The "Ringing..." failure shows only in the long sequential pass; not an m3 regression; cause unknown.
  - `check-contact`: 3/5 on m3 (new in M1c). **Root cause:** `@zxing/library` 0.21.3 fails to decode 5–12% of valid QR codes with this payload, deterministically per payload, independent of encoder, size, quiet zone, binarizer and error-correction level (reproduced on static images in Node) [unit test]. Product impact: some users' verification QR can never be scanned by the web scanner; "Show numbers instead" works.
  - `composer-persistence`: known and accepted (UX milestone).
  - `conversation-persistence-mux`: passes with `PLAYWRIGHT_MUX_STAGE1=true` (default runner doesn't set it). `mux-stage1b`: known gap (`docs/CONVERSATION_PERSISTENCE_REPAIR_ACCEPTANCE.md`). Mux is off in production.

## Before deploying `m3/hardening`
Follow `docs/releases/RELEASE_CANDIDATE_1.md`. In short: maintenance on, **backup**, `npm run migrate` (new indexes + `purgeAt` backfill; TTL then deletes already-expired transfer metadata), deploy, maintenance off. Keep `K3NCRYPT_DURABLE_ROUTING=true`. Never deploy `871fa99` or older. No wire-format change in M1–M3.

## Decided
- **WASM** (2026-11-03): committed `.wasm` is the container build; no history rewrite (the old file with the home path stays in public history).
- **Android security number** (2026-11-03): Android shows the 30-digit per-contact number + verification QR, same as web; the `K3 …` fingerprint only under Security details. Once Android A0 ships, web drops the "Is <name> on Android?" step. See `docs/ANDROID_SECURITY_NUMBER_DECISION.md`.
- **Socket caps** (2026-11-03): per device 10, per IP 64.
- **Web QR scanner** (2026-11-03, UX milestone): use the browser's built-in `BarcodeDetector` first, fall back to a local zbar-wasm decoder (no CDN), and suggest "Show numbers instead" automatically after ~15 s with no read. Done = 100% decode over ~1,000 generated identities [unit test] plus a camera-free E2E.
- **Calls "Ringing..."** (2026-11-03): the intermittent failure in long sequential E2E runs stays in the Calls milestone; it does not block RC1.
- **RC1 approved** (2026-11-03) for the owner to deploy with `docs/releases/RELEASE_CANDIDATE_1.md`.

## Open decisions
1. Retention for `links`, `device_lifecycle`, `device_identity_registry`.
2. Background check so a new acceptance appears without opening the invitation (UX).
3. `vite` 8.3.0 dev-server advisory: npm won't move it here; dev only.

## Android findings (read-only, 2026-11-03)
- **Where:** `android/` in this repo; newest on `codex/android-beta23-stabilization` (`76eade5d`, versionName `0.1.0-beta.23-private.1`). `main`/`m3/hardening` carry an older 92-file tree.
- **Build:** Gradle 8.9, Kotlin modules (`app core crypto network storage security messaging media calls`) + Rust `android/native-crypto` built by Gradle (NDK 27.2). compileSdk/targetSdk 35, minSdk 26. Debug APK: `cd android && ANDROID_HOME=~/Library/Android/sdk ./gradlew :app:assembleDebug -Pk3ncryptBackendUrl=https://<origin> --no-daemon`. JDK 17, SDK 35, NDK and all 4 Rust Android targets are installed on this Mac; `ANDROID_HOME` is not set in the shell.
- **Emulator:** 10 AVDs installed (e.g. `K3NCRYPT-Preview-Pixel6-API35`), none running.
- **Security number:** beta23 already has the 30-digit comparison number (same algorithm as web) and a byte-compatible verification QR (show + scan). Not on the release line; no shared fixture for the number; own `K3 …` fingerprint not shown as text.
- **P0-1 parity:** calls require a verified contact (outgoing and incoming) — mirrored. Files: **sending** requires verified; **receiving/saving** only blocks unknown or changed identity, so an unverified contact's file opens on Android — **not mirrored** (web refuses).
- **Relay:** Socket.IO Java 2.1.1 over OkHttp; one socket per conversation (1 foreground + up to 7 background = 8 per phone); HTTPS REST with device proofs; optional FCM wake. No STUN/TURN by default.
- **Proposed milestones:** A0 security number on the release line + shared `relationship-comparison.json` fixture read by Jest and Kotlin; A1 receive/open/save file gate parity + call-ends-on-trust-loss test; A2 first call (opt-in connection helper), biometric re-prompt, startup time, notifications.

## Next prompt (owner)
Deploy RC1 with the runbook; smoke tests on real devices; then Android A0, the web QR scanner (UX milestone) and the Calls milestone.

## Known risks
- Web users trust the host: a compromised server can serve modified code (disclosed, not fixable on web).
- Web↔Android contact checking doesn't work on installed Android builds until A0 ships.
- Web QR scanner cannot read 5–12% of verification QRs (see test status); number comparison is the fallback.
- Full E2E pass not green: the three call specs failed together in one 35-spec sequential run but passed all 15 isolated runs on both m3 and `f927941`. A full sequential pass on `f927941` was not run, so "pre-existing" is inferred, not shown.
- First-call failures on Android not reproduced web↔web; no STUN by default (planned opt-in "Connection helper").
- Atlas Free 512 MB: caps bound growth, but rooms and devices are never deleted yet.
- Owner smoke test of `f927941` not yet done.
