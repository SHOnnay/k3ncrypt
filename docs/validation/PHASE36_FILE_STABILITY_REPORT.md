# Phase 3.6 file stability and staging gate — 2026-10-18

Branch: `codex/phase3-offline-stabilization`. Validated application source: `3190a7e1049d7b32517224ffbecf389291b7e841`. The final validation-record commit adds only tests, this report, measurements and the staging plan; its hash is reported in delivery.

Original candidate: `6dc2cda10af488ac2f419624bd236c6773de5efa`. Owner-confirmed live comparison baseline: `871fa99d0ae94c88239f6c392325f224d2c085c4`. Android reference: `4899f2ebef38906e8511dabca19efb1521cbc59d` (Beta 21). No production request, deployment, APK, push, merge, live database or installed identity was used.

## Large-file conclusion

The exact previously interrupted 8,387,584-byte browser fixture completed in BOTH directions with matching hashes in 3.4 minutes of test time (3.5 minutes including runner startup). The earlier interruption beyond two minutes did not establish a permanent stall. A separate exact 8 MiB boundary also completed and verified. The historical observation of an indefinitely unchanged Preparing label was not reproduced; its exact cause remains unproven.

The measured long stages are repeated authenticated prekey/proof/file requests and admission backoff, not the AES-GCM operation itself. In the 8 MiB baseline sample, 52 prekey rejections advertised four-second waits. The candidate retained limits and shortened those read-bucket waits, but eventually also encountered the unchanged aggregate API admission boundary, including requests to the device-proof and file endpoints. This is local evidence, not proof of the cause of every physical-device delay or of Render performance.

## Narrow correction

`3190a7e1049d7b32517224ffbecf389291b7e841` changes one Failed-state copy expression in `client/src/product/fileTransferCopy.ts`, with a deterministic unit regression and two authenticated browser tests. Before transfer allocation, the workflow correctly retained `FILE_RATE_LIMITED` but produced generic failure text; the UI discarded the explicit category. Both the unit and real UI assertion reproduced that defect before correction.

The UI now uses the fixed allowlisted admission-rate code to explain that the service is busy. Storage-quota errors remain distinct. No authorization, retryability, retry count, storage, message ACK or file-wire behavior changes. Four injected 429 attempts (initial plus three retries, Retry-After 1) terminate without a reference/false Sent; a fresh subsequent transfer succeeds. A held Preparing request remains cancelable while the other peer sends an encrypted message, and a subsequent protected-file transfer verifies.

## Matched warm-service measurements

Five independent samples per version and standard size, 40 total. Each sample gets a new backend process, disposable database and fresh independently created/accepted/explicitly verified browser pair. Version order alternates and size order rotates; only one stack/sample runs at a time. Fixture setup is outside transfer timers: baseline median/worst 5164.5/5927 ms and candidate 5243/5715 ms across 20 fixtures each. This is an HTTP-warm test/development stack after onboarding, not a production container/Render cold-start measurement.

Units below are milliseconds, median / worst. Send measures click to observed Sent UI; ready includes authenticated download, decoding, integrity checking, temporary output and Save-link observation. Playwright assertions poll and can add up to roughly a second; these are UI-observation timings, not precise HTTP or cryptographic latency. The 1.2 MiB candidate send outlier had its rendered Sent event substantially earlier than the assertion returned.

| Size | n/version | Baseline send | Candidate send | Baseline ready | Candidate ready |
|---|---:|---:|---:|---:|---:|
| 23 KiB | 5 | 384 / 391 | 381 / 389 | 177 / 180 | 179 / 180 |
| 170 KiB | 5 | 386 / 394 | 386 / 395 | 498 / 502 | 492 / 501 |
| 307 KiB | 5 | 890 / 893 | 890 / 895 | 396 / 419 | 392 / 418 |
| 1.2 MiB | 5 | 902 / 925 | 891 / 1902 | 891 / 938 | 404 / 896 |

All 40 outputs matched their source hashes and all 40 samples had zero HTTP 429 responses. Fresh standard-size timings are broadly similar; these measurements do not support a general claim of dramatic speedup for uncontended files.

## Larger exploratory samples

These controlled large samples have n=1/version/size, not five. Median/worst coincide but are not statistically stable; the separate earlier candidate probes and original near-limit two-way regression also passed. Repeatability at the ceiling remains a staging acceptance item.

| Size | Version | Send ms | Ready ms | HTTP 429 |
|---|---|---:|---:|---:|
| 4 MiB | baseline | 22986 | 66256 | 21 |
| 4 MiB | candidate | 2901 | 7935 | 6 |
| 8 MiB | baseline | 85294 | 132373 | 52 |
| 8 MiB | candidate | 9918 | 56115 | 57 |

For the candidate exact 8 MiB sample: Preparing lasted approximately 104 ms before chunk preparation. The 32 chunk preparation spans totalled approximately 257 ms (including source/codec/cache work); source reads took 29.2 ms and the measured AES-GCM encrypt API calls totalled 3.6 ms. Download-ready was 56115 ms. Sampled sender/recipient JS heap peaks were 134.7/49.7 MiB. These are bounded sampled observations, not total-process memory guarantees.

## Sustained sequence without resets

Each version uses one already-authenticated pair and backend for eight sequential files: 23 KiB, 170 KiB, 307 KiB, 1.2 MiB, then the same four again. No rate-limit reset, reconnect shortcut, quota increase or parallel transfer is used. These observations deliberately accumulate pressure and must not be treated as independent fresh samples.

| Step | Size bytes | Baseline send / ready ms | Candidate send / ready ms | Baseline / candidate 429 |
|---:|---:|---:|---:|---:|
| 1 | 23552 | 391 / 142 | 391 / 178 | 0 / 0 |
| 2 | 174080 | 383 / 4951 | 381 / 487 | 1 / 0 |
| 3 | 314368 | 29234 / 12937 | 2113 / 1905 | 10 / 2 |
| 4 | 1258291 | 46314 / 20990 | 6131 / 1906 | 16 / 5 |
| 5 | 23552 | 29250 / 8922 | 10161 / 3906 | 9 / 12 |
| 6 | 174080 | 25200 / 8926 | 9149 / 3914 | 8 / 11 |
| 7 | 314368 | 33274 / 12948 | 12166 / 6156 | 11 / 16 |
| 8 | 1258291 | 42297 / 24996 | 17184 / 10930 | 16 / 25 |

All sustained outputs verified. Summed Send+ready observations were 301.155 s baseline versus 87.058 s candidate (whole test times 312.11 s and 98.12 s, including fixture and automation overhead). Each sequence saw 71 HTTP 429s: baseline all prekey reads with Retry-After 4; candidate 37 prekey, 12 device-proof, and 22 file-endpoint requests with Retry-After 1. Observed retry waits summed to 284.292 s and 71.811 s respectively. For device-proof/file responses, source confirms the unchanged broad API limiter supplied the admission rejection; prekey responses with Retry-After 1 alone cannot distinguish that broad limiter from the new read limiter. Counts and Retry-After values by operation, observed retry-start waits, source reads, cryptographic API timings, memory samples and phase transitions are retained in [the allowlisted measurements](phase36-file-benchmarks.json).

## What the stage instrumentation establishes

- File selection/payload installation is timed separately from Send. Source reading remains bounded to 256 KiB slices; no new whole-file plaintext cache is introduced.
- WebCrypto metrics separate attachment manifest/chunk seal/open operation counts and durations. They exclude key import, base64 processing and manifest encoding; those costs are included in the full UI transfer timings. Standalone manifest construction was not independently timed.
- Uncontended full exchanges made exactly 24 API requests for one-chunk files, 30 for two chunks and 48 for five chunks, identically on both versions. These include 9/11/17 prekey reads and 8/10/16 device-proof requests. A 32-chunk exchange needs 210 such requests before retries. Source and counts confirm bounded sequential per-chunk authorization/transfer round trips; no request-count optimization or authentication bypass was introduced.
- HTTP measurements retain operation categories, status counts, relative times and response-header latency. Apart from numeric Retry-After values, they never retain URLs, request/response bodies, raw headers, nonce values, file keys, filenames or identities.
- Complete-to-Sent is explicitly a proxy: post-completion authorization, encrypted reference/outbox publication, rendering and assertion overhead. It is not an independent server delivery acknowledgement. Recipient hash verification proves the exercised file exchange, not a fabricated message ACK.
- Download-ready includes chunk reconstruction, AES-GCM integrity verification and authorized temporary output. Save/export performs an additional hash equality check on the downloaded synthetic bytes.
- Client memory is sampled JS heap at 500 ms with precise-memory instrumentation, not renderer/WASM/RSS or transient allocation maxima. No tested large sample showed memory exhaustion. The production 512 MiB backend/container memory envelope remains unvalidated.
- Rate limits are enforced normally. The prekey-only change retains burst 20 and uses refill 2/sec; mutation policy remains 20 with refill 0.25/sec. The broad API bucket remains 120/refill 2/sec. Two browser clients share a source IP, matching the shared-IP pressure possible behind one NAT.
- A never-returning network request has no newly introduced overall transfer deadline. The held-request test proves visible cancellation and concurrent chat, not automatic timeout recovery. Existing explicit 429 retries remain bounded; failed output is not exposed as verified.

## Limits and security review

An exact 8 MiB plaintext file uses 32 chunks and reserves 11,210,070 bytes (about 10.69 MiB) after ciphertext/base64 and conservative record overhead. It fits the existing 12 MiB sender quota alone; it cannot necessarily coexist with older files. A 1 MiB file reserves another 1,415,595 bytes, so those two reservations together exceed 12 MiB. Such quota rejection is intentional, not evidence of slow networking. No limits were increased in this phase.

Existing file-ledger security tests passed for authenticated participant/room/identity binding, generic unauthorized/missing-ID rejection, recipient-only available-chunk access, expiry/cancellation, concurrent read/mutation fences, tamper/size checks and quota enforcement. Read operations avoid ledger writes but recheck state and device trust after asynchronous object fetch. Atomic mutation/quota behavior is preserved. Authorization is evaluated at these checks; it cannot withdraw bytes already returned before a later revocation.

Negative tests cover unverified/changed identity, swapped binding, malformed geometry, invalid sizes/chunks/manifests, unavailable sealed cache, cancellation races and bad ciphertext. The candidate does not change E2EE, identity pinning, room admission, ACK/FIFO/mailbox authority, call signaling, Android storage, Firebase or any protected branch.

## Phase 3.6 changed files

Runtime: `client/src/product/fileTransferCopy.ts` only. Regression/measurement code: `client/src/product/fileTransferCopy.test.ts`, `e2e/file-failure-stability.spec.ts`, `e2e/file-stability.spec.ts`, and `service/src/files/workflow.test.ts` (deterministic fixture gate only). Evidence: this report, `PHASE36_STAGING_PLAN.md`, and `phase36-file-benchmarks.json` in docs/validation. The original four application commits remain ancestors; newer protected/integrated branches are untouched.

## Test disposition

- Unit/API regression group: 50 passed before the copy correction; its new sixth wording test then passed. Final post-change group: 51 tests passed across 12 suites.
- Disposable MongoDB: 13 passed (11 mailbox/index/lease/ACK integration cases and two read-only file cases). Candidate 307 KiB and 1.2 MiB direct read checks used 15 ms and 27 ms respectively, with zero ledger writes; these are not browser end-to-end or baseline speed comparisons.
- Authenticated Chromium: all 40 matched samples; all four large exploratory samples; both eight-file sustained sequences; the original near-limit BOTH-directions test; three initial progressive probes; and the two new rate-limit/cancel/chat recovery tests passed.
- The pre-fix deterministic/UI admission-rate assertions failed as expected and passed after the one-line correction. An initial injected response omitted CORS Retry-After exposure and was corrected to match the real backend before diagnosis.
- The final combined unit run exposed the pre-existing cancellation fixture race: it assumed output allocation two milliseconds after entering Downloading, although asynchronous manifest authentication precedes output creation. Replacing that delay with an explicit blocked-chunk-entry signal made the same assertions deterministic; the final 51 tests passed. No workflow runtime was changed.
- One initial combined unit/Mongo invocation caused nine unit fixture setup failures because MONGO_URI selected an uninitialized database path in unit fixtures. The correctly separated Mongo and unit invocations passed; this was harness configuration, not a candidate source regression.
- Focused browser identity/offline restart (8.6 s test time) and pending-selection supersession (9.0 s) passed. Backend and client production builds, standalone benchmark TypeScript, scoped ESLint and diff checks passed. Vite retained its existing large-bundle warning. Broader full-suite stress, non-Chromium browsers, physical Android, Render cold starts and production-mode staging are not claimed as tested.

## Staging and Android decisions

GO for the next controlled isolated Web/backend staging TEST, subject to the [prepared plan](PHASE36_STAGING_PLAN.md). This is not a production release verdict. Use separate secrets, authenticated disposable MongoDB, one bounded process, explicit request/memory limits, immutable build labels and served-asset hashes. The plan uses the existing Mac/Docker and needs no new cloud service. No staging service was deployed.

There is no new schema/index/protocol migration relative to the live baseline. Fresh staging still needs the existing idempotent index setup; a production rollback would restore the exact baseline image without a new data-format rollback. Production integration remains approval-gated. The separate F1b architecture is absent from this scoped candidate; no Firebase credentials or enablement are used.

Android A: Beta 21 already exposes editable HTTPS backend/socket addresses, but use an authorized isolated Android OS test profile and disposable accounts. Its installed owner vault must not be redirected into a disposable backend. A physical phone also cannot reach the loopback-only local stack and needs an approved, normally trusted HTTPS endpoint.

Android B: a diagnostic build is not justified by these browser/backend results. It could be proposed only if physical symptoms remain and OS-profile isolation/endpoint access cannot be supplied; an isolated application ID would protect owner data. No APK is authorized or built here.

Android C: NO-GO for a normal Beta 22 preparation on this evidence: this phase contains no verified Android correction. Any future same-app update needs versionCode above 21, package com.k3ncrypt.app and APK verification against the existing signer certificate. No key, vault, encrypted history, identity or installation was changed.

Remaining gates: repeated near-ceiling staging runs; production-mode image/TLS/revision and 512 MiB memory acceptance; sustained shared-IP latency acceptance; any still-unreproduced Preparing freeze; and eventual real network/device testing. The historical exact 72-second test decomposition and provider-managed Render cold-start latency remain unproven.
