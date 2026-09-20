# K3ncrypt Phase 1–5 security audit

Audit date: 2026-09-20  
Scope: repository source, tests, configuration, browser/client boundaries, Phase 1 through Phase 5.  
Method: source review, threat modeling, targeted pattern searches, existing security tests, TypeScript/lint/build/audit/Rust validation. This is a repository audit, not a penetration test of a deployed environment.

## Executive summary

The reviewed code preserves the intended separation between local cryptography, opaque server relays, encrypted attachment/media references, and browser call transport. Existing tests cover Vodozemac/session tampering, replay and downgrade behavior, vault integrity, attachment authorization/integrity, identity changes, call lifecycle, permission denial, and media cleanup. No embedded secret, plaintext media persistence path, unsafe HTML rendering sink, wildcard production CORS configuration, or production-mounted test authenticator was found in the reviewed tree. The call-signaling integrity and replay findings identified by this audit have since been remediated; details are in [the remediation report](SECURITY_REMEDIATION_REPORT.md).

The project is not production-ready based on repository evidence alone. The authenticated attachment gateway is intentionally unmounted until a real application-session verifier and durable membership/access stores exist. Firefox browser validation remains blocked on the local macOS host. Production Mongo, TURN/STUN, deployment logs, retention, credentials, multi-instance behavior, endpoint compromise, and external adversarial review remain unverified.

## Security rating

No numeric score is assigned. The evidence supports a **conditionally sound implementation baseline with material deployment and integration gates outstanding**, not a production certification.

## Architecture security review

### Cryptography and identity

Vodozemac is loaded from a bundled, same-origin artifact (`service/src/crypto/vodozemacWasm.ts`), with identity/session state held through the encrypted vault and session repositories. Modern conversation code pins contact identity and rejects changed identities. Conversation policy gives persisted mode precedence and defaults unknown policy values to `legacy-default`; no automatic legacy migration or protocol downgrade was found.

Attachment encryption occurs in `service/src/attachments/crypto.ts` and the media workflow sends only encrypted chunks plus an E2EE-protected reference. Mongo persistence stores encrypted metadata/ciphertext buffers and indexes, not content keys. The server-side attachment route factory requires injected authentication and is not mounted by `backend/api/index.ts`.

Calls are isolated in `service/src/calls/` and the existing WebRTC path. The call foundation validates call IDs, conversation IDs, participant membership, verification-change state, expiry, replay/duplicates, and terminal transitions. Browser media controllers request tracks explicitly and stop them on release. WebRTC transport is not treated as human identity verification.

### Server, relay, and client boundaries

Production CORS defaults to same-origin when no explicit allowlist is configured (`backend/security/cors.ts`). Production configuration requires Mongo, a chat-link domain, one supported instance, and rejects `CHATE2EE_ENABLE_DEBUG_LOGS=true`. Socket listeners apply control/message rate limits and reject malformed/unauthorized joins. Client rendering searches found no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` use. Clipboard writes are explicit user actions. IndexedDB/localStorage hold encrypted vault/public preferences and a short-lived tab lease, not server keys in plaintext.

## Findings

### KSEC-001 — Production attachment delivery is not mounted

Severity: High availability/security gate (not an observed bypass)  
Category: Authentication and authorization integration  
Affected phase: Phase 4  
Affected component: `backend/api/attachments/index.ts`, `backend/api/index.ts`, `backend/security/authorizationContext.ts`

Description: The route factory requires an injected session authenticator, conversation membership store, and attachment access store, but the default API router does not mount it. The only `X-Test-Participant` authenticator is inside an isolated test app. This correctly avoids an insecure deployment, but means production attachment delivery is unavailable.

Attack scenario/evidence: A client cannot reach `/api/attachments/create` through the default app (covered by `persistentBoundary.test.ts`). Wiring a client-provided participant header or in-memory membership store would create an authorization bypass. Repository evidence: no reviewed HTTP session verifier or durable membership/access registry is present.

Exploitability/impact: Exploitability is avoided by omission; impact is feature unavailability.  
Recommended fix: Integrate an independently reviewed application session verifier, durable conversation membership/revocation store, durable attachment-access registry, Mongo startup indexes/cleanup, and restart/failover tests. Do not add mock authentication or public bearer URLs.  
Future impact: Blocks production media delivery and must be resolved before any rollout relying on attachments.

### KSEC-002 — Firefox browser gate remains environment-blocked

Severity: Medium validation gate  
Category: Browser compatibility/testing  
Affected phase: Phase 4/5

Description: Chromium and WebKit Playwright suites pass locally. Firefox binaries are installed, but this macOS host stalls before the first action; prior diagnostics recorded a denied `plugin-container.app` sandbox extension and compositor framebuffer failure.

Reproduction: `npx playwright test --project=firefox --workers=1` on this host. No protocol assertion was reached.  
Impact: Firefox compatibility and permission behavior remain unverified.  
Recommended fix: Run the unchanged matrix on supported CI/OS with browser dependencies and retain artifacts; do not weaken tests or disable sandboxing.  
Future impact: Blocks browser-matrix production acceptance only.

### KSEC-003 — Deployment metadata and endpoint risks remain unverified

Severity: Medium residual risk  
Category: Privacy/deployment assurance  
Affected phases: Phase 3–5

Description: The repository documents that relays, TURN/STUN, signaling, and databases can observe routing, timing, sizes, availability, and (where applicable) IP addresses. Production log retention, Mongo contents, TURN credentials, provider access, reverse-proxy headers, and endpoint/browser compromise were not inspectable from this checkout.

Evidence: source and documentation show no media decryption or recording path; `backend/db/index.ts` and socket startup still emit operational errors/messages.  
Impact: Metadata leakage, log retention, provider compromise, and compromised endpoint exposure cannot be ruled out by unit tests.  
Recommended fix: Perform deployment-equivalent database/log/relay inspection, credential and retention review, reverse-proxy/CSP review, and an external threat assessment before production.

### KSEC-004 — Call media is transport-encrypted, not endpoint-private

Severity: Informational design limitation  
Category: WebRTC/privacy boundary  
Affected phase: Phase 5

Description: DTLS-SRTP protects packets between negotiated endpoints, but an SFU/media-terminating service would see media; a compromised browser, OS, extension, or remote participant can record decrypted media. The current call UI/path is audio-focused and does not provide a reviewed camera/video production flow.

Evidence: `service/src/calls/media.ts`, `service/src/webrtc/peer.ts`, and Phase 5 security reports explicitly keep media capture local and omit recording/analytics.  
Recommended fix: Keep relay-only infrastructure as a packet forwarder, require a separate media-layer review for SFU use, and document endpoint/recording limitations to users.

## False-positive review

- The presence of `X-Test-Participant` in attachment tests is not a production authentication bypass: the default app does not mount that test router, and the test is explicitly boundary-scoped.
- `modern-default-beta` appearing in policy tests/docs is not an enabled production flag: unknown/unset policy resolves to `legacy-default`, and rollout docs explicitly prohibit enabling beta.
- Development Playwright CORS and `NODE_ENV=test` are isolated test-server settings, not production CORS changes.
- LocalStorage tab leases and IndexedDB records are not evidence of plaintext key storage; vault and session tests exercise authenticated encrypted persistence.
- Generic error logging and `CHAT_LINK_DOMAIN` warnings do not expose message content or keys in the reviewed paths, though deployment log retention remains unverified.

## Security testing performed

- Jest/security suites: prior full run recorded 57 suites and 296 tests; targeted call/media suites cover lifecycle, identity, expiry, replay, permission denial, disconnect/reconnect mapping, and track cleanup. A subsequent full run required sandbox permission for Supertest local binding.
- TypeScript: passed (`service/tsconfig.json`).
- ESLint: passed.
- Client production build: passed.
- npm audit at high severity threshold: 0 vulnerabilities.
- Rust: `cargo fmt --check`, 5 Rust tests, clippy with warnings denied, and WASM release build passed in the preceding validation gate.
- Playwright: Chromium and WebKit suites passed in the preceding gate; Firefox remains host-blocked as described above.
- Static searches: no private-key/API-key patterns, unsafe HTML/eval sinks, test-only auth mounted in production, or wildcard production CORS found in the reviewed changes.

## Realistic attack simulation results

- Malicious server modifies modern messages: authenticated envelope verification/replay handling rejects modification; server can still drop/delay traffic.
- Stolen database: encrypted vault/attachment ciphertext and metadata remain, but sizes/timestamps/status/opaque identifiers may be exposed; production database inspection is outstanding.
- Compromised relay: sees routing/timing/volume/availability and possibly network addresses, not E2EE content or transport-encrypted media plaintext when it only forwards packets.
- Identity-key change: contact registry/modern conversation marks pending review and blocks continuation; no silent trust inheritance found.
- Forged call event: call signaling checks participant/conversation/call binding, expiry, identity state, and sequence; the deployment must still supply authenticated session context.
- Compromised device/browser: decrypted messages/media, microphone/camera, screenshots, and clipboard can be exposed; this is outside endpoint cryptographic protection.

## Production readiness

Ready based on repository evidence: crypto/session fail-closed tests, encrypted local persistence tests, attachment crypto/integrity tests, authorization unit tests, modern policy migration tests, permission cleanup tests, TypeScript/lint/build/audit, and Chromium/WebKit regression suites.

Not ready: production attachment gateway composition, Firefox browser acceptance, production TURN/STUN/signaling deployment, database/log/retention inspection, multi-device enrollment/revocation, endpoint threat controls, and independent external review.

Needs more validation: Mongo restart/failover, reverse-proxy/CSP/CSRF deployment behavior, rate-limit capacity, performance under load, relay metadata/credential operations, and browser permission/video behavior.

## Phase impact analysis

KSEC-001 affects Phase 4 production media delivery and any Phase 5 attachment-dependent feature; it does not modify Phase 1–3 crypto. KSEC-002 affects Phase 4/5 browser acceptance only. KSEC-003 affects deployment assurance across Phases 3–5, not the local cryptographic primitives. KSEC-004 is a Phase 5 design limitation and future media/SFU review requirement. No finding requires changing Vodozemac, identity primitives, mailbox protocol, message encryption, attachment encryption, or legacy behavior.
