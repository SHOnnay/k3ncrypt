# Phase 4 milestone closure

Date: 2026-09-20. Scope: Phase 4 foundations, product integration, security preparation, and the final Chromium validation gate. This is a milestone checkpoint, **not** a production-readiness certification or approval to enable `modern-default-beta`.

## Completed work

- Client-side encrypted attachment preparation, chunk encryption/integrity checks, metadata separation, delivery lifecycle, persistent adapter contracts, and Mongo ciphertext persistence.
- Authenticated attachment service and route factory with scoped capabilities, conversation authorization, generic errors, expiry, and bounded uploads. The client HTTP gateway and media workflow carry an E2EE-protected reference; image/file/voice UI handles local display, export, and playback where the gateway is available.
- Voice recording foundation requests microphone access only after user action and stops tracks when recording ends.
- Verification UX presents public fingerprints and canonical QR *payload data*, validates pasted codes, and requires explicit comparison before marking a contact verified. Changed identities show pending review and do not automatically inherit trust. No camera scanner was added.
- Conversation policy supports `legacy-default`, `modern-explicit`, and a gated `modern-default-beta` value. The repository default remains legacy. Existing persisted modes are authoritative; no migration or protocol downgrade is introduced.
- A reproducible security-check script and CI workflow cover tests, builds, dependency audit, Rust checks, and the browser matrix. Isolated Playwright backend/client ports and an exact test-origin CORS allowlist made the Chromium modern conversation flow reproducible.

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
| Jest backend/service/client | 55 suites passed; 291 tests passed, 1 skipped |
| Service TypeScript | Passed (`tsc --noEmit -p service/tsconfig.json`) |
| ESLint | Passed |
| Client production build | Passed |
| npm audit, high severity threshold | 0 vulnerabilities |
| Chromium modern Alice/Bob E2E | Passed: creation, offline message, verification persistence, restart, two-way messaging, traffic/storage plaintext assertions |
| Git diff whitespace check | Passed |

The Chromium E2E backend used volatile in-memory room storage because Mongo was unavailable in this local test environment. The prior invitation failure was caused by missing CORS allowlisting between the two isolated test ports; the Playwright configuration now specifies only its exact client origin. This did not loosen production CORS policy.

## Known limitations and decision

- The production attachment route factory still needs composition with a deployment-provided authenticated session verifier and persistent Mongo adapter. Do not claim live production media delivery before that composition is deployed and tested.
- Firefox and WebKit full modern-conversation flows have not passed this milestone gate. Rust validation was not performed locally because `cargo` is unavailable; CI has a pinned Rust toolchain and mandatory checks, but its run result is not asserted here.
- Production Mongo persistence, multi-instance/restart recovery, deployment log review, performance measurements, and multi-device enrollment/revocation require separate evidence.
- The current UI offers canonical QR data for display/copy/paste; it does not generate a scannable QR image or request camera permission.
- Verification depends on an independent comparison. A compromised endpoint, malicious browser extension, first-contact impersonation before verification, or traffic analysis remains outside this protection boundary.

**Milestone state:** Phase 4 implementation and Chromium integration checkpoint complete. Keep `legacy-default` as the production fallback and `modern-explicit` for controlled validation. Do not enable `modern-default-beta` or start Phase 5 until the outstanding browser, Rust/CI, deployment-authentication, persistence, and recovery gates are reviewed.

## Remaining roadmap

1. Run the full browser matrix and Rust/WASM CI with recorded artifacts.
2. Validate the authenticated attachment gateway with production-equivalent session context and persistent Mongo, including restart/failover and data inspection.
3. Complete identity-change recovery and multi-device acceptance criteria, then separately approve or reject a narrowly scoped modern-default-beta rollout.
4. Only after these gates, conduct a separate security design review for any Phase 5 call work.

## Local milestone sequence

The earlier Phase 4 foundation and media commits from `4b61cbd` through `873b15e` are already on `origin/main`. This checkpoint additionally includes the unpushed local sequence `95b181a` (beta readiness audit), `ffbaa92` (validation infrastructure), and `79cf3c6` (Chromium E2E CORS fix), followed by this documentation-only milestone commit. None is pushed by this closure task.
