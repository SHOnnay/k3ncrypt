# Phase 4 milestone closure

Date: 2026-09-20. Scope: Phase 4 foundations, product integration, security preparation, and final local validation gates. This is a milestone checkpoint, **not** a production-readiness certification or approval to enable `modern-default-beta`.

## Completed work

- Client-side encrypted attachment preparation, chunk encryption/integrity checks, metadata separation, delivery lifecycle, persistent adapter contracts, and Mongo ciphertext persistence.
- Authenticated attachment service and route factory with scoped capabilities, conversation authorization, generic errors, expiry, and bounded uploads. The client HTTP gateway and media workflow carry an E2EE-protected reference; image/file/voice UI handles local display, export, and playback where the gateway is available.
- Voice recording foundation requests microphone access only after user action and stops tracks when recording ends.
- Verification UX presents public fingerprints and canonical QR *payload data*, validates pasted codes, and requires explicit comparison before marking a contact verified. Changed identities show pending review and do not automatically inherit trust. No camera scanner was added.
- Conversation policy supports `legacy-default`, `modern-explicit`, and a gated `modern-default-beta` value. The repository default remains legacy. Existing persisted modes are authoritative; no migration or protocol downgrade is introduced.
- A reproducible security-check script and CI workflow cover tests, builds, dependency audit, Rust checks, and the browser matrix. Isolated Playwright backend/client ports and an exact test-origin CORS allowlist made the Chromium modern conversation flow reproducible.
- Final hardening added a route-to-persistent-store integration test for ciphertext-only storage, capability denial, cross-conversation denial, restart access, and explicit absence of the test-authenticated route from the default app. Multi-device limitations and future requirements are documented separately.

## Architecture

```text
Browser: media selection/recording → local validation/encryption
       → MediaMessageWorkflow → HTTP attachment gateway
       → authenticated route → conversation authorization
       → AttachmentService → persistent adapter → Mongo ciphertext

Browser: encrypted media reference → existing modern E2EE session
       → opaque relay/offline mailbox → recipient modern session
       → authorized ciphertext retrieval → local integrity check/decryption
       → temporary display, playback, or export
```

The attachment server does not decrypt media or receive media content keys. Only the existing E2EE conversation carries the protected reference. An unavailable backend or missing authenticated gateway yields an unavailable state, not simulated delivery.

## Security-boundary review

Comparing the Phase 4 baseline (`4b61cbd`) through this checkpoint shows **no changes** to `crypto-wasm/`, `service/src/core/`, `service/src/storage/`, `service/src/transports/`, `backend/db/`, or `backend/socket.io/`. The only changes under `service/src/crypto/` concern creation-policy selection and its tests; under `service/src/identity/` they are QR payload and recovery presentation helpers and tests. Vodozemac implementation, key generation/storage, session protocol, mailbox protocol, encrypted vault, message framing, transport, and legacy behavior were not changed by this milestone. Tests retain fail-closed downgrade, identity-change, capability, expiry, and tamper assertions.

## Final integrated validation

| Check | Result |
| --- | --- |
| Jest backend/service/client | 56 suites passed; 293 tests passed, 1 skipped |
| Service TypeScript | Passed (`tsc --noEmit -p service/tsconfig.json`) |
| ESLint | Passed |
| Client production build | Passed |
| npm audit, high severity threshold | 0 vulnerabilities |
| Chromium Playwright matrix | 8/8 passed, including modern Alice/Bob creation, offline message, verification persistence, restart, two-way messaging, traffic/storage plaintext assertions |
| WebKit Playwright matrix | 8/8 passed, including recipient reopening after offline delivery |
| Firefox Playwright matrix | Browser binary installed, but the macOS host denied the `plugin-container.app` sandbox extension (`Operation not permitted`); the process stalled before its first test action |
| Rust fmt/test/clippy/WASM build | Passed with installed Rust 1.89.0 and `wasm32-unknown-unknown`: fmt check, 5 unit tests, clippy with warnings denied, release WASM build |
| Git diff whitespace check | Passed |

The Chromium E2E backend used volatile in-memory room storage because Mongo was unavailable in this local test environment. The prior invitation failure was caused by missing CORS allowlisting between the two isolated test ports; the Playwright configuration now specifies only its exact client origin. This did not loosen production CORS policy. The WebKit reopen failure was traced to the browser test closing a tab without dispatching `beforeunload`: the application's 15-second local tab lease was therefore still active, producing “This secure conversation is active in another tab.” The test now closes with `runBeforeUnload: true`, exercising the existing application cleanup; no IndexedDB, cryptographic restore, or lock-security code was changed.

## Final security review

The default API router does not mount attachment routes, so no test-header authentication can be reached through production app composition. The route factory requires an injected verifier and returns a generic unavailable error on missing/invalid context. The persistent store hashes capabilities, retains encrypted metadata and ciphertext chunks, and rejects wrong capabilities and cross-conversation access in integration tests. The client media provider remains unavailable without an injected authenticated workflow; there are no public media URLs or server-side decrypt/preview paths. The integration fixture stores neither plaintext media nor content keys. This is a code-level review, not a forensic inspection of a production database.

Repository inspection found no Phase 4 debug bypass in the attachment path. Production configuration rejects enabled debug logging, and the Playwright CORS origin is supplied only to its child test backend (`NODE_ENV=test`); production CORS rules were not changed. Existing socket rejection logs are generic. Deployment log, secret-management, and credentials reviews remain required before enabling media routes.

## Remaining deployment requirements and limitations

- The production attachment route factory is **not mounted** by the default app. It still needs composition with a deployment-provided authenticated session verifier, durable attachment-access registry, and persistent Mongo adapter. The new integration test uses a clearly isolated test context and durable in-memory fixture; it does not substitute for production Mongo/auth validation. Do not claim live production media delivery before that composition is deployed and tested.
- Firefox browser binaries are present, but this macOS host denies Playwright Firefox's `plugin-container.app` sandbox extension (`Operation not permitted`) and reports a graphics-compositor framebuffer error. Both headless and headed runs stalled before test actions. This is an environment limitation, not evidence of a protocol failure; run the same unweakened suite on a supported CI host.
- Rust tools were already installed under `~/.cargo/bin` but absent from the shell `PATH`. Local Rust 1.89.0 fmt, test, clippy, and WASM checks passed. Record the corresponding CI artifacts before deployment.
- Production Mongo persistence, multi-instance/restart recovery, deployment log review, performance measurements, and multi-device enrollment/revocation require separate evidence. See [multi-device limitations](PHASE4_MULTI_DEVICE_LIMITATIONS.md).
- The current UI offers canonical QR data for display/copy/paste; it does not generate a scannable QR image or request camera permission.
- Verification depends on an independent comparison. A compromised endpoint, malicious browser extension, first-contact impersonation before verification, or traffic analysis remains outside this protection boundary.

**Milestone state:** Phase 4 implementation and local Chromium, WebKit, and Rust validation are complete. Keep `legacy-default` as the production fallback and `modern-explicit` for controlled validation. Do not enable `modern-default-beta` or start Phase 5 until the outstanding Firefox/CI, deployment-authentication, persistence, and recovery gates are reviewed.

## Remaining roadmap

1. Run Firefox on a supported CI host and retain browser-matrix and Rust/WASM CI artifacts.
2. Validate the authenticated attachment gateway with production-equivalent session context and persistent Mongo, including restart/failover and data inspection.
3. Complete identity-change recovery and multi-device acceptance criteria, then separately approve or reject a narrowly scoped modern-default-beta rollout.
4. Only after these gates, conduct a separate security design review for any Phase 5 call work.

## Local milestone sequence

The earlier Phase 4 foundation and media commits from `4b61cbd` through `873b15e` are already on `origin/main`. The local, unpushed sequence includes `95b181a` (beta readiness audit), `ffbaa92` (validation infrastructure), `79cf3c6` (Chromium E2E CORS fix), `bd98f11` (milestone documentation), and `d5e71f5` (security acceptance tests), followed by this final browser/Rust hardening checkpoint. None is pushed by this closure task.
