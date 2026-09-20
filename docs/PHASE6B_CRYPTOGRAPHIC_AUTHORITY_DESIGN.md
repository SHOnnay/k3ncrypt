# K3ncrypt Phase 6B cryptographic authority design

Status: design review only. This record does not add code, keys, migrations, or protocol changes. It is subordinate to the Phase 1–5 security freeze and must be re-reviewed against the concrete identity/session APIs before implementation.

## Scope and existing boundary

`MessagingIdentity` is the existing client-owned Vodozemac device identity. `ContactIdentity` records a peer's public identity and local verification/change-review state. `CryptoSession` authenticates and encrypts modern conversation control data. Neither the relay nor a server-side “verified” flag is a trust authority.

Phase 6B may add a device-membership/control adapter around these boundaries. It must not add a parallel root key, server account password, private-key escrow, or a second identity system. Existing conversations, mailbox semantics, attachment encryption, call signaling, and legacy behavior remain unchanged.

## 1. Device-list authority

### Options considered

| Option | Security property | Cost/risk | Decision |
| --- | --- | --- | --- |
| New user/root signing key | One stable authority can sign all device lists | Introduces a new key hierarchy, backup and rotation problem; conflicts with the frozen identity model | Reject for 6B |
| Any existing device authorization | Uses already authenticated device/session context | A compromised active device can authorize a malicious device; recovery is availability-sensitive | **Choose, with explicit verification and epoch checks** |
| Multi-device approval | Requires two or more active devices to approve | Stronger against one compromised device, but enrollment/revocation can become unavailable | Future strengthening, not baseline |
| Threshold approval | Tolerates some compromised devices | New threshold/key-management protocol and substantial recovery complexity | Defer; design is not ready |

### Chosen authority

The authority for a device-list update is an **active, locally verified existing device**, acting through the existing authenticated modern `CryptoSession`. The approval is scoped to one user/device-list, one transaction, one epoch transition, and one operation. It is never a server decision.

This preserves the current identity model and gives the relay only an opaque authenticated control envelope. It also makes the authority limitation explicit: possession of an active device is sufficient to approve an update, so a compromised unlocked device remains a high-impact endpoint compromise.

Enrollment requires explicit user confirmation and a matching public-identity fingerprint on both devices. Revocation and recovery are destructive operations and require the same authenticated authority or a separately approved recovery ceremony. If no trusted authority is available, the system fails closed rather than accepting a server reset.

## 2. Device-list signature and authentication model

### Signed object (conceptual)

The list is serialized deterministically before authentication. The conceptual signed object is:

```text
DeviceListControl {
  formatVersion,
  userScope,
  previousEpoch,
  nextEpoch,
  previousListCommitment,
  operation,                 // add | revoke | recover
  sortedDeviceRecords,
  transactionNonce,
  sequence,
  createdAt,
  expiresAt,
  authorDeviceId,
  authorIdentityReference
}
```

`sortedDeviceRecords` is ordered by canonical device identifier. Duplicate IDs, unknown lifecycle transitions, invalid timestamps, extra fields, and non-canonical encodings are rejected. The authenticated bytes cover every field above; no field is interpreted outside the authenticated object.

### Authority proof

The **signing/authority key is the existing author device identity**, not a new Phase 6B key. In the deployed design, the control object must be sent inside the existing authenticated `CryptoSession` boundary, which proves that the author controls the established device/session context. If a durable, independently verifiable list is required outside that session, an adapter may expose an existing identity signature capability only after confirming that the current Vodozemac/identity API supports it without changing primitives.

Phase 6B must not invent a detached-signature format, derive a new signing key from a session key, or treat a SHA-256 digest as a signature. A digest is useful as a commitment and mutation check; it is not proof of author identity. If the current APIs cannot provide the required proof for a particular delivery path, that path is not implementable and must fail closed.

### Verification process

1. Parse strict schema and canonicalize bytes.
2. Verify the authenticated modern session and expected author device identity.
3. Verify user scope, operation, nonce, sequence, timestamps, and expiry.
4. Require `previousEpoch` and `previousListCommitment` to match local state, and require `nextEpoch = previousEpoch + 1`.
5. Apply the update only once through replay protection and persist the new list atomically.
6. Require explicit local verification for a newly added identity before marking it `active`.

The server may persist opaque records and route ciphertext. It cannot create a valid author proof or elevate a pending device.

## 3. Epoch model

- **Creation:** the initial device list starts at an explicit epoch (for example, `0`) and a canonical commitment. The value is local protocol state, not server time.
- **Increment:** every accepted add, revoke, or recovery replacement consumes exactly one next epoch. No operation may skip, reuse, or decrement an epoch.
- **Binding:** each control object includes the previous epoch and previous-list commitment; the new list records its own commitment for the next operation.
- **Invalidation:** when an epoch advances, device-scoped control/session authorization based on an older membership view is stale. Existing message/session cryptography is not rewritten; affected adapters must require reconciliation before new sensitive operations.
- **Propagation:** contacts receive authenticated minimum change notifications and enter changed-pending-review where their verified device view is stale. Notification loss cannot authorize a stale device.
- **Rollback prevention:** reject old epochs, mismatched previous commitments, same-epoch divergent lists, gaps, duplicate transactions, and conflicting recovery events. Persistence and replay claim must be atomic in production.

Epochs are a membership/control mechanism, not a replacement for Vodozemac ratchets, message keys, attachment keys, or call media keys.

## 4. Full device-loss recovery

### Recovery authority

Recovery is authorized only by user-owned recovery material created and encrypted locally before loss, or by a still-active verified device. The server stores ciphertext and opaque version metadata only. There is no operator, support, or server-admin recovery authority.

### Replacement flow

1. A replacement device creates a fresh identity locally.
2. It presents a one-time, expiring recovery transaction bound to the recovery package, user scope, nonce, and current known epoch.
3. The user verifies the recovery ceremony locally; the server only routes/stores opaque data.
4. A new epoch is committed. Prior devices become `recovery-replaced`/`revoked` unless explicitly re-enrolled and re-verified.
5. Contacts receive an authenticated identity-change event. Prior verification is removed or placed in changed-pending-review; no trust is inherited silently.

Malformed, replayed, stale, concurrent, wrong-scope, or substituted recovery packages fail closed. If all devices and recovery material are lost, secure recovery may be impossible. That is preferable to server escrow or silent replacement.

## 5. Offline conflict resolution

Security-sensitive membership has no last-writer-wins merge.

- **Additions:** accept only a valid next epoch with matching previous commitment, unique device ID, valid enrollment nonce, and the required explicit verification. Concurrent additions from the same previous epoch conflict; retain neither automatically and require a fresh ceremony from the current authority.
- **Revocations:** a valid revocation at the next epoch wins over an uncommitted pending addition for the same device. Two valid revocations from the same prior epoch are equivalent only if they produce the same canonical result; otherwise enter conflict and require review.
- **Recovery:** a valid recovery replacement supersedes all prior uncommitted membership updates because it establishes a new epoch and invalidates prior device authority. Concurrent recovery attempts are rejected after the first atomically claimed transaction.

All transactions have one-time nonces, bounded expiry, sequence/epoch binding, and durable replay claims. During conflict, clients may display a security warning and retain ciphertext, but must not send sensitive traffic, activate a device, or silently alter contact trust. Deterministic ordering is used only for diagnostics and retry selection, never as a substitute for authorization.

## 6. Compatibility review

### Compatible extensions

- Vodozemac and `CryptoSession`: remain the existing authenticated session boundary for control envelopes; no primitive or session format changes.
- Identity verification: each device remains an independently verified public identity; changed identities continue to require explicit review.
- Messaging: existing conversations and message formats remain immutable. Device membership can gate future admission through an adapter only after epoch reconciliation.
- Calls: authenticated call signaling continues to require the modern verified conversation context; revoked/stale devices are denied by the call authorization adapter.

### Frozen boundaries

Phase 6B must not alter Vodozemac, `CryptoSession` internals, identity key generation, mailbox semantics, message encryption/protocol defaults, attachment encryption/keys, media encryption, call signaling cryptography, or legacy conversations. It must not fan out private session state through the server or retrofit a server trust bit.

## Security decision summary

| Decision | Threat prevented | Tradeoff | Remaining risk |
| --- | --- | --- | --- |
| Existing verified device authority | Server-forged lists and silent enrollment | One active device is a high-value authority | Compromised unlocked device can approve a device |
| Session-bound canonical control object | Relay mutation, substitution, and scope confusion | Requires existing session availability | Independent offline verification is unavailable until a reviewed identity proof exists |
| Monotonic epoch + prior commitment | Rollback, replay, split-brain membership | Conflicts block availability | Durable multi-instance atomic persistence is required |
| User-owned recovery replacement | Server impersonation and silent recovery | Full loss can be irreversible | Recovery material and endpoints remain high-value secrets |
| Fail-closed offline conflict handling | Automatic trust changes under partition | Manual recovery/reverification burden | Denial-of-service can prolong conflict state |

## Conclusion

**More design required.** The authority and epoch policy is selected, but implementation must wait for a reviewed confirmation that the existing identity/session APIs can provide the required author proof for every delivery path without adding a new cryptographic primitive. The following gates remain unresolved: durable atomic list/replay persistence, exact cross-platform canonical serialization/fingerprint encoding, loss-of-all-devices recovery UX and incident handling, offline notification guarantees, and explicit epoch binding at mailbox/attachment/call adapters. No Phase 6B code or migration should begin until those gates are closed.
