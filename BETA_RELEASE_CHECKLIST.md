# K3NCRYPT v0.1.0-beta Release Checklist

**Current decision: NOT READY for distribution.** Android tooling and source builds are validated. Production service origins have not been configured, and no distributable signed release APK has been produced. A beta signing key has been created; its off-device backup is still required.

This is a release-operator checklist. Never commit deployment secrets, keystores, or passwords.

## Android APK

- [x] Android SDK, platform-tools, API 35, and JDK 17 are installed on the validation workstation.
- [x] Gradle wrapper is present; use `cd android && ./gradlew ...` for reproducible wrapper-based builds.
- [ ] Configure the real HTTPS API origin. Set `-Pk3ncryptBackendUrl=https://<beta-origin>` for release packaging.
- [ ] Configure the real HTTPS Socket.IO origin. It can use the same origin; otherwise set `-Pk3ncryptSocketUrl=https://<relay-origin>`.
- [x] Created a new PKCS#12 Android beta release keystore outside the repository with alias `k3ncrypt-beta`; its password is stored in macOS Keychain, not in chat or source control.
- [x] Created a mode-600 local backup copy in a separate application-support directory. [ ] Still make and verify an off-device encrypted backup before distributing the first APK; never lose this signing identity.
- [ ] Set signing inputs in the protected release environment: `K3NCRYPT_ANDROID_KEYSTORE_PATH`, `K3NCRYPT_ANDROID_KEYSTORE_PASSWORD`, `K3NCRYPT_ANDROID_KEY_ALIAS`, and `K3NCRYPT_ANDROID_KEY_PASSWORD`.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintRelease` and inspect the merged release manifest.
- [ ] After endpoint and signing inputs are configured, run `./gradlew :app:assembleRelease -Pk3ncryptBackendUrl=<https-origin> -Pk3ncryptSocketUrl=<https-origin>` and verify the APK signature with `apksigner verify`.
- [ ] Install the signed APK on a clean device and exercise secure unlock, QR contact setup, messaging, offline replay, and calling.

Release packaging now fails closed when HTTPS origins or valid signing inputs are absent. Debug builds remain suitable for local development; do not distribute them as production APKs.

## Web deployment

- [x] Production Vite configuration accepts same-origin API use when `CHATE2EE_API_URL` is blank.
- [x] If a separate API origin is configured, production build validation requires a non-placeholder HTTPS origin.
- [x] `npm run client:build` succeeds. Vite reports one JavaScript chunk over 500 kB; review startup performance before broad beta distribution.
- [ ] Select the real HTTPS web/API origin and configure TLS, certificate renewal, and reverse-proxy routing.
- [ ] Verify production browser configuration and the deployed bundle against the chosen origin.
- [ ] Do not publish internal service SDK source maps unless source-map distribution is intentional.

## Backend deployment

- [x] Production backend configuration rejects missing persistent Mongo settings, absent HTTPS origin allowlist, absent chat-link domain, weak/placeholder device-proof secret, debug logging, and unsupported multi-instance mode.
- [x] `.env.production.sample` is a blank template for deployment-specific values; it is intentionally not runnable and contains no deployment secret.
- [x] Production configuration tests pass, including placeholder/HTTP-origin rejection.
- [ ] Set `NODE_ENV=production`, `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, and `K3NCRYPT_ALLOWED_ORIGINS` to real deployment values.
- [ ] Generate `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` with a cryptographically secure secret manager; keep it at least 32 characters and out of source control.
- [ ] Set `K3NCRYPT_TRUST_PROXY=true` only when the application is behind the reviewed trusted proxy; otherwise configure the production proxy topology before enabling it.
- [ ] Keep `K3NCRYPT_INSTANCE_COUNT=1` until a reviewed cross-instance Socket.IO adapter is deployed.
- [ ] Keep `CHATE2EE_ENABLE_DEBUG_LOGS=false` and confirm production logs contain no private content, tokens, invitation payloads, or cryptographic material.
- [ ] Configure production ICE/STUN/TURN infrastructure and populate `CHATE2EE_ICE_SERVERS` as appropriate before claiming calling works across restrictive NATs.

## Database and operations

- [ ] Provision persistent MongoDB with authentication, network restrictions, TLS where supported, automated backups, and tested restore procedures.
- [ ] Use a dedicated least-privilege database user; do not use root credentials for the application.
- [ ] Verify required indexes/readiness checks against the deployment database before accepting beta accounts.
- [ ] Document retention, monitoring, incident response, and recovery ownership.

## Security verification

- [x] Static review confirms Android release network policy does not include the debug-only emulator cleartext exception; app backup is disabled and only the launcher activity is exported.
- [x] Android debug inspection is in the debug source set; release builds use the release source set and do not package the debug inspection implementation.
- [x] Production frontend defaults to same-origin when no API origin is provided; production debug logging remains disabled by runtime configuration.
- [x] No release credential or production endpoint has been placed in source files.
- [ ] Inspect the packaged release manifest and bundle; confirm no development endpoints, test unlock paths, debug UI, or secrets are included.
- [ ] Complete device-level tests for identity setup, secure unlock, fingerprint verification, revoked-device rejection, message persistence/acknowledgement, and call permission handling.
- [ ] Confirm incident contact and private vulnerability-reporting process before inviting external testers.

## Current validation record

| Check | Result |
|---|---|
| `git diff --check` | Passed during this release-preparation pass. |
| Production configuration Jest suite | Passed: 2 tests. |
| Full Jest | Passed: 100 suites, 471 tests; 3 suites and 7 tests skipped for environment-dependent coverage. |
| `npm run lint` | Passed. |
| `npm run client:build` | Passed with a chunk-size warning. |
| `npm run build-service-sdk` | Passed; generated build includes an internal source map. |
| Android all-module `./gradlew test` / `:app:assembleDebug` / `:app:lintRelease` | Passed with Gradle 8.9, JDK 17, and Android SDK 35. One debug-only test was moved to the debug test source set so release tests compile correctly. |
| Android `:app:assembleRelease` | Blocked as intended: `verifyReleasePackageInputs` rejected the blank API origin. No signed APK was produced. A stale unsigned build artifact was cleared with Gradle clean. |
| `npm audit` | Passed: zero vulnerabilities reported. |
| Real deployment / device beta test | Not performed. |

## Required release inputs

The deployment team must supply the actual HTTPS web/API/Socket.IO origins, MongoDB deployment and database credentials, generated device-proof secret, approved ICE/TURN configuration, and an off-device encrypted backup of the Android signing key. Store signing credentials and deployment secrets only in a protected local or CI secret store, never in chat or this repository.

## Remaining limitations

- A local build does not validate a deployed service, database, TLS setup, or real-device operation.
- No production endpoints have been selected. Android API and relay origin default to the same configured origin unless deployment architecture requires separation.
- The signing identity is configured locally, but its off-device backup must be completed and tested before distribution.
- Mongo/environment-dependent integration tests were skipped in this run; they must be run against the release validation environment.
- Cross-network calling depends on deployment ICE/TURN availability; it has not been confirmed by this release pass.
- The web production bundle has a chunk slightly above 500 kB.
