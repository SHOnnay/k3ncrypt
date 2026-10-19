# Phase 4C — protected-file failure classification

## Confirmed findings and correction to Phase4B interpretation

Not every HTTP429 denotes rate admission. V2 deliberately uses429 with `{failure:"quota"}` for bounded account storage/reservation exhaustion. One8MiB file reserves11,210,070 encoded bytes including overhead. Two retained files would reserve22,420,140 bytes against the existing12,582,912-byte limit. The immediate repeated8MiB rejection is therefore expected, not evidence that rate quotas should increase. Phase4B recorded the status but did not retain its response category; its claim of misleading quota feedback for that particular repeat was not established.

The confirmed client defect was inference: only a Retry-After header of1–5seconds counted as rate limiting; every other429 became quota. This misclassifies admission errors with absent, longer, date-form or unavailable CORS headers. Separately503 wording could describe local storage exhaustion instead of temporary service failure, and authorization lacked clear fixed feedback.

Runtime correction commit: `91a142b737d6846671c1c3b197f4fa01594f1955`.

## Minimal correction

- `client/src/media/fileHttpFailure.ts`: fixed privacy-safe error categories; only explicit V2 `failure=quota` under429 produces quota. Other429 responses conservatively mean rate-limited/busy. Error body parsing is capped at1024bytes/1second and its reader is canceled; no raw body escapes.
- `client/src/media/HttpFileGateway.ts`: uses this classifier; no change to protocol, success parsing, identities, encryption, limits or admission.
- `client/src/product/fileTransferCopy.ts`: fixed distinct labels for rate limiting, actual quota, temporary service unavailability and permanent authorization failure. No invented verification or successful delivery.
- Existing shared rate helper is unchanged: up to4attempts total, only explicit numeric Retry-After1–5seconds, abortable waits; no uncertain5xx/authorization/quota retry or automatic long-delay retry. Longer/invalid/absent delays terminate for manual recovery rather than waiting indefinitely. Real backend quota replies have no retry header. No new unlimited queue or permanent Preparing state.

## Tests and executed environment

- PASS36 deterministic cases across file failure/gateway, presentation, rate helper and existing workflow tests. Covers explicit quota, unknown429, absent/long/date headers, bounded body/deadline, unauthorized/expired/conflict/unavailable states, four attempts with no early retry, cancellation and encrypted workflow behavior.
- PASS production client TypeScript+Vite compilation; existing large bundle warning retained. PASS changed-file ESLint and diff checks.
- PASS4 unique authenticated Chromium scenarios: injected admission429 with exactly4 attempts and subsequent real transfer; cancelable preparation with late-result fencing and encrypted chat; interrupted chunk retry/cancellation/next transfer/reload; real8MiB integrity download, actual repeated8MiB quota rejection, and smaller-file recovery. First three passed in12.8/8.7/52.7seconds. Final scenario passed in1.7minutes;8MiB send20,602ms/download62,203ms with exact hash match.
- Initial combined browser run had3passes/1test-harness failure: Playwright could not retrieve a rejected response body after the gateway canceled its reader. The focused observer was corrected to inspect the unchanged authenticated upstream response before forwarding, retaining only a quota-category boolean. Only that failed scenario was rerun and passed. No product failure was hidden or server rejection mocked in the real-quota scenario.
- Observed stage app cgroup peak99,852,288bytes (95.2MiB) under512MiB; no observed OOM. Loopback stage and temporary secrets were removed after testing; synthetic browser files/failure outputs were removed.

Backend remains exact cached Phase3.9 runtime (`62650cf5`, image`eab54fa08898aa6768d01a377db899dfda77ed763ddaeef681963559e2ce4f77`); `8f8fb362` is documentation-only above it. New frontend is built from this branch and mounted read-only into the existing app via explicit `start-reviewed-client`. Source protocol and authorization are unchanged. Disposable authenticated MongoDB, synthetic encrypted files and independent disposable account identities only. App512MiB/1CPU/heap320MiB, proxy published solely127.0.0.1:3453; no Mongo/app host ports. No owner identities, databases, production requests, secrets or external exposure.

Local reproduction after client compilation:

```sh
npm run client:build
node scripts/staging/phase4b/loopback.cjs start-reviewed-client
K3NCRYPT_PHASE4C_FILES=true node node_modules/@playwright/test/cli.js test --config=playwright.phase4b.config.ts e2e/file-failure-stability.spec.ts e2e/phase4c-file-feedback.spec.ts e2e/file-usability.spec.ts --grep 'pre-allocation 429|preparing remains cancelable|real repeated maximum|retry, cancel, next transfer'
node scripts/staging/phase4b/loopback.cjs stop
```

The browser TLS exception is local testing only, never a phone configuration. Do not run these fixtures remotely. No new backend image or production migration is required for the Web classifier.

## Private phone connection plan — no exposure performed

Use the owner's Mac and Android on an explicitly authorized private Wi-Fi. The existing separate `com.k3ncrypt.app.stabilization` diagnostic APK supports Advanced runtime HTTPS settings; it must use disposable identities and never import Main vault data. The newly packaged MainBeta22 is a different test stream and retains its existing Main origin; do not silently redirect it.

Before any LAN listener or DNS/firewall change, obtain approval for all of:

1. Dedicated staging hostname controlled by the owner, private DNS resolution to the Mac, a normally Android-trusted certificate matching that hostname, and secure local certificate-key handling. A DNS-validated certificate can avoid Internet-serving exposure, but domain/DNS issuance actions need owner approval. No self-signed/user-certificate trust bypass, cleartext or disabled TLS verification.
2. Exact Mac LAN interface, authorized phone source restriction, request lifetime and test window. A helper must implement/verify approved host/firewall/proxy restrictions, covering API, all Socket.IO paths and direct bypasses. An unguessable URL, ordinary Wi-Fi password or Basic-auth gate unsupported by the APK is not sufficient application access control.
3. Reverse proxy bound only to the approved LAN endpoint, internal-only app/Mongo, current strict V2-route policy, correct HTTPS/Host/origin forwarding, FCM disabled, separate disposable credentials and finite resource limits. Keep all production domains, identities and databases out of the configuration.
4. Verify the certificate chain from Android and deny access from an unauthorized test client before entering the staging HTTPS/API/socket origin in the diagnostic app. Confirm exact served revisions and health. Do not expose a tunnel, WAN/router port or public stage without separate approval.

No suitable trusted phone-reachable certificate/hostname and access rules were configured in this task. Owner must choose/approve that arrangement. Localhost on the phone cannot reach the Mac. If local networking cannot provide these controls, stop and review a separately approved private-network solution; do not install software or silently fall back to public hosting.

Cleanup: stop the ownership-labeled stage, remove its approved LAN binding/access-rule changes and disposable local DNS mapping if later introduced, remove temporary stage secrets/certificate and disposable accounts. Never delete Main app data, signing material or production configuration. Resources from this task are cleaned separately below.

## Verdict

GO for review/private controlled testing of this Web correction; no capacity increase or production release is implied. Rate limits and actual storage quota remain authoritative and unchanged. Sustained throughput is not claimed improved by a feedback correction. Physical Android behavior, access-control/TLS setup and independent staging exposure require owner approval/testing. No production hotfix integration, Android implementation change, Firebase enablement or new APK occurred in this branch.

## Disposable volume cleanup check

Mongo image declarations create anonymous data volumes even without explicit volume flags. Ownership-fenced stop now uses container removal with`-v` to remove only its anonymous volumes. The initial stage's exact two volumes were identified by matching its destroy/unmount event container IDs, verified unreferenced, then removed; no global prune or name/time guess was used. Fresh startup/stop verification confirms its two anonymous volumes disappear. No unrelated database/container/volume was changed.
