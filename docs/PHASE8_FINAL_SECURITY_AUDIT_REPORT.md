# Phase 8 Final Security Audit

## Scope and method

This was a source-code review of the current Phase 8 checkpoint. It reviewed the browser client, service SDK, Rust/WASM boundary, backend authorization paths, Mongo persistence, and existing tests. No production code was changed.

The results below distinguish code-verified behavior from risks demonstrated by inconsistent checks or missing enforcement in the active code paths. This is not a production-readiness claim.

## Overall posture

The application has meaningful security boundaries: Vodozemac private identity material stays in the browser vault/WASM boundary; protected transports use short-lived, one-time, server-verifiable device proofs; encrypted offline envelopes are retained until the client accepts them; and production configuration rejects absent MongoDB, CORS, trust-proxy, and proof-secret configuration.

However, the durable lifecycle and private-network membership implementations contain authorization and revocation gaps. They should be addressed before treating private networks or multi-device revocation as beta-safe.

## Confirmed findings

### Critical — Revocation cannot target an activated enrolled device

**Location:** `backend/security/durableDeviceTrust.ts`, `DurableDeviceTrustAuthority.update()`.

**Risk:** The revocation transition requires both the issuer and target device to have `trustEpoch === event.previousEpoch`. Enrollment creates a pending target at issuer epoch + 1, and activation advances the target once again. The issuer record is not advanced by either operation.

**Exploit scenario:** After a second device completes activation, its record has a later epoch than the original trusted device. A valid revocation request from that original device cannot satisfy the target-and-issuer equality requirement. A compromised enrolled device can therefore remain active because the authorized owner cannot apply its revocation event through this authority.

**Current protection:** Events, issuer proofs, lifecycle signatures, and one-time event identifiers are validated. Those protections do not solve the inconsistent per-device epoch model.

**Recommended fix:** Define one authoritative account lifecycle epoch or validate revocation against separate issuer and target expected epochs carried in the signed event. Apply the state transition atomically and add an integration test that enrolls, activates, then revokes a second device from the first device.

### High — Removed private-network members retain an already-open relay path

**Location:** `backend/privateNetwork/relay.ts`, relay admission and `private-network-envelope` handler.

**Risk:** Membership and proof validity are checked only during Socket.IO connection admission. The per-packet handler checks payload shape, target, and rate limits, but does not re-check active membership, lifecycle state, membership epoch, or proof freshness.

**Exploit scenario:** A member remains connected while an owner removes it. The membership record changes to `removed`, but the existing socket remains in the in-memory route map and can continue sending opaque packets to other connected members until it disconnects.

**Current protection:** New relay connections from removed members fail admission, and payload contents remain opaque to the relay.

**Recommended fix:** Disconnect active sockets when a removal event is committed, or revalidate current lifecycle and membership state before forwarding each packet. Add a live-connection removal regression test.

### High — Network membership does not bind the target to the issuer account’s durable lifecycle record

**Location:** `backend/security/networkMembership.ts`, `DurableNetworkMembershipAuthority.apply()`; `backend/privateNetwork/relay.ts`.

**Risk:** Membership creation verifies the issuer and its owner capability, but it never reads and validates the target device lifecycle record. It stores `event.accountIdentityReference` and target identity claims without confirming that the target is an active device of that account. Relay admission subsequently verifies only that the connecting device has some valid proof for the requested network and that its proof epoch equals the membership epoch; it does not compare the proof account reference to the membership record’s account reference.

**Exploit scenario:** A valid network owner can create a membership record for a device identity outside its account, with a compatible epoch. That independently active device can satisfy relay admission using its own proof, creating cross-account network membership that the model does not intend.

**Current protection:** The issuer’s signature and device-control proof are checked, and the relay requires a resource-bound private-network proof.

**Recommended fix:** On every membership mutation, read the target lifecycle record using `event.accountIdentityReference` and require an active target whose device and identity references match the event. On relay admission, require `membership.accountIdentityReference === proof.accountIdentityReference` and matching device identity. Test cross-account target rejection.

### Medium — Lifecycle event consumption and lifecycle writes are not atomic

**Location:** `backend/security/durableDeviceTrust.ts`, `enroll()`, `activate()`, and `update()`; `MongoDeviceTrustStore.consume()` and `upsert()`.

**Risk:** Each path consumes an event identifier before writing the lifecycle record. The two writes use separate MongoDB operations without a transaction. A transient write failure or a concurrent conflict can consume the only valid event while leaving lifecycle state unchanged.

**Exploit scenario:** A service interruption during enrollment, activation, or revocation can leave users unable to retry the same signed authorization. This is primarily an availability and recovery risk; it can delay revocation until a new valid event is issued.

**Current protection:** Conditional epoch updates and unique nonce/event insertion prevent replay when the operations succeed.

**Recommended fix:** Use a Mongo transaction that records nonce/event consumption and lifecycle mutation together, or use an idempotent event record with a committed state and safe retry semantics. Add failure-injection tests for each state transition.

### Medium — Global device-ID uniqueness is not enforced by the active authority

**Location:** `backend/security/durableDeviceTrust.ts`, `MongoDeviceTrustStore`; `backend/db/migrations.ts`.

**Risk:** Bootstrap checks `readAnyDevice(deviceId)` and then inserts a record keyed by `{ accountIdentityReference, deviceId }`. This check-and-insert sequence is not atomic across accounts. Although migrations create a `device_identity_registry` unique index, the authority never writes or reads that collection.

**Exploit scenario:** Concurrent bootstrap operations using the same device identifier can create separate lifecycle records under distinct accounts. That creates ambiguous device identifiers in operator tooling and any future path that treats the device ID as globally unique.

**Current protection:** Per-account device uniqueness is indexed, and normal clients generate random UUIDs.

**Recommended fix:** Reserve device IDs through the indexed registry in the same transaction as bootstrap, or add a unique `{ deviceId: 1 }` index directly to lifecycle records after an explicit duplicate-data migration. Add a concurrency test.

### Medium — Readiness does not verify every security-critical index

**Location:** `backend/db/migrations.ts`; `backend/db/index.ts`, `requiredIndexes` and `requiredIndexesReady()`.

**Risk:** Migrations define indexes for `device_identity_registry`, `private_network_members`, and `private_network_membership_events`, but readiness does not require those indexes. A deployment with only the subset listed in `requiredIndexes` can report ready while membership replay uniqueness or planned device-ID registry uniqueness is absent.

**Exploit scenario:** An incomplete production migration may be accepted by readiness checks, leaving uniqueness guarantees unavailable until detected operationally.

**Current protection:** Production startup requires MongoDB and readiness checks several core collections; deployment documentation calls for explicit migrations.

**Recommended fix:** Include all authority and membership indexes in readiness verification, and fail deployment before traffic when any are missing.

### Low — Browser call replay and call state are process-local

**Location:** `service/src/calls/composition.ts`; `service/src/calls/repository.ts`; `service/src/calls/replayProtection.ts`.

**Risk:** The standard call composition creates `MemoryCallRepository` and defaults to `MemoryReplayProtectionStore`. Closing or restarting a browser clears call state and the signaling replay cache.

**Exploit scenario:** Replayed encrypted signaling from a still-valid call window is no longer rejected by that in-memory cache after a client restart. The encrypted conversation session and signal identity binding still apply, so this does not create unauthenticated signaling, but it can cause stale-call handling inconsistencies.

**Current protection:** Signals are encrypted, participant-bound, digest-validated, sequence-keyed, and expiry-limited. Call sessions have short expiration.

**Recommended fix:** Decide whether beta calls need durable replay claims and persisted terminal-call tombstones. If so, wire the existing durable replay adapter at the production composition boundary.

## Verified protections

- **Crypto boundary:** `PersistentVodozemacIdentity` holds account handles internally; client code receives public bundle material only. The vault uses Argon2id-derived wrapping keys, AES-256-GCM record encryption, per-record AAD, and separate Vodozemac pickle derivation.
- **Pre-key handling:** Pre-key bundles validate strict shape and key sizes. Mongo one-time-key claiming uses an atomic conditional update. Renewal rejects identity-key substitution.
- **Identity pinning:** Invitation-bound contacts reject a bundle whose fingerprint does not match the commitment. The inbound first-contact path records a successfully Vodozemac-authenticated peer as unverified; later identity changes require review.
- **Proof enforcement:** Durable proofs are HMAC-authenticated, short-lived, resource-aware, and consumed through Mongo nonce persistence. Relay joins, message sends, attachment operations, and private-network admission invoke the durable authority.
- **Offline mailbox:** The server retains encrypted envelopes until a client acceptance callback. The client’s persistent seen-record guard prevents duplicate UI delivery.
- **Attachments:** Production attachment routes require room control, routing ownership, a current device proof bound to the conversation, and conversation membership. Server storage handles encrypted metadata and chunks.
- **Backend configuration:** Production mode requires persistent MongoDB, explicit HTTPS CORS origins, trusted proxy configuration, a chat-link domain, and a 32+ character device-proof secret. Debug logs are rejected in production.
- **Calls and media:** Call signals are encrypted in the established conversation session and validated for participant, identity, digest, expiry, and replay. Browser media is explicitly requested and released on peer disposal. WebRTC relies on DTLS-SRTP rather than application-invented media cryptography.
- **Privacy defaults:** Analytics are forced off and notification previews default off. The only reviewed localStorage values are UI preferences and tab-lease metadata, not vault plaintext or private keys.

## Potential improvements and Phase 9 recommendations

These are not confirmed vulnerabilities in the reviewed paths, but they should guide Phase 9 planning.

1. Resolve the critical lifecycle epoch model before exposing multi-device revocation to beta participants.
2. Treat private-network member removal as a live session revocation event, not only a reconnect-time check.
3. Add real-Mongo fault-injection coverage for lifecycle and membership atomicity; the existing Mongo integration suite validates happy paths and selected replay rejection, but not transaction interruption.
4. Use a deployment-managed TURN service and test browser interoperability on Firefox and Safari before relying on calls beyond controlled beta.
5. Consider a durable call replay adapter if calls must survive browser restart or if stale signaling becomes a product concern.
6. Remove or account for the untracked generated `security-test-result.txt` before a future clean release checkout.

## Phase 9 recommendation

Proceed with Android development only after recording the above findings in the Phase 9 risk register. Do not port the private-network or multi-device revocation flows as security-complete until the critical and high findings are remediated and verified against real MongoDB.
