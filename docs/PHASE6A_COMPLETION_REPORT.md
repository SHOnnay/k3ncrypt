# Phase 6A completion report

## Scope

Phase 6A implemented deployment-layer boundaries only. No Phase 6B multi-device, group, mobile, backup, or new protocol work is included.

## Completed

- Added `DurableReplayProtectionAdapter` and `DurableReplayProtectionStore` as an explicit atomic, shared, TTL-aware production boundary.
- Preserved `MemoryReplayProtectionStore` for tests and documented the required durable adapter properties.
- Added `createProductionAuthenticatedAttachmentService`, which composes real host-provided membership/access stores with the existing attachment service and delivery abstraction without inventing authentication or storage code.
- Added regression coverage for durable replay delegation and retained ciphertext-only attachment authorization tests.
- Documented deployment authentication, authorization, storage, logging, secret, TURN, database, monitoring, and browser requirements.
- Kept the default attachment router unmounted because application-session verification and durable membership/access deployment are not available in this repository.

## Security boundary review

Unchanged and frozen:

- Vodozemac and CryptoSession cryptographic design;
- identity primitives and verification model;
- message and mailbox protocols;
- attachment and media encryption formats;
- authenticated call signaling cryptographic boundary;
- legacy conversation behavior.

The changes are composition interfaces, documentation, and tests. They do not decrypt server-side, store keys, create public media URLs, or weaken fail-closed authorization.

## Deployment requirements

- Provide an independently reviewed HTTP session verifier that derives `AuthenticatedContext`.
- Provide durable membership/revocation and attachment-access stores.
- Select a real shared atomic replay adapter and define claim/retry semantics.
- Mount attachment routes only after restart/failover, ciphertext inspection, rate-limit, log-redaction, and secret-rotation evidence.
- Configure and review Mongo/object storage, TLS/CORS/CSRF/CSP, TURN credentials, retention, monitoring, and incident response.
- Run Firefox browser validation on supported CI/OS; retain Chromium/WebKit/Firefox artifacts.

## Validation

The Phase 6A targeted replay and attachment suites pass. Full Phase 1–5 Jest, TypeScript/service build, client production build, ESLint, npm audit, and `git diff --check` must remain green before release. Playwright Chromium/WebKit coverage is available locally; Firefox remains an environment/CI gate as documented.

## Remaining risks

The production session verifier, durable authorization registry, durable replay database adapter, deployment credentials, and operational infrastructure are intentionally not fabricated here. Endpoint compromise, relay/TURN metadata, database/operator access, multi-device identity, and group protocols remain outside Phase 6A and require later independent review.
