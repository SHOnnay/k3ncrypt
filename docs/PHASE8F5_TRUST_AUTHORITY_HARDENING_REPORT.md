# Phase 8F-5 Trust Authority Hardening Report

## Scope

This phase hardened the existing durable device authority and its protected consumers. The encryption, Vodozemac boundary, and account/device trust architecture were preserved.

## Fixed findings

### Lifecycle state transitions

`DurableDeviceTrustAuthority.update` now accepts only an explicit revocation transition from an active target. It requires the issuer and target to share the current event epoch, requires `nextEpoch = previousEpoch + 1`, verifies a current `device-control` proof, and rejects revoked, pending, stale, replayed, or unknown transitions. The HTTP update endpoint now carries the signed event and proof together.

### Self-signed enrollment

The enrollment path no longer contains a bootstrap-like branch. Enrollment requires an existing active issuer in the same account, a matching issuer identity and epoch, a valid signed event, and a verified durable device-control proof. First-device creation remains isolated to `/bootstrap`.

### Replay ordering

Enrollment and lifecycle update validation now completes before the event nonce is consumed. Invalid authorization no longer consumes a valid event identifier. The durable nonce collection remains uniquely indexed and is used as the replay guard.

### Device identity uniqueness

Migration setup now creates a unique `device_identity_registry.deviceId` index for future immutable identity registration. Existing lifecycle data is not deleted or rewritten; a duplicate conflict fails migration and requires explicit operator reconciliation.

### Private-network membership

Private relay admission now requires an active record in the durable `private_network_members` collection and a matching membership epoch in addition to the device proof. Unknown networks and members, removed members, and stale membership epochs fail closed.

### Message routing fallback

The legacy `authorizeRoutingAddress` fallback now rejects missing pre-key ownership records. Routing identities must have an ownership record and valid renewal proof before joining a channel.

### Attachment trust context

The production attachment context no longer installs an unconditional no-op trust callback. It captures the verified device, account, operation, epoch, and proof expiry and rechecks those invariants when the attachment authorization service invokes the trust boundary.

## Remaining limitations

The current proof format still has no general resource-binding field for conversation, attachment, network, or bridge identifiers. Private-network membership is fail-closed until the durable membership collection is populated by the application control plane. The unique identity index requires a reviewed migration if historical duplicates exist. Existing workspace TypeScript configuration also reports unrelated client dependency and target errors (`@k3ncrypt-vodozemac`, Vite resolution, and `String.replaceAll`).

## Validation

- Targeted Jest: `backend/security/deviceTrust.test.ts` passed.
- Mongo integration suite: skipped when Mongo environment variables are absent; it must be rerun with `MONGO_URI` and `MONGO_DB_NAME` against a clean database.
- TypeScript: repository-wide check remains blocked by the pre-existing client module-resolution and ES target errors listed above.
- Production code was changed only in the trust authority, relay/routing enforcement, migration indexes, attachment context, and device-trust route.

The listed Phase 8F-5 findings are addressed in the implementation, subject to completing the resource-binding and durable membership control-plane limitations before claiming full production security readiness.
