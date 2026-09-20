# Phase 4.7 Modern-Default Beta Readiness

Date: 2026-09-20  
Scope: validation only; no crypto, protocol, storage, mailbox, media, or identity implementation changes.

## Recommendation

**Not ready for controlled modern-default-beta rollout.** The service and security regression suites pass, but the required browser gate did not complete in a clean isolated environment. Chromium failed before modern invitation creation, and Firefox/WebKit were not run. Resolve the environment/startup issue and repeat the browser matrix before enabling the beta flag.

## Tested components

- Modern conversation session creation, persistence, restart recovery, continued messaging, and legacy-envelope rejection.
- Legacy policy compatibility and persisted-mode immutability under `modern-default-beta`.
- Vodozemac identity persistence, TOFU/unverified first contact, explicit verification, identity change detection, pending review, and session blocking.
- Canonical QR payload validation, invalid/reordered/augmented payload rejection, and verification-state projection.
- Attachment encryption/decryption, chunk integrity, modified ciphertext rejection, missing/reordered chunk rejection, expiry, duplicate protection, restart recovery, capability authorization, and cross-conversation rejection.
- Secure vault tamper detection, AAD binding, and absence of plaintext persistence.
- Media workflow image/file reference flow and encrypted chunk handling.
- Backend attachment routes, authenticated attachment service, offline mailbox bounds, and protocol security invariants.

## Passed validation

- Jest: 55 suites passed, 291 tests passed, 1 skipped.
- TypeScript service check: passed.
- ESLint: passed.
- Client production build: passed.
- `git diff --check`: passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Automated security tests passed for:
  - protocol downgrade and legacy-envelope rejection;
  - invalid QR payloads;
  - changed identity requiring review and explicit recovery;
  - wrong attachment capability and wrong conversation access;
  - modified ciphertext and integrity failures;
  - expired attachment access;
  - persistent adapter restart recovery;
  - storage records not retaining attachment keys or plaintext capability tokens.

## Browser validation

Attempted the existing isolated Playwright modern-conversation flow with one worker. Chromium failed before the invitation was created: the UI reported that the private contact could not be created. The configured backend port (`3001`) also had an existing listener that was not usable by the test process, so a clean controlled startup was not available. This is an environment/test-infrastructure failure, not evidence that the modern protocol passed in a browser.

Firefox and WebKit were not run because the Chromium gate did not establish a valid environment. No browser result should be treated as beta acceptance until all available browser engines pass from clean, isolated ports with deterministic startup and shutdown.

## Failed or incomplete checks

- End-to-end Alice/Bob browser flow: incomplete (Chromium setup failure before session creation).
- Browser storage/network leakage assertions: not reached by the failed flow.
- Firefox/WebKit compatibility: not run.
- Rust tests: unavailable because `cargo` is not installed in this environment.
- Per-operation performance timings (message creation, restore, upload/download, encrypt/decrypt): no benchmark harness exists; the Jest run provides only aggregate runtime, not acceptance-grade measurements.

## Storage and privacy findings

Automated persistence tests inspect the adapter boundary and confirm that attachment records do not contain encryption keys or plaintext capability tokens. Attachment crypto tests confirm ciphertext differs from plaintext and that tampering fails integrity checks. Secure-vault tests confirm authenticated ciphertext storage and AAD binding. No test or implementation path was found that intentionally stores message plaintext, media plaintext, filenames, filesystem paths, passwords, or private identity material in attachment storage.

These are code-level findings; production Mongo/object-storage inspection and log-retention review remain deployment responsibilities.

## Known limitations and remaining risks

- Browser startup/port isolation is currently a release blocker.
- Browser engine coverage is incomplete until Chromium, Firefox, and WebKit (where supported) pass.
- Multi-device enrollment, revocation, and recovery remain outside this phase.
- Endpoint compromise, malicious browser extensions, and traffic-analysis metadata remain outside the E2EE boundary.
- Performance acceptance thresholds are not defined or measured per operation.
- Rust/WASM native test execution requires a toolchain that is absent from this environment.

## Acceptance decision

Keep production policy at `legacy-default` and use `modern-explicit` only for controlled testing. Do not enable `modern-default-beta` until the browser environment is isolated and reproducible, the supported browser matrix passes the complete Alice/Bob and verification flows, performance sanity measurements are recorded, and the Rust/WASM test toolchain (or an equivalent CI result) is available.

