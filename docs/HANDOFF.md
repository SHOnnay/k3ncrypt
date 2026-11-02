# K3NCRYPT handoff — 2026-11-02

Scope: web client + Socket.IO relay. Android only where shared protocol is affected.
Evidence labels: [read code] [unit test] [integration test] [local browser run] [two-browser E2E] [production].

## Production
- Render, branch `main`, live on **`f927941`** = `f868cd5` + relay-crash fix + device clock tolerance. Deployed by the owner with the maintenance-mode cutover.
- `K3NCRYPT_DURABLE_ROUTING=true` (owner-confirmed).
- Read-only check 2026-11-02 12:27 UTC [production]: `/api/health` 200, `/api/ready` 200 (database and all relays ready). No build SHA exposed. No HSTS yet (fixed in M3, not deployed).
- **Owner smoke test pending:** message both ways between two devices; set up a new Android device.

## Where things are
Repo `SHOnnay/k3ncrypt` (public). Nothing below is pushed except `main`.

| Path / branch | What |
|---|---|
| `~/Documents/ChatGPT/chatapp-phase0`, **`m3/hardening`** | **Resume here.** Release line: everything below plus M3. |
| `m2/test-harness` | M0–M2 + merge of `main` (`f927941`). |
| `m1c/verification-ux`, `m1a/security-fixes`, `release/beta-baseline` | Earlier milestones (ancestors of `m3/hardening`). |
| `~/Documents/ChatGPT/chatapp-hotfix`, `hotfix/relay-crash` | Head `f927941` = what production runs. |
| `backup/hotfix-relay-crash-871fa99` | Superseded hotfix build on `871fa99`. Keep, do not deploy. |
| `~/Documents/ChatGPT/chatapp` | Owner's `android-beta` checkout with uncommitted work. **Do not touch.** |

## Milestones
- **M0** Local stack, Docker Mongo, isolated E2E runner (`scripts/m0-e2e.sh`). Bug A root cause: own pending invitation shown as a contact; no cross-account leak.
- **M1a** Relay crash on non-function ack; files and legacy media need a checked contact; queued file refs held after "not checked"; locked-profile passphrase error.
- **M1c** Plain-language check flow (scan / numbers / Android path), new pills and banners, single connection status, contacts grouped, own invitations only on Invite screen, legacy invitation removed, chats open in review mode after a number change, verification QR fixture (Android consumer missing).
- **M1b** Transfer metadata retention via Mongo TTL (`purgeAt`).
- **M2** Mongo runner (`scripts/test-mongo.sh`), golden-path E2E, file timing probe, 60 s timeout on file requests (no more stuck "Sending"), stale specs triaged with cited commits.
- **M3** Bundle check once per transfer + API limit 300/5 with numbers; fail closed without durable-routing setting; call errors classified by code; storage caps; socket event limits and 20 sockets per IP; npm audit (production 0); sync can't mark checked; SDK calls fail closed; call ends on device-trust loss; HSTS + COOP; CSP verified on production build (`scripts/prod-stage.sh`); WASM rebuild recipe (`scripts/build-wasm.sh`); host-trust disclosure (SECURITY.md, Settings → About security).

Test status on `m3/hardening`: unit 1196 [unit test], Mongo 78/78 [integration test], production stage pass [local browser run]. E2E: all pass except `composer-persistence` (accepted remount; UX milestone) — failing specs re-run individually after the last fixes, not one full pass [two-browser E2E].

## Before deploying `m3/hardening`
- Run `npm run migrate` first. `/api/ready` stays failing until the new indexes exist. Migrate also starts deleting already-expired transfer metadata: **take a backup first.**
- Keep `K3NCRYPT_DURABLE_ROUTING=true`. Never deploy `871fa99` or older.
- Android impact to check: 20 sockets per IP, delivery-ack rate limit, new "full" error text. No wire-format change in M1–M3.

## Open decisions
1. Replace the committed crypto WASM with the container build: the current `.wasm` embeds the builder's home path (public repo), its `manifest.json` hash matches nothing, and a clean rebuild differs by 36 bytes (string layout).
2. Retention for `links`, `device_lifecycle`, `device_identity_registry`.
3. Background check so a new acceptance appears without opening the invitation (UX).
4. `vite` 8.3.0 dev-server advisory: npm won't move it here; dev only.

## Next prompt (owner)
WASM replace; full E2E pass in one run; `RELEASE_CANDIDATE_1.md`; Android discovery.

## Known risks
- Web users trust the host: a compromised server can serve modified code (disclosed, not fixable on web).
- Web↔Android contact checking doesn't work yet: Android has no verification QR, no 30-digit number, and doesn't show the user's own security number.
- First-call failures on Android not reproduced web↔web; no STUN by default (planned opt-in "Connection helper").
- Atlas Free 512 MB: caps bound growth, but rooms and devices are never deleted yet.
- Owner smoke test of `f927941` not yet done.
