# K3ncrypt Phase 6 implementation roadmap

Status: planning only. The phases below are gates and sequencing guidance, not an authorization to implement them in this commit.

## Phase 6A — production security and identity-boundary preparation

**Goal:** close Phase 1–5 deployment blockers and produce a reviewed foundation for multi-device identity without changing existing protocol defaults.

**Required components:**

- real application-session verifier and durable conversation membership/revocation store;
- production attachment gateway composition with ciphertext-only persistence and cleanup;
- shared atomic replay store and explicit outbox/retry semantics;
- deployment review for Mongo, relay/TURN, CORS/CSRF, CSP, logs, secrets, retention, rate limits, and failover;
- supported browser/CI matrix, including Firefox;
- versioned device-identity data model design only (no automatic enrollment yet).

**Security requirements:** fail closed on missing/expired context; never use test participant headers in production; hash capabilities; keep keys/client plaintext out of server stores; preserve legacy and modern protocol behavior; define clock, revocation, rollback, and multi-instance guarantees.

**Testing requirements:** route authorization and cross-conversation tests; restart/failover and atomic-claim tests; storage leakage inspection; browser matrix; dependency/build/audit checks; deployment-equivalent secrets/log/database review.

**Dependencies:** existing Phase 3–5 interfaces, a chosen application authentication/session system, durable Mongo/object-storage operations, CI browser images, and deployment ownership.

**Completion criteria:** attachment routes are mountable without mock auth; replay claims survive restart and race tests; no production secret/plaintext leakage is observed; browser and deployment gates have artifacts; a separate review approves the device model.

## Phase 6B — verified multi-device and recovery foundation

**Goal:** support explicitly enrolled devices and safe identity-change/recovery workflows without copying private keys or silently trusting new devices.

**Required components:**

- per-device identity records and verified device list;
- enrollment/revocation ceremony with explicit user confirmation;
- device-scoped session and mailbox routing contracts;
- recovery design using user-controlled encrypted material and rollback/version protection;
- identity-change UX and audit state for stale/revoked devices.

**Security requirements:** every device has independent keys; enrollment is authenticated and user-visible; new devices start unverified; revocation fails closed; removed devices cannot receive future epochs; no server-generated trust; recovery cannot overwrite identity silently; downgrade and replay are rejected.

**Testing requirements:** enrollment interception, fake-device, revocation race, lost-device, restore rollback, multi-device replay, identity-change, offline delivery, and compromised-device tests; browser/native storage and lifecycle tests if a client exists.

**Dependencies:** Phase 6A deployment/session verifier, approved device protocol, reviewed recovery threat model, and explicit compatibility plan for existing two-party conversations.

**Completion criteria:** independent security review accepts the device/recovery protocol; existing conversations remain immutable; migration and rollback are tested; users can inspect and revoke devices; no private identity material crosses an untrusted server.

## Phase 6C — group and platform expansion (separate gated tracks)

**Goal:** evaluate group messaging/calls, mobile clients, and scale only after 6A/6B are independently accepted.

**Required components:**

- a separately reviewed group membership/key protocol and epoch model;
- group attachment/call authorization tied to membership epochs;
- SFU/TURN decision and media privacy review before group calls;
- mobile application architecture with keystore, backup, notification, permission, and deep-link boundaries;
- multi-instance queues, ordering, shared replay, and observability controls.

**Security requirements:** no reuse of two-party assumptions; explicit membership changes and revocation; no automatic legacy downgrade; endpoint and SFU limitations disclosed; no plaintext queues or server key escrow; bounded fan-out and abuse controls.

**Testing requirements:** group membership adversarial tests, epoch/revocation/replay tests, malicious participant and DoS tests, SFU/media inspection tests, mobile lifecycle/backup tests, browser/native matrix, chaos/failover/load tests, and external review.

**Dependencies:** accepted device/recovery model, Phase 6A operational stores, independent group protocol design, mobile platform ownership, and capacity/incident-response plans.

**Completion criteria:** each product track has its own threat model and approval; group and mobile clients cannot alter frozen Phase 1–5 boundaries; deployment artifacts prove authorization, privacy, recovery, and availability properties.

## Cross-phase test strategy

Every 6A–6C increment must retain the Phase 1–5 regression suite and add:

- unit tests for state, canonical encoding, expiry, revocation, and storage invariants;
- integration tests across client/session/relay/storage boundaries;
- security tests for forged identities, wrong membership, tampering, replay, downgrade, rollback, and capability leakage;
- adversarial tests with compromised relay/server/client assumptions;
- browser/native permission, lifecycle, offline, and recovery tests;
- deployment tests for restart, failover, multi-instance races, logs, retention, and secret rotation.

## Recommended order and explicit non-goals

1. Complete 6A deployment/authentication and operational gates.
2. Independently review and implement 6B device/recovery foundations.
3. Reassess whether group messaging is justified; design it as a new protocol, not an extension by convention.
4. Treat group calls, mobile, and backup as separate gated tracks under 6C.

Do not start with UI, group calls, mobile permissions, or server scaling. Do not enable a new default, migrate existing conversations, or modify Vodozemac/message/mailbox/attachment/media foundations as a shortcut for any Phase 6 objective.
