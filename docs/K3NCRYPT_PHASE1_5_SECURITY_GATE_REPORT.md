# K3ncrypt Phase 1–5 security gate report

Date: 2026-09-20

Scope: repository security architecture, implementation boundaries, tests, and deployment gates across Phases 1–5. This is a source-and-validation review, not a penetration test or production certification. No Phase 6 work is included.

## Executive summary

The Phase 1–5 implementation establishes a coherent privacy boundary: cryptographic identity and sessions remain client-side, the mailbox and relay carry opaque envelopes, attachments and media references are encrypted before delivery, and calls use authenticated signaling over the existing modern conversation session. The final Phase 5 pass adds bidirectional authenticated call-control signaling and keeps legacy conversations out of the modern secure-call path.

The security architecture is complete at the reviewed code boundary. Repository validation is green, including full Jest, TypeScript, ESLint, the client production build, npm audit, and Chromium/WebKit modern-conversation browser coverage. This report does not claim production readiness. Deployment hardening remains required for authenticated attachment mounting, durable shared replay storage, TURN/relay operations, Firefox CI evidence, database/log/retention review, and endpoint/multi-device risks.

## Phase-by-phase review

### Phase 1 — foundation, storage, and architecture

Phase 1 established the application separation between client cryptography, opaque transport, backend link/control services, and UI. The security inventory, threat model, dependency review, server configuration, rate limits, same-origin CORS defaults, and fail-closed error handling define the initial trust boundaries.

The encrypted vault and storage interfaces keep secret records behind an explicit storage boundary. Public preferences are separated from encrypted records. Runtime configuration rejects unsafe production debug logging and requires deployment configuration rather than silently inventing security defaults.

### Phase 2 — cryptographic infrastructure and identity

Phase 2 introduced the reviewed cryptographic/session interfaces, identity ownership boundaries, encrypted persistence, and Vodozemac integration preparation. Private identity material and session persistence remain inside the crypto/runtime and secure-storage boundaries; transports receive opaque envelopes only.

Identity records distinguish local identity, contact identity, routing identifiers, and verification state. Identity changes are detected and require explicit review. No private key, vault secret, or raw crypto handle is exposed to presentation components.

### Phase 3 — E2EE messaging, mailbox, sessions, and verification

Phase 3 implemented the modern Vodozemac conversation path, encrypted message envelopes, offline/outbox delivery, persistence and crash-recovery boundaries, pre-key/session handling, verification foundations, and legacy compatibility controls. Modern conversations reject malformed or downgraded envelopes, preserve persisted protocol mode, and do not silently migrate existing legacy conversations.

The mailbox/relay handles ciphertext and routing metadata; it does not decrypt message content. Modern sessions are restored through the encrypted persistence boundary, and changed contact identities block continuation until explicit recovery/verification. Phase 3 defaults remain protected by policy controls and fail-closed behavior.

### Phase 4 — media, attachments, permissions, and privacy

Phase 4 builds on the frozen messaging/session boundary. Attachments are encrypted locally into authenticated chunks; media messages carry protected references rather than plaintext media or keys. Persistent storage interfaces separate encrypted metadata from ciphertext chunks and prohibit server-side decryption, previews, public URLs, or key storage.

Attachment authorization, authenticated context contracts, expiry, chunk integrity, duplicate handling, and cleanup are covered by tests. Microphone/camera permissions are explicit, tracks are released on failure/end, and no recording, analytics, tracking, or background capture path was introduced. The production attachment route remains intentionally unmounted until a real application-session verifier and durable membership/access stores are available.

### Phase 5 — calls, signaling, WebRTC, authentication, and replay

Calls are isolated in `service/src/calls/` and are created through `ModernConversation` → authenticated call context → `createAuthenticatedCallComposition`. The composition requires a ready encrypted modern session, authenticated transport, stable participant identities, and an explicitly verified contact. The legacy `ChatE2EE` path cannot create a modern authenticated call.

`AuthenticatedCallSignalTransport` decrypts signaling with the existing CryptoSession and verifies conversation, participant, identity, digest, and verification state. Bidirectional call-control events now cover invite, incoming ringing, accept, reject, cancel, expiry/transition enforcement, and UI event notification. SDP/ICE payloads remain bound to canonical call metadata and are rejected when tampered with or replayed.

The replay abstraction provides duplicate detection, TTL cleanup, bounded memory behavior, and explicit outcomes. WebRTC/permission adapters preserve the boundary that relays forward transport packets but do not become human identity authorities. A production TURN/SFU deployment still requires a separate operational and media-privacy review.

## Audit history and remediation

### KSEC-001 — production attachment delivery not mounted

Original finding: the route factory had no reviewed application-session verifier and durable membership/access stores. Mounting the test participant header or an in-memory authorization store would have created an unsafe deployment path.

Remediation and final status: the default router remains fail-closed and does not mount insecure attachment routes. The boundary is documented and tested. **Status: deployment gate open; no bypass introduced.**

### KSEC-002 — Firefox browser gate

Original finding: Chromium and WebKit passed while Firefox stalled on the local macOS host before reaching assertions.

Remediation and final status: browser tests remain unchanged and Chromium/WebKit pass. Firefox requires supported CI/host evidence. **Status: environment/deployment gate open.**

### KSEC-003 — deployment metadata and endpoint risks

Original finding: Mongo contents, relay/TURN metadata, logs, credentials, retention, reverse-proxy behavior, and endpoint compromise were not verifiable from the checkout.

Remediation and final status: source documentation preserves the limits and contains no plaintext-media or key-processing path. Deployment inspection remains required. **Status: operational review open.**

### KSEC-004 — call media endpoint privacy

Original finding: WebRTC/DTLS-SRTP protects transport packets but cannot protect decrypted media on compromised endpoints or from a media-terminating SFU.

Remediation and final status: no recording or analytics path was added; relay-only and endpoint limitations are documented. **Status: accepted design limitation requiring deployment disclosure and separate SFU review.**

### F-01 — signaling digest was not an identity proof

Original finding: a relay could recompute a digest after changing SDP/ICE unless the payload was inside the authenticated conversation envelope.

Remediation and final status: canonical payload binding is verified inside `AuthenticatedCallSignalTransport` and the existing modern CryptoSession. Tampered SDP/ICE, forged origins, wrong conversations, and changed identities are rejected. **Status: closed at the reviewed runtime boundary.**

### F-02 — process-local replay protection

Original finding: replay claims disappeared after restart and lacked a production atomic persistence contract.

Remediation and final status: `ReplayProtectionStore` defines TTL, bounded claims, duplicate/expired/capacity outcomes, and an injectable persistence boundary. **Status: implementation boundary closed; durable shared production adapter still required.**

### N-01 — authenticated call factory disconnected from runtime

Original finding: the authenticated factory existed, but the application bootstrap could still remain on the legacy facade.

Remediation and final status: modern runtime creation now owns the authenticated call composition; inbound and outbound control events route through it. Modern integration tests prove verification gating, transport selection, bidirectional invite/accept, and legacy isolation. **Status: closed for modern call-control runtime wiring.**

## Frozen security boundaries

The following remain unchanged as security foundations and were not weakened by Phase 1–5 feature work:

- Vodozemac cryptographic core and opaque session handles
- modern message encryption and envelope framing
- mailbox/offline delivery protocol
- identity/key hierarchy and encrypted vault design
- attachment encryption algorithm and media-reference security model
- legacy conversation security and behavior

The Phase 5.9/5 final changes only compose these boundaries, add call-control validation, and normalize WebCrypto inputs for TypeScript compatibility; they do not expose keys or alter cryptographic primitives.

## Final state

### Completed

- Client-side identity/session and encrypted persistence boundaries
- Modern E2EE messaging, offline delivery, verification, and downgrade protection
- Encrypted attachment/media foundations and permission cleanup
- Authenticated call composition and bidirectional call-control signaling
- Canonical signaling integrity binding, identity checks, replay abstraction, and regression tests
- TypeScript, lint, client build, dependency audit, and Chromium/WebKit validation

### Deployment required

- Real authenticated attachment-session verifier and durable conversation membership/access stores
- Durable atomic replay claims shared across call-service instances
- TURN/STUN/relay credentials, retention, logging, rate-limit, and reverse-proxy review
- Firefox browser matrix evidence on supported CI/OS
- Mongo/storage restart/failover inspection and production ciphertext-only verification
- Endpoint, permissions, CSP, CSRF, and operational secret-management review

### Future roadmap

- Multi-device enrollment, revocation, and recovery
- Group calls and any media-terminating SFU architecture
- Additional browser/media interoperability work
- Phase 6 work only after a separate security review and explicit authorization

## Final readiness statement

The Phase 1–5 **security architecture and code-level boundaries are complete for the reviewed scope**. This is not a production-readiness approval. Deployment hardening, shared persistence, browser/CI coverage, relay/TURN operations, endpoint controls, and independent external review remain mandatory before treating the system as production-ready or enabling future Phase 6 work.
