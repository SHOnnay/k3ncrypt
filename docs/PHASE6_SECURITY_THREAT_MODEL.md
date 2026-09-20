# K3ncrypt Phase 6 security threat model

Status: design-only. Threats below are gates for future work, not evidence that the features exist.

## Shared assets and adversaries

Assets include identity private material, verification decisions, session state, message plaintext, attachment keys/ciphertext, call signaling/media, authorization capabilities, device membership, recovery material, and traffic metadata.

Threat actors include a compromised server/operator, malicious relay or TURN provider, malicious contact, stolen or compromised device, browser extension/OS attacker, replay/injection attacker, abusive authenticated user, and supply-chain/dependency attacker. Availability attacks, traffic analysis, rollback, and downgrade attempts are in scope even when confidentiality is preserved.

## Feature threat assessments

### Production deployment hardening

**Purpose:** mount attachment/call delivery only with a real authenticated session verifier, durable membership/access state, shared replay claims, and reviewed operational controls.

**Assets protected:** conversation membership, attachment capabilities, ciphertext metadata, replay state, logs and credentials.

**Attack surfaces:** HTTP routes, session middleware, Mongo indexes, object storage adapters, reverse proxies, CORS/CSRF, rate limits, logs, deployment secrets.

**Possible attacks:** forged participant context, cross-conversation attachment access, public URL/token leakage, capability replay, multi-instance race, log leakage, stale membership after revocation, storage enumeration, denial of service.

**Mitigations:** fail-closed session verification; server-side membership/revocation; hashed scoped capabilities; constant-time comparison; atomic shared replay claims; generic errors; opaque IDs; ciphertext-only storage; expiry/index cleanup; restrictive CORS/CSRF and retention review; integration and failover tests.

**New trust assumptions:** the application session issuer, durable membership store, database operator, object-storage operator, and deployment secret manager become trusted for authorization/availability, never for plaintext or keys.

### Multi-device identity and sessions

**Purpose:** add independently verifiable devices without copying private identity state.

**Assets protected:** device identity keys, device membership, verification status, session continuity, revocation records.

**Attack surfaces:** device enrollment/QR or code ceremony, device directory, revocation, push/offline delivery, recovery, backup, device loss.

**Possible attacks:** unauthorized device enrollment, QR interception, device substitution, stale/revoked device acceptance, key rollback, cross-device replay, compromised-device fan-out, metadata enumeration.

**Mitigations:** explicit user ceremony; per-device keys; authenticated device list; independent verification and change warnings; signed/cryptographically bound membership updates; revocation that fails closed; monotonic versions; no automatic trust inheritance; recovery audit trail and adversarial tests.

**New trust assumptions:** users must verify devices and protect recovery ceremonies; a server may store opaque device records but must not mint identity membership by itself.

### Identity recovery and backup

**Purpose:** recover access after loss without silently replacing a verified identity.

**Assets protected:** identity continuity, verification history, encrypted vault/session backups, recovery credentials.

**Attack surfaces:** recovery codes, external backup locations, restore/rollback, support/admin workflows, device-change UX.

**Possible attacks:** stolen recovery material, malicious support reset, backup rollback, identity substitution, denial through lost recovery, leaked plaintext export.

**Mitigations:** user-controlled recovery secret; authenticated, versioned, encrypted backup; explicit identity-change state; old-device/recovery confirmation where available; one-time/expiring recovery operations; revocation and audit; no server-held decryption key; restore tamper tests.

**New trust assumptions:** the user controls recovery material and accepts loss if it is unavailable; backup providers are untrusted ciphertext hosts.

### Group conversations

**Purpose:** extend two-party messaging to changing participant sets.

**Assets protected:** group membership, message authenticity, forward secrecy, removal/revocation, ordering, attachment access.

**Attack surfaces:** invite/remove events, membership state, sender keys/session fan-out, offline mailbox, server fan-out, moderation/DoS.

**Possible attacks:** forged membership, removed member decrypting future traffic, welcome-message replay, sender impersonation, downgrade to legacy, metadata and size leakage, malicious participant flooding.

**Mitigations:** a separately reviewed group protocol; authenticated membership epochs; explicit verification/change warnings; forward secrecy and post-compromise recovery appropriate to groups; bounded fan-out; per-epoch replay/ordering; fail-closed protocol negotiation; adversarial membership tests.

**New trust assumptions:** every group member can read authorized plaintext and can abuse availability; the server remains an untrusted membership transport, not the source of truth for cryptographic membership.

### Group calls and media relays

**Purpose:** extend authenticated call control to multiple participants and potentially an SFU.

**Assets protected:** call identity, media confidentiality, permission state, participant presence, call metadata.

**Attack surfaces:** group signaling, SFU/TURN, track routing, admission/removal, browser permissions, recording and diagnostics.

**Possible attacks:** unauthorized admission, call hijacking, SFU media inspection, stale participant media, IP/metadata leakage, permission persistence, recording by endpoint/provider.

**Mitigations:** bind every event to a verified membership epoch; use relay-only policy where required; separate control and media authorization; explicit track lifecycle; no server recording by default; independent SFU threat review; participant removal tests and endpoint disclosures.

**New trust assumptions:** an SFU can observe media unless an independently reviewed end-to-end media layer is added; TURN operators can observe traffic metadata and availability.

### Mobile clients

**Purpose:** provide native clients with platform-safe storage and permission behavior.

**Assets protected:** platform keystore material, vault/session state, notification content, media permissions, backups, screenshots/recents.

**Attack surfaces:** app lifecycle, OS backup, logs, push notifications, deep links, QR scanners, clipboard, rooted/jailbroken devices, native dependencies.

**Possible attacks:** backup extraction, notification leakage, deep-link secret leakage, stale in-memory keys, unauthorized background capture, native supply-chain compromise.

**Mitigations:** platform keystore wrapping; encrypted app storage; redacted notifications; explicit foreground permissions; secure deep-link handling; lifecycle zeroization/lock; dependency pinning and mobile threat review; no broad permissions.

**New trust assumptions:** the mobile OS/keystore and app distribution chain provide baseline isolation; rooted devices remain compromised endpoints.

### Scaling and multi-instance infrastructure

**Purpose:** improve availability without changing security ownership.

**Assets protected:** ordering/replay claims, authorization consistency, room state, ciphertext availability, operational metadata.

**Attack surfaces:** shared caches, queues, load balancers, sticky sessions, clocks, replication, failover, observability.

**Possible attacks:** duplicate delivery, replay after failover, stale revocation, split-brain membership, queue disclosure, clock skew expiry bypass, cross-tenant routing.

**Mitigations:** atomic shared claims; monotonic/versioned state; server-consistent time; authenticated routing; bounded queues; failover and partition tests; redacted metrics/logs; no plaintext queue payloads.

**New trust assumptions:** infrastructure operators can observe metadata and availability but not content; shared state must be treated as hostile to confidentiality.

## Frozen-boundary review

The following must remain frozen unless a separately approved protocol migration is completed:

- Vodozemac and `CryptoSession` cryptographic implementations;
- identity primitives and private-key storage;
- message framing, mailbox protocol, and legacy behavior;
- attachment encryption, media encryption, and key/reference separation;
- authenticated call signaling's fail-closed origin, digest, expiry, and replay checks.

Phase 6 may extend through versioned adapters, membership/recovery metadata, UI and platform boundaries, and deployment stores. It must never solve missing authorization or availability by exposing keys, trusting routing IDs, decrypting on the server, weakening verification, or enabling downgrade.

## Release threat gates

No Phase 6 feature should proceed to release until its design includes: an explicit asset/actor/attack table; new trust assumptions; downgrade and rollback behavior; compromised-server and compromised-endpoint analysis; unit/integration/adversarial/browser/deployment tests; migration and recovery evidence; and an operational plan for logs, retention, rate limits, secrets, and incident response.
