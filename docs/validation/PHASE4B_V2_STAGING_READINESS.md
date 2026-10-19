# Phase 4B — isolated V2 staging readiness

## Source and isolation

Branch `codex/phase4b-v2-staging`, based on `8f8fb3625106f8e914f7977e4e9aed0197aef6b0`. No application runtime code was changed. Source contains the Phase 3.8 trust-revocation fences and V1 BSON correction. Compared against production hotfix `f3aab1d64edf47a6f84b4c5bafc52ebace94855f`: attachment trust, authenticated authorization and BSON adapter files are byte-identical; staging retains its separately validated optimized ledger reads. No blind security cherry-picks were performed.

Cached image `sha256:eab54fa08898aa6768d01a377db899dfda77ed763ddaeef681963559e2ce4f77` is the existing Phase 3.9 candidate built at `62650cf5`; `8f8fb362` changes documentation only. Served frontend/compiled backend were compared against that local artifact. The harness intentionally refuses a missing exact image; a different image requires renewed revision verification.

V2 uses separate routes and ledger serialization. Shared authentication/index readiness remains required. The strict `attachmentPolicy.cjs` checks actual V2 route shapes, preventing malformed V2-looking paths from falling through to V1. V1 is blocked at this staging proxy only, never in production. Tests include zero legacy CRUD during an authenticated V2 flow. FCM remains disabled; no Firebase credentials are used.

## Local startup and cleanup

From this worktree, with existing Docker/Node/OpenSSL available:

```sh
node scripts/staging/phase4b/loopback.cjs start
# inspect only this disposable stage in a local browser
node scripts/staging/phase4b/loopback.cjs stop
```

The harness creates fresh authenticated MongoDB, random test-only secrets and a one-day self-signed local certificate in a mode-0700 temporary directory (secret files mode0600). App limit: 1 CPU, 512 MiB, Node heap320 MiB. Mongo limit1536 MiB; proxy128 MiB. Only proxy host binding is `127.0.0.1:3453`; app/Mongo have no published ports. Fixed Host allowlist is `phase4b.localhost:3453`. No LAN or Internet endpoint is created. Never reuse production secrets/accounts/data.

New resources carry a random ownership label and local receipt. Startup refuses colliding names. Stop verifies every surviving resource label before deleting any resource; without the receipt or with mismatched ownership it refuses cleanup. If startup fails, preserve the receipt and run stop; do not remove unrelated Docker resources. There is no persistent database volume. Stop removes only owned stage containers/networks and temporary secrets/certificate. Cached images are retained.

This self-signed HTTPS certificate is **browser-test only**; Playwright's TLS exception is not an Android staging solution. No host trust store, firewall, router or DNS configuration is changed.

## Executed validation

- PASS: 6 focused Jest suites, 76 cases, using disposable authenticated MongoDB. Includes deterministic revocation races, BSON bytes, V2 isolation, ledger, route and authority regressions.
- PASS: 3 authenticated Chromium tests: invitation/verification and encrypted conversation establishment; disconnected recipient/replay; application restart, unlock and retained history. Recovery/restart-to-receipt measurements: 5812ms and3973ms in these controlled local fixtures. This is not physical Android evidence.
- Initial sustained transfer matrix: 23KiB send906ms/download141ms;170KiB897/371ms;307KiB1095/1900ms;1.2MiB6128/1890ms;4MiB34225/32002ms. All five plaintext hash/integrity comparisons passed after authenticated encrypted transport.
- HTTP429 counts respectively0,0,1,5,60. Existing bounded retry waits were approximately1second where measured. The subsequent8MiB create returned429 and the UI reported file storage quota; no chunk transfer began. The benchmark correctly FAILED. Rate limits were not disabled/increased. This does not establish actual storage quota exhaustion.
- Additional repeated8MiB result: First standalone8MiB send9944ms/download55117ms, integrityPASS,55 HTTP429 responses handled. Immediate repeat failed at create with429 and the same misleading quota presentation; no chunks began. Thus the two-repeat benchmark FAILED, not a sustained-transfer PASS..
- App peak before the additional test was73,601,024bytes under512MiB. Observed application peak during8MiB testing91,811,840bytes (87.6MiB), no observed OOM. This is a sampled cgroup peak before final cleanup, not a claim about unmeasured workloads.. This is local Docker memory, not Render/phone performance.
- Cancellation/fault tests: PASS: existing authenticated retry/cancel/next-transfer/oversize/reload Chromium fixture,21.3seconds. It tests interrupted upload, byte-identical retry, cancellation and subsequent transfer with integrity..
- Tooling syntax/diff and startup/cleanup verification: PASS: Node syntax and diff checks. Fresh reusable harness start succeeded; readiness200 and V1 denied404. Duplicate start refused. A deliberately mismatched ownership receipt refused cleanup before removing anything; restored receipt allowed stop. All own containers/networks/temp secrets were removed..

No payloads, real filenames, identifiers, private accounts, auth headers or secrets are included in the report. Browser automatic failure output can contain disposable test state and remains temporary, not committed.

## Phone-reachable HTTPS: requires owner approval

The existing separate `com.k3ncrypt.app.stabilization` APK supports runtime Advanced connection settings with blank backend defaults and platform TLS. No rebuild is required merely to enter an approved compatible HTTPS origin. The Main Beta21 installation is not changed. Use disposable identities exclusively.

No normally Android-trusted, phone-reachable HTTPS origin has been established here. Localhost refers to the phone itself and will not reach this Mac. A self-signed certificate or a browser exception must not be used as an Android trust bypass.

Preferred local option requires: an owner-controlled hostname with a normally trusted certificate and private key retained only locally; LAN DNS reaching the Mac; an explicitly approved proxy LAN binding restricted to the authorized phone(s), correct Host/origin and Socket.IO routes; existing firewall/access controls covering all endpoints; bounded stage lifetime and disposable data. Certificate DNS validation may avoid public endpoint exposure but still requires owner-controlled DNS. Do not open router ports or alter firewall/DNS without approval. Do not export addresses in reports.

If existing local resources cannot meet TLS/access restrictions, a separately approved temporary HTTPS host/tunnel is an alternative only after reviewing access controls, origin/socket authentication and data retention. An unguessable URL is not access control. Do not add a Basic-auth gate that the APK cannot support. Any gate must be compatible with native HTTP and Socket.IO and reject unauthorized devices; no paid plan or public tunnel is approved.

Before phone testing: owner chooses the TLS/hostname/access-control arrangement and authorizes exact exposure scope/lifetime. Helper verifies trusted certificate chain on Android, all API/socket paths, V1 deny policy and no direct backend/Mongo bypass. Configure only the diagnostic APK's Advanced HTTPS/API/socket settings, create disposable accounts, test and then remove only the diagnostic app if desired. Do not uninstall Main, import its identity or change production.

## Verdict and rollback

NO-GO for claiming full sustained-transfer acceptance: the burst429 failure remains. NO-GO for actual phone-reachable staging until trusted TLS, endpoint scope/access restrictions and exposure approval exist. Local authorized functional staging is useful; no production deployment or physical acceptance is implied.

Rollback is stop/remove only this disposable stage and its temporary secrets; no production data or identities require restoration. Keep source commits and cached images for reproducibility. Review the429 classification/retry failure separately before calling large-file behavior reliable.
