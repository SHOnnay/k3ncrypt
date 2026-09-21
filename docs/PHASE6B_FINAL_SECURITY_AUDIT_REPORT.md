# Phase 6B Final Adversarial Security Audit

## Executive verdict

**NOT READY.** The device lifecycle foundation contains meaningful fail-closed controls, and existing messaging, attachment, and call boundaries query device trust. However, the synchronization implementation does not yet satisfy the approved Phase 6B.8 protocol or the milestone's runtime, durability, conflict, and application-import claims. Several public or caller-controlled paths bypass the intended authenticated boundary.

## Confirmed controls

- Device lists validate unique identifiers, lifecycle state, epoch, and commitment chains.
- Enrollment and revocation mutations use authenticated lifecycle context and reject inactive authors.
- Modern messaging receive/send and call composition query `DeviceTrustEnforcer`.
- Backend attachment authorization requires a device-trust callback and fails closed when it rejects.
- Authenticated sync transport encrypts envelopes with the existing `CryptoSession`; no new key system or server plaintext path was introduced.

## Findings

### F-01 — Critical — unauthenticated sync-controller entry point remains public

**Affected component:** `service/src/sync/runtime.ts`

**Attack scenario:** An attacker or future caller bypasses `AuthenticatedSyncTransport` and calls `RuntimeSyncController.receive()` with a constructed `SyncPackage`. The controller trusts package sender/receiver fields after only comparing them to the caller-supplied authorization.

**Impact:** The authenticated-session guarantee can be bypassed inside the application boundary. Replay state and transfer progress can be mutated without proof that the package came from the bound peer session.

**Recommended fix:** Make raw package acceptance private. Expose only a method accepting a non-forgeable authenticated-frame result created by `AuthenticatedSyncTransport`, with session identity and lifecycle evidence validated at that boundary.

### F-02 — Critical — synchronization is not connected to inbound or outbound application delivery

**Affected components:** `ModernConversation`, `SyncEventDelivery`, `RuntimeSyncController`

**Attack scenario:** The implementation report claims a runtime path, but no application bootstrap subscribes to sync events, routes inbound encrypted envelopes to the authenticated sync transport/controller, emits PREPARE/PREPARED/READY/TRANSFER messages, or sends acknowledgements. The event-delivery and retry types are interfaces only.

**Impact:** Phase 6B does not provide working cross-device synchronization. Security tests exercise isolated objects rather than the application path that deployment would use.

**Recommended fix:** Wire one explicit modern-only composition root for sync transport, controller, durable store, delivery subscription, retry handling, and acknowledgements. Prohibit legacy/raw construction paths with composition tests.

### F-03 — Critical — durable recovery is not implemented

**Affected components:** `SyncPersistence`, `RuntimeSyncController`

**Attack scenario:** Crash after READY, during TRANSFER, or after local completion. `readState()` is never called, so admission, transfer progress, received sequences, conflicts, and terminal outcome are not restored. A restarted controller begins with process-local defaults.

**Impact:** Replays, duplicate application, stale admission reuse, or loss of fencing evidence are possible depending on the future adapter/runtime wiring. The documented crash recovery behavior is not present.

**Recommended fix:** Add explicit recovery construction that validates stored checkpoint/state and restores only safe suspended/pending states. Require durable records for manifest, authorization, progress, acknowledgements, fences, and terminal outcome before resuming.

### F-04 — High — critical persistence operations are optional and non-atomic

**Affected components:** `service/src/sync/contracts.ts`, `service/src/sync/runtime.ts`

**Attack scenario:** A persistence object omits `transaction`, `readState`, or `writeState`, or a crash occurs after `begin()`, `complete()`, or `fail()`. Those methods launch persistence with `void`, so callers can continue or shut down before the write succeeds. PREPARED/READY writes use `writeState` directly rather than the transaction boundary.

**Impact:** Partial state, stale writers, incorrect terminal status, and restart ambiguity. The interface does not require the guarantees attributed to it.

**Recommended fix:** Define a mandatory durable-store interface for production composition. Make all security-relevant transitions asynchronous and await one CAS transaction that writes checkpoint, admission/transfer state, replay/ACK data, and terminal result together.

### F-05 — High — record synchronization does not implement the normative schemas or permissions

**Affected component:** `service/src/sync/stateRecords.ts`

**Attack scenario:** An authenticated device supplies arbitrary `payload` data under a broad `conversation`, `contact`, `device`, or `settings` kind. Validation checks only outer fields; it does not validate the approved record schemas, causal parents, provenance, expiry, deletion frontier, immutable protocol mode, verification evidence, or trust-increase restrictions.

**Impact:** A future importer could accept malformed records, overwrite identity-sensitive state, or treat historical data as live authority. No concrete atomic importer currently exists to contain this risk.

**Recommended fix:** Implement the exact allow-listed schemas from the record permission model and independent source/destination permission checks. Keep device lifecycle changes outside generic record import.

### F-06 — High — conflict and fencing authority is process-local and disconnected

**Affected component:** `service/src/sync/fencing.ts`

**Attack scenario:** Concurrent membership proposals, delayed events, or an offline device produce a conflict. `SyncFenceCoordinator` exists only as an in-memory helper and test object; it is not connected to lifecycle changes, authenticated delivery, persistence, sync admission, or user resolution.

**Impact:** The approved FENCED/VIEW/CHOICE/CHOSEN/INSTALLED barrier is not enforced. Unresolved conflict does not globally block unsafe synchronization after restart.

**Recommended fix:** Persist the conflict ceremony and prior-member acknowledgements atomically, route every phase through authenticated sessions, and make admission query the durable fence state before content release/import.

### F-07 — High — peer identity binding remains caller-controlled

**Affected component:** `ModernConversation.createAuthenticatedSyncTransport()`

**Attack scenario:** The caller supplies `peerIdentityReference` and `sessionBinding`. The method checks the peer routing/device ID and local identity, but does not compare the peer identity against the verified contact identity stored by `ContactIdentityRegistry`.

**Impact:** Identity substitution can be represented in sync metadata even though the underlying encrypted conversation session is valid. This creates identity-confusion risk in synchronization authorization.

**Recommended fix:** Derive the remote identity and stable session binding inside `ModernConversation` from the active verified runtime/contact registry; do not accept them from UI or general callers.

### F-08 — High — fixed-membership admission is incomplete

**Affected components:** `RuntimeSyncController`, `SyncTransferController`

**Attack scenario:** One source and target advance locally through PREPARE/PREPARED/READY without collecting direct authenticated PREPARED and READY evidence from every active device. Membership changes during admission are not durably fenced.

**Impact:** A stale or partitioned subset can synchronize without the unanimous prior-checkpoint barrier required by the approved protocol.

**Recommended fix:** Bind each admission to a frozen manifest and active-member set; persist direct peer decisions and require all matching READY evidence before transfer.

### F-09 — Medium — replay and validation tests do not represent production behavior

**Affected component:** `service/src/sync/sync.test.ts`

**Attack scenario:** Tests use permissive trust objects and an in-memory transaction closure that does not implement rollback, CAS, corruption detection, or independent-process concurrency. There are no restart, partial-transaction, delayed-event, real lifecycle, or application-composition tests.

**Impact:** Passing tests provide insufficient evidence for the durability and distributed consistency claims.

**Recommended fix:** Add contract tests against a durable transactional adapter and integration tests using real lifecycle/trust composition, two runtime instances, process restart, delayed/reordered delivery, and injected write failures.

## Attack-area assessment

| Area | Result |
| --- | --- |
| Device identity | Core list uniqueness and lifecycle checks exist; sync peer identity derivation remains caller-controlled. |
| Enrollment | Authenticated lifecycle checks exist; full multi-runtime ceremony evidence was not demonstrated by end-to-end tests. |
| Revocation | Local messaging/call/sync trust checks reject revoked state; distributed sync propagation and restart fencing remain incomplete. |
| Synchronization | CryptoSession wrapper exists, but raw receive bypass, incomplete admission, absent application wiring, and shallow record validation are blocking findings. |
| Multi-device consistency | No complete persisted conflict-authority ceremony; offline/delayed conflict safety is unproven. |
| Persistence | Contracts exist, but recovery is unused and several writes are optional/fire-and-forget. |
| Application boundaries | Messaging and calls query local trust; attachments support a trust callback. Cross-instance freshness depends on deployment adapters and is not proven here. |
| Privacy | No new server plaintext/key path was found. A relay can still observe routing identifiers, device activity, timing, sizes, and synchronization relationships. The unimplemented production path prevents stronger end-to-end privacy claims. |

## Required closure before Phase 7

1. Remove the raw sync receive bypass and derive peer identity from the verified session/contact runtime.
2. Implement and test the real inbound/outbound modern sync composition path.
3. Make durable transactional storage mandatory and implement restart recovery.
4. Implement exact record schemas, permission checks, and atomic application.
5. Integrate the durable conflict/fencing ceremony and full fixed-membership admission.
6. Add realistic multi-instance, restart, delayed-event, corruption, and revocation regression tests.

## Final verdict

**NOT READY.** Phase 6B has useful foundations, but it does not yet deliver a complete secure multi-device synchronization capability, and the blocking findings above must be closed before Phase 7 begins.
