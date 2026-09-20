# Phase 6B epoch-enforcement matrix

Status: normative design addendum. Epoch enforcement gates new membership-sensitive operations; it does not rewrite historical ciphertext or frozen Phase 1–5 formats.

## Epoch invariants

- The initial list has an explicit epoch and commitment.
- Every accepted add, revoke, or recovery update advances exactly one epoch.
- `nextEpoch` equals `previousEpoch + 1`.
- The previous commitment must match the locally accepted list.
- Old, skipped, reused, divergent same-epoch, or uncommitted updates fail closed.
- Replay claims and list persistence are atomic in production.

## Enforcement matrix

| Area | Current-epoch requirement | Stale/revoked result | Frozen behavior |
| --- | --- | --- | --- |
| Device authorization/enrollment | Author must be active, verified, and on the current list; new device must use the expected previous epoch | Reject; remain pending or require a new ceremony | Existing identity/session primitives unchanged |
| New modern sessions | Both participants must present current, non-revoked membership context before creating a new session | Reconcile first; otherwise fail closed | Existing Vodozemac/CryptoSession handshake and formats unchanged |
| Messaging admission | New sensitive send/delivery authorization must not rely on a stale or revoked device list | Reconcile-required or reject; no silent downgrade | Historical encrypted messages and mailbox payloads remain unchanged |
| Calls/signaling | Call admission and authenticated signaling require current verified device membership | Reject invitation/control; no WebRTC negotiation | Existing call-signaling cryptography and WebRTC boundary unchanged |
| Attachments | Create/upload/download/delete authorization requires current conversation/device membership | Generic unavailable/permission failure | Ciphertext, keys, and attachment format unchanged |
| Contact verification | Device-list/identity change enters changed-pending-review | Block sensitive continuation until explicit review | Existing verification states and identity-change semantics unchanged |
| Historical data | No epoch check retroactively rewrites already encrypted records | Data remains historical; endpoint compromise is not repaired | No migration or re-encryption |

## Reconciliation behavior

A stale device may fetch only the minimum authenticated membership/control data needed to reconcile. It must verify the previous commitment chain, claim replay state, persist the accepted epoch, and only then resume operations. If the chain is missing, conflicting, rolled back, or unverifiable, the device remains blocked and retains ciphertext without sending sensitive content.

Revocation is immediate on the authoring device and eventually propagated to peers. Offline peers cannot use an old epoch to override a newer one. A recovery update creates a new epoch, invalidates prior device authority, and causes explicit contact trust review.

## Security reasoning

The matrix prevents one subsystem from accepting a revoked device while another rejects it. It separates membership gating from cryptographic message history, preserving the Phase 1–5 freeze while preventing stale authorization for new sessions, calls, and attachment access.

### Threats prevented

- revoked/stolen device admission;
- protocol or authorization downgrade through stale state;
- cross-subsystem epoch confusion;
- rollback and split-brain membership;
- automatic trust preservation after recovery.

### Test requirements

- current epoch succeeds for each matrix row;
- stale, revoked, skipped, rolled-back, and divergent epochs fail with generic outcomes;
- new sessions, calls, and attachment operations reject stale membership;
- historical encrypted messages remain readable/immutable according to existing behavior;
- offline reconciliation is required before sensitive resume;
- recovery invalidates old device authorization and triggers contact review;
- legacy conversations cannot be upgraded or downgraded through epoch checks.
