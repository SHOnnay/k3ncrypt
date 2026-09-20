# Phase 6B Device Lifecycle Security Assault Report

## Scope and method

This review examined the implemented device identity, device-list, enrollment,
authorization, revocation, runtime control-channel, CryptoSession, and local
persistence boundaries. Existing lifecycle tests were treated as attack
regressions and the implementation was reviewed for failure behavior under
forgery, replay, rollback, malformed state, and concurrent mutation.

## Findings

| Finding | Severity | Affected component | Exploit scenario | Recommendation | Implementation change required |
|---|---|---|---|---|---|
| Incoming device-control routing was coupled to call composition | High (fixed) | `ModernConversation` signaling relay | A normal modern conversation received an encrypted enrollment/revocation control before creating a call composition. The relay decrypted only when `callSignalTransport` existed, so the control was silently dropped. | Route authenticated device controls independently; invoke call-signal handling only for non-control payloads. | Yes — fixed in this commit. |
| Persistence commit is read/modify/write, not an atomic compare-and-set | High (open) | `SecureStorageDeviceLifecyclePersistence` | Two tabs/devices read epoch N, independently produce N+1, then both write. The last write can erase the other mutation while both callers believe it succeeded. A crash between read and write can also leave an incomplete lifecycle record. | Provide a durable transactional adapter with atomic expected-epoch/commitment claim, duplicate-nonce uniqueness, and an all-fields transaction. Keep the local adapter test-only/browser-local. | Yes, before multi-device production use. |
| Incoming approvals and revocations are intentionally not applied | High (open) | `ModernConversation.handleDeviceControl` | A remote device can receive an approval or revocation envelope, but the current target-side ceremony does not apply it. Revocation therefore does not invalidate the target's local device state or sessions. | Implement the specified target-side ceremony only after defining target authorization context, epoch synchronization, and session invalidation. Until then, reject/drop with an explicit pending state rather than treating delivery as completion. | Yes, before claiming bidirectional lifecycle completion. |
| Stored commitment is not recomputed when persistence is read | Medium (open) | `SecureStorageDeviceLifecyclePersistence.readRecord` | Corrupted or partially restored local state can contain a device list and a mismatched commitment. Reads trust both values; later operations compare against the stored string rather than recomputing the list commitment. | Validate schema and recompute `deviceListCommitment(list)` on read; fail closed on mismatch. Use authenticated storage for the record and recovery from a prior immutable snapshot. | Yes, before treating local persistence as tamper-detecting. |
| Authorization digest is an integrity checksum, not an issuer signature | Medium (design boundary) | `DeviceLifecycleService` authorization model | An intermediary that can construct a new authorization and satisfy a weak verifier could recompute SHA-256. The digest alone does not prove which device approved the mutation. Current runtime does not apply remote approvals, limiting exposure today. | Bind authorization to the existing authenticated CryptoSession/control message and require the production verifier to authenticate issuer, target, scope, sequence, and epoch. Do not treat the digest as an identity proof. | Required in the target-side/production verifier before enrollment is distributed. |
| Epoch helper permits same-epoch commitment forks | Medium (open) | `assertNotRollback` | The helper rejects lower epochs but accepts a different commitment at the same epoch. A caller using this helper alone could accept a forked list. | Require same-epoch candidates to have the same commitment, and reject divergent equal-epoch state. Ensure all consumers use the strict check. | Yes, before exposing the helper to synchronization code. |
| Device-list state has no persisted pending target entry | Low (scope gap) | Runtime/UI lifecycle integration | The UI displays a pending request, while the persisted list jumps from no entry to active on approval. A restart loses the pending request and does not represent pending lifecycle state. | Add a durable pending-request record/entry in the enrollment ceremony; do not infer trust from UI state. | Required for a complete pending/approved/revoked UX, not a direct bypass today. |

## Attack results

### Enrollment

- Fake issuer and wrong identity references are rejected by context, active-entry,
  author-device, and digest checks.
- Wrong target, duplicate device identifier, expired request, stale epoch,
  commitment mismatch, modified authorization, and replayed authorization are
  rejected by lifecycle tests.
- Concurrent enrollment is **not safe** with the local adapter because its
  read/modify/write sequence is not atomic (Finding 2).

### Revocation

- Unauthorized, stale, repeated, already-revoked, self-revocation, and rollback
  attempts are rejected by the lifecycle service tests.
- A delivered remote revocation is not currently applied on the target (Finding
  3); this is fail-closed but incomplete, and must not be described as active
  revocation propagation.

### Identity and CryptoSession boundary

- Lifecycle mutation requires an encrypted, ready CryptoSession and a verified
  context. Legacy `ChatE2EE` has no lifecycle construction path.
- Device control payloads are encrypted through the modern signaling session;
  the relay does not receive plaintext controls.
- The digest is not an identity proof by itself (Finding 4); the production
  verifier must remain bound to the authenticated session and verified device
  identity.

### Epoch and commitment

- Lifecycle mutations require the expected epoch and previous commitment, and
  each accepted mutation increments the epoch and chains `previousCommitment`.
- Read-time commitment recomputation is missing (Finding 5), and the generic
  same-epoch helper is permissive (Finding 6).

### Runtime/UI boundary

- UI actions call `ModernConversation` methods; they do not write device lists
  directly. Those methods require the authenticated lifecycle service.
- Legacy conversations do not expose device controls.
- Incoming control routing defect was fixed so controls no longer depend on call
  UI initialization.

## Persistence failure and race analysis

The local adapter writes list, commitment, and authorization history in one
logical record, which prevents a deliberate field split in a single successful
write. It does not provide a transactional compare-and-set across tabs,
processes, or devices. Crash atomicity and restart recovery therefore remain a
deployment adapter responsibility. Duplicate transaction nonces are checked,
but that check is also subject to the same race without an atomic uniqueness
constraint.

## Multi-device offline scenario

If Device A enrolls C while Device B revokes A offline, both operations can be
created from the same epoch. The current persistence boundary cannot merge them
or deterministically resolve the conflict; a production adapter must atomically
claim the epoch and reject the loser. No last-writer-wins behavior is acceptable
for trust state.

## Security conclusion

The lifecycle service is fail-closed for the tested forgery, tampering, expiry,
replay, duplicate, and rollback cases. Phase 6B is **not ready for distributed
multi-device production use** until atomic persistence, target-side approval /
revocation handling, strict commitment validation, and authenticated issuer
binding are completed. These gaps do not require changes to Vodozemac,
CryptoSession internals, messaging, mailbox, attachments, media, or calls.

