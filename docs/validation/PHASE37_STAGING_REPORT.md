# Phase 3.7 — isolated production-mode staging gate

## Scope and exact source

Starting stabilization HEAD: `d67a47da8e72940c457e081fa40bfcb5e5d4022e`.
Live reference (not accessed or modified): `871fa99d0ae94c88239f6c392325f224d2c085c4`.
Runtime source tested: `27f8e1cf1b0c29dd3c7cca2de4e380d0eb99cf16`.
Later commits contain only tests, staging configuration and this evidence; no further runtime correction.
No Android changes, APK build, public endpoint, production database, Firebase, push, merge or deployment.

## Confirmed ledger defect and correction

A status lookup projected an early snapshot, then reread the ledger to fence cancellation/expiry.
It returned the early projection whenever `state` was unchanged. A chunk and manifest could
commit between those reads while the transfer remained `incomplete`; the response then omitted
committed progress seen by the final fence. A deterministic gated test failed before correction
(expected index 0 and manifest; received no indices/manifest).

Status now always projects the final authorized snapshot. Chunk downloads retain their existing
single-object read and state fence; no download ledger writes or extra ciphertext fetch were added.
The correction changes neither wire shape nor quota, mutation CAS, storage format or authorization.

Coverage includes both sender/recipient progress, incomplete manifest concealment, wrong participant,
room and identity, cancellation during a blocked object read, expiry, session expiry, a rejecting
trust callback, unrelated ledger writes, immutable ciphertext and write outages. Real Mongo tests
commit upload progress during the blocked final status read at 307 KiB and 1.2 MiB.

### Existing trust revalidation limitation

`authenticateAttachment` verifies the one-time signed device proof against durable lifecycle state
at request admission. Its supplied `deviceTrust.assertTrusted` subsequently checks proof expiry
and captured request binding, **not another database read of current revocation/epoch**. Thus the
ledger's final callback does not prove immediate mid-request revocation in production. New requests
must authenticate again, and proof lifetime is at most 30 seconds. This code is unchanged from the
live reference (`git diff 871fa99d -- backend/api/attachments/production.ts
backend/security/durableDeviceTrust.ts` is empty). Rejecting fake-callback tests are not evidence
that the real adapter detects a revocation occurring during an admitted request.

This pre-existing authorization window requires explicit disposition before broader release;
no speculative trust-authority modification was mixed into the status correction.

## Staging containment and build

- Exact tracked source exported with `git archive`; existing `docker/Dockerfile` production build.
- Both TypeScript backend and production Vite frontend compiled inside pinned Node 22 Alpine build.
- One Node application: 512 MiB cgroup memory/swap ceiling, 320 MiB JS heap, one CPU.
- Separate authenticated Mongo 7, 1.5 GiB/one CPU, fresh disposable database, internal Docker network.
- Existing idempotent schema/index setup applied only to that disposable database; no new migration.
- A bounded Node TLS proxy publishes only `127.0.0.1:3447`; app and Mongo have no published ports.
  Docker Desktop needed a separate ingress bridge for the proxy; app/Mongo remained internal.
- Temporary self-signed localhost certificate accepted only by the disposable automated browser;
  no system certificate installation, native TLS bypass or firewall/network-setting change.
- New random secrets in mode-0600 files under a mode-0700 temporary directory outside Git.
- Production validation, explicit origin/proxy policy, normal authentication, CSP and rate limits active.
  No test-only client diagnostics, injected sessions or privileged bypasses.
- Image `sha256:ee0fcd37565d2380b5242bf78a0b5c18fd69d7317deeeb5895779198b90f2a79`.
- Revision label matches the full tested runtime SHA. All seven served HTML/JS/CSS/WASM artifacts
  matched their built hashes; full compiled-file hashes recorded in the adjacent evidence JSON.

The first browser launch occurred before working Docker Desktop loopback ingress and failed
navigation. It was an infrastructure setup failure, not a transfer result. Readiness and served
hashes were verified before the measured acceptance runs.

## Android connectivity (read-only)

The separate existing diagnostic APK was not changed. Its current SHA-256 remains
`56d38b65e21e736cbddde44632d2b88cdbd2ec2d3862ef2fdd33030bb7a82de3`.
Application ID: `com.k3ncrypt.app.stabilization`; compiled backend/socket defaults blank.
Its existing Advanced connection settings validate and save runtime HTTPS origins in its own
preferences, then configure HTTP and realtime clients. `BuildConfig.DEBUG=false`; emulator HTTP
exceptions are unavailable. It needs **no rebuild** for a compatible, normally trusted HTTPS stage.

This Mac-only loopback origin is not phone-reachable and its temporary certificate is not suitable
for the native APK. Do not enter live Render or import/link the owner's existing identity.

Safest next step: obtain approval for a separate staging HTTPS origin, disposable database and
separate generated secrets, with a certificate normally trusted by Android and working secure
WebSocket forwarding. Prefer a narrowly reachable stage under an owner-controlled domain; public
hosting or a LAN-bound listener requires separate explicit approval. Do not install a device CA,
bypass TLS checks, expose Mongo, or reuse production credentials. After approval, configure both
origins in the isolated app, create independent disposable accounts and use in-app invitation
paste/scan (this diagnostic app intentionally does not claim production app links).

Physical acceptance must cover normal authentication/manual verification, message/offline ACK
states, ordinary and interrupted uploads, cancellation/retry, received-file integrity, startup,
conversation loading, Activity recreation, vault locking and grace expiry. Sender reopening remains
disabled under the recipient-only chunk contract. No phone behavior is inferred from Chromium.

## Rollback and cleanup boundaries

No new schema or protocol migration. To roll back an approved future stage: stop its one candidate
worker, verify it has exited/no listener, then start the separately built exact baseline against
only the disposable stage database. Do not overlap relay versions. Baseline-image rollback has
not been exercised in this gate; application restart with retained disposable storage is separate.

Stop/remove only newly named `k3ncrypt-phase37-*` resources and their own anonymous Mongo volume;
remove their temporary secrets, certificate, browser artifacts and source export after evidence
sanitization. No broad Docker prune, worktree cleanup, owner profiles, signing material or data.

## Measured file acceptance

One continuously running production application; no limiter reset between samples. The first four
samples use the same disposable sender/recipient; exact 8 MiB repeats use fresh independent pairs
to avoid violating the unchanged per-sender reservation quota. Loopback and one proxy address mean
both browser clients share an IP-rate bucket, as clients behind one NAT may also do. These are
single-stage measurements, not confidence intervals, Render latency or physical Android results.

| Plaintext bytes | Send to Sent (s) | Download to verified Save (s) | HTTP 429 count | SHA-256 |
|---:|---:|---:|---:|---|
| 23,552 (23 KiB) | 0.388 | 0.146 | 0 | PASS |
| 174,080 (170 KiB) | 0.379 | 0.503 | 0 | PASS |
| 1,258,291 (~1.2 MiB) | 4.109 | 2.904 | 4 | PASS |
| 4,194,304 (4 MiB) | 21.239 | 32.081 | 40 | PASS |
| 8,388,608 (8 MiB), first | 37.045 | 61.107 | 77 | PASS |
| 8,388,608 (8 MiB), repeat | 60.180 | 61.092 | 85 | PASS |

The recorded HTTP 429 counts include all observed identity/proof/file requests in that sample,
not just chunk requests. No quota or authentication limit was raised or bypassed. Requests retry
with bounded scheduling; browser measurements retain categories, counts, status codes, numeric
Retry-After and relative durations only. The adjacent JSON includes source reads, attachment AES-GCM
operation timings and stage transitions. Request header timing is not whole-response transfer time;
verified-Save timing includes reconstruction and integrity checks. Output hashes match the synthetic
input at every size. No file content, identifying filename, raw URL, header secret or participant ID
is retained in this evidence.

These measurements do not establish fast large-file service: repeated 8 MiB takes about two minutes
across send and download. They do not explain or erase the historical 72-second fixture or predict
provider-managed cold-start time. The stale-status fix has a deterministic before/after correctness
comparison; no matched before/after production performance improvement is claimed for it.

## Regression/build results and failures

- Backend production TypeScript compilation and Vite production compilation: PASS (Docker build).
- Scoped lint and `git diff --check`: PASS.
- Focused backend file/production-config/listener tests: 45 PASS.
- Attachment HTTP boundary/authorization/device-trust regressions: 18 PASS.
- File protocol, integrity, retry/cancellation/state and error-copy tests: 20 PASS.
- Real authenticated disposable-Mongo read/status overlap tests: 2 PASS.
  Total: **85 distinct focused unit/Mongo tests passed**. The normal backend command reports four
  integration skips; two were subsequently run successfully in Mongo's network namespace. The
  remaining two legacy unauthenticated-port/container-restart fixture cases were not run; their
  fixed container was not created or borrowed. Production application restart was tested separately.
- Deliberate pre-fix stale-status reproduction: FAIL as expected, followed by passing correction.
  Its first default-coverage invocation also emitted unrelated whole-tree Vite/module-format
  coverage-collection errors; focused runs use `--coverage=false`, and real production compilation
  subsequently passed. No whole-suite/coverage claim is made.
- Production Chromium file benchmark: three PASS executions, six checksum-verified transfers.
- Injected pre-allocation HTTP 429: PASS, exactly four attempts then honest terminal feedback;
  no phantom published attachment, next normal transfer succeeds.
- Preparing cancellation with concurrent encrypted text and stale allocation: PASS.
- Chunk 503/manual retry, same ciphertext retry, mid-upload cancellation, following transfer,
  oversize rejection and refresh/unlock cleanup: PASS standalone (11.8 s). Its first batched attempt
  failed during disposable device bootstrap (expected 201, got 429), before reaching file transfer.
  The rate limits were not reset or increased to obtain the later pass; the isolated control ran
  after the preceding quiet/recovery interval. This is a real shared-capacity onboarding limitation.
- Independent application restart, encrypted message receipt, page reload and vault unlock/history:
  PASS; restart through unlock/history confirmation 3,971 ms. One intentional application restart,
  zero unexpected restart/OOM events. This is not a Render Free cold-start measurement.
- Initial abrupt/clean offline status assertions: FAILED expecting Sent within 45 seconds; one
  later assertion also incorrectly expected a Delivered label. These are **test-contract errors**,
  not evidence of message loss. `modernConversation.ts` retains the outbox after relay correlation
  and notifies acceptance after the recipient callback; `ChatContext.tsx` leaves the UI pending until
  that notification. `securityVisibility.ts` intentionally maps modern recipient-app acceptance to
  **Sent**, and exposes no Delivered label. Thus Sending may persist while the recipient is offline;
  the Web UI does not separately display durable server acceptance. No protocol/ACK change was made.
- The initial clean-close control also lacked an explicit prior encrypted exchange; the final
  control establishes that session first. Final clean-close control: PASS (7.9 s), including normal
  invitation/verification, first encrypted exchange, offline pending state, reopening/unlocking,
  exactly one recovered message and the supported Sent status after recipient acceptance.
- The failed intermediate long-wait run reached exactly one visible recovered message after unlock;
  only its unsupported Delivered assertion then failed. Final fixtures assert the existing contract.
  No status was fabricated to satisfy a test, and no signed peer receipt or user reading is claimed.
- Standalone corrected abrupt-offline/restart control is recorded below. The initial assertion
  failures and bootstrap 429 remain reported rather than being counted as application regressions.

The measured application cgroup peak was **98,566,144 bytes (94 MiB)** against 536,870,912 bytes
(512 MiB). It includes application/container accounting rather than just JS heap; the browsers,
proxy, database and build process are separately budgeted and not represented as application RSS.
No cgroup OOM/max events were observed. This is a bounded serial load test, not a concurrency or
long-duration capacity certification.

## Gate verdict and remaining work

**Overall NO-GO for phone-reachable exposure/release pending authorization-window disposition and
staging approval.** Contained production-mode functional/file validation passes as recorded, but
this is not blanket security or release approval. The admitted-request revocation window above
requires explicit review before claiming immediate trust revalidation. Shared IP rate pressure also
caused one account-bootstrap failure and substantial large-file latency; limits remain unchanged.

Offline message recovery is **not** demonstrated broken by the initial status assertions. The actual
Web contract conservatively leaves Sending until recipient acceptance and then displays Sent. That
UX distinction can be reviewed separately; it does not authorize changing mailbox or ACK semantics.
The tests do not establish exactly when the relay stored each offline envelope. No false server-
acceptance or Delivered claim is made.

The compiled frontend and backend in this local image have verified common ancestry and artifacts.
No claim is made about an uninspected live frontend version, real Render cold starts, Internet routing,
physical phones or Firebase delivery. Both the current diagnostic APK and the owner's installed app
remain untouched. A phone-reachable trusted HTTPS endpoint, explicit approval for its exposure and
independent disposable identities remain prerequisites; runtime settings suffice without another APK.


## Final controls and disposition

Corrected abrupt-offline/reconnect/unlock/restart control: PASS (15.8 s); application restart to
subsequent encrypted receipt 2,774 ms. Clean-close recovery: PASS (7.9 s), one recovered message and
supported Sent state. Both earlier status-assertion mistakes are documented above; no Delivered
status exists in this Web build. Two planned application restarts were exercised in total.

The local functional staging gate is PASS under the tested serial workload. The overall next-step
exposure/release gate remains NO-GO pending explicit disposition of the pre-existing admitted-request
revocation window and approval of a separate trusted phone-reachable endpoint. The 429-bootstrap
failure and roughly two-minute large-file exchange remain reliability/UX limitations, not waived
security limits. No broad load, multi-instance, physical Android or live Render result is claimed.

Only the Phase 3.7 containers and networks were stopped/removed after evidence export, with their
own anonymous Mongo volumes and temporary generated secrets/certificates/browser files. The locally
built `k3ncrypt-phase37:local` image is retained for inspection. Existing containers, worktrees,
Android diagnostic APK, owner vaults and live resources were not changed. Runtime source remains
27f8e1cf; the subsequent validation commit adds only tests/configuration and this sanitized report.
