# Phase 6B device-list authority specification

Status: normative design addendum. This document authorizes implementation of the Phase 6B.1 local model only; it does not change cryptographic primitives or Phase 1–5 protocols.

## Authority decision

Every device-list mutation (`add`, `revoke`, or `recover`) is authorized by an existing **active, locally verified device** through the authenticated modern `CryptoSession` boundary. The server, relay, a server-stored verification bit, a new root key, and an administrator are never authorities.

The authoring device must be active in the locally accepted list, must hold the expected conversation/session identity, and must explicitly approve the operation. A pending, revoked, recovery-replaced, stale, or unverified device cannot authorize a mutation.

## Control object data model

The authenticated control object contains:

```text
DeviceListControl {
  formatVersion: integer,
  userScope: opaque identifier,
  previousEpoch: non-negative integer,
  nextEpoch: non-negative integer,
  previousCommitment: 32-byte SHA-256 commitment,
  operation: "add" | "revoke" | "recover",
  deviceEntries: canonical sorted array,
  transactionNonce: unique bounded nonce,
  sequence: non-negative integer,
  createdAt: integer milliseconds,
  expiresAt: integer milliseconds,
  authorDeviceId: opaque device identifier,
  authorIdentityReference: existing public identity reference
}
```

The complete canonical object is authenticated inside `CryptoSession`; the session context binds the sender to `authorIdentityReference`, the expected conversation/user scope, and the signaling/control purpose. A SHA-256 commitment detects mutation but is not an identity proof. No detached signature or new key is introduced by this addendum.

## Verification and state transition

Receivers must, in order:

1. Parse the strict schema and reject unknown fields, duplicate device IDs, invalid state transitions, and invalid time windows.
2. Verify the authenticated `CryptoSession` and expected author identity.
3. Verify scope, operation, nonce, sequence, expiry, and `nextEpoch = previousEpoch + 1`.
4. Match `previousCommitment` to the locally accepted list.
5. Atomically claim the transaction nonce/sequence through replay protection.
6. Persist the next list before exposing the new membership state.
7. Require explicit local verification before an added device becomes `active`.

Failure at any step is fail-closed and produces a generic unavailable/rejected result. A server response cannot activate a device.

## Security reasoning

This authority preserves the existing identity/session trust boundary and prevents a relay from manufacturing a membership update. It deliberately accepts that a compromised unlocked active device can authorize a malicious device; endpoint compromise is not solved by server metadata. Recovery is a separate destructive operation that creates a new epoch and invalidates old devices.

### Threats prevented

- server-forged or server-approved device enrollment;
- relay mutation or cross-conversation substitution;
- stale, duplicate, or replayed membership updates;
- activation based solely on a routing record;
- private-key escrow and parallel identity systems.

### Test requirements

- valid active verified author succeeds;
- pending, revoked, stale, or unverified author fails;
- modified canonical fields or scope fail authentication/commitment checks;
- wrong `CryptoSession` identity, conversation, purpose, or epoch fails;
- duplicate, expired, and replayed nonce/sequence are rejected;
- server-only activation and raw unauthenticated control paths are impossible;
- added device remains pending until explicit verification and durable list persistence.

## Frozen boundaries

The implementation must use the existing `MessagingIdentity`, `ContactIdentity`, and `CryptoSession` APIs. It must not add root keys, alter Vodozemac, change message/mailbox formats, redistribute attachment/media keys, or modify legacy behavior.
