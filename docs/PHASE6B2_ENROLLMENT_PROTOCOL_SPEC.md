# K3ncrypt Phase 6B.2 enrollment protocol specification

Status: normative design only. This document defines the enrollment/control protocol but does not implement enrollment, UI, recovery, notifications, or a new cryptographic primitive. Phase 1–5 boundaries remain frozen.

## Protocol invariants

1. Only an existing `active` and locally verified device can approve enrollment.
2. Every control message is carried through the authenticated modern `CryptoSession` for the correct conversation and control purpose.
3. A digest is a commitment/mutation check, not an identity proof. Sender proof comes from the existing authenticated session and expected verified author identity.
4. A new device is never active because a server returned a record. It becomes active only after explicit user confirmation, authenticated approval, canonical list persistence, and epoch agreement.
5. Transactions are one-time, short-lived, epoch-bound, and replay-claimed atomically in production.
6. No private key, session pickle, recovery secret, message key, attachment key, or hidden trust decision crosses the enrollment boundary.

## 1. Device enrollment ceremony

### 1.1 Enrollment request

**Sender:** new device B.  
**Receiver:** existing trusted device A through the existing authenticated conversation/control channel; a relay may route the opaque envelope.

The new device creates its identity locally and emits a public-only request:

```text
EnrollmentRequest {
  formatVersion: 1,
  userScope,
  transactionNonce,
  requestedDeviceId,
  requestedPublicIdentityReference,
  algorithmVersion,
  purpose: "device-enrollment",
  knownEpoch,
  createdAt,
  expiresAt
}
```

The request is authenticated by the existing session context when delivered to A. B remains `pending` locally. A validates the strict schema, user/conversation scope, purpose, nonce uniqueness, expiry, identity reference, and that `knownEpoch` is not ahead of its accepted list. A request with an unknown author session, stale/conflicting transaction, or changed identity is rejected without creating trust.

The user compares B's canonical public fingerprint/QR with A in an explicit local ceremony. QR data contains only allow-listed public fields, nonce, purpose, epoch, and expiry; it is not a permanent bearer token.

### 1.2 Approval

**Sender:** user operating active verified device A.  
**Receiver:** B through the authenticated modern `CryptoSession` control path.

After the user confirms the matching fingerprint, A validates that its own list contains A as `active`, verifies the request nonce and expiry, and checks the request's public identity against the local ceremony. A creates an `EnrollmentAuthorization` object:

```text
EnrollmentAuthorization {
  formatVersion: 1,
  userScope,
  operation: "add",
  authorDeviceId,
  authorIdentityReference,
  requestedDeviceId,
  requestedPublicIdentityReference,
  transactionNonce,
  previousEpoch,
  previousCommitment,
  sequence,
  createdAt,
  expiresAt,
  authorizationDigest
}
```

`authorizationDigest` is SHA-256 over the canonical object excluding the digest field. The complete object is sent inside the existing authenticated `CryptoSession`; it is not a standalone signature and cannot be accepted from a raw relay route. A must never approve a device ID or public identity different from the user-confirmed request.

### 1.3 Authorization verification

**Receiver:** B and A.  
**Authentication:** existing authenticated `CryptoSession`, expected conversation, and expected author identity.

Both devices verify, in order:

1. strict schema, canonical encoding, and version;
2. authenticated session/channel and expected conversation/user scope;
3. `authorDeviceId` and `authorIdentityReference` match active verified A;
4. operation, requested device identity, nonce, and purpose match B's unexpired request;
5. `previousEpoch` and `previousCommitment` match the locally accepted list;
6. `createdAt <= expiresAt` and current time is within the bounded window;
7. digest recomputation over canonical fields;
8. atomic replay claim for `(userScope, transactionNonce, authorDeviceId, sequence)`.

Any failure is generic rejection. Neither B nor a server may repair a malformed authorization or substitute a different identity.

### 1.4 Device-list update and epoch increment

After successful authorization, both devices construct the same next list:

```text
Before: DeviceList(epoch = N, commitment = C_N)
After:  DeviceList(epoch = N + 1,
                   previousCommitment = C_N,
                   devices = prior entries + B in pending/verified state)
```

The list uses the canonical encoding and SHA-256 commitment specified by Phase 6B.1. The new device is not `active` until the explicit verification and persistence conditions are complete. Both devices persist the immutable list snapshot and new commitment before acknowledging completion. A mismatched list, commitment, or epoch leaves B pending and blocks sensitive continuation.

### 1.5 Session bootstrap

Once B is active, it establishes its own device-scoped modern sessions using the existing Vodozemac/CryptoSession APIs. The enrollment protocol may deliver public device-list material and encrypted, device-scoped control required to establish those sessions; it never copies A's private session state. Existing conversations are not migrated and historical ciphertext is not rewritten.

## 2. Authorization proof

The statement “trusted Device A approved Device B” is proven by the conjunction of:

1. an authenticated modern `CryptoSession` envelope accepted only in the expected conversation/control channel;
2. the envelope's authenticated sender/session identity matching A's current verified public identity;
3. the canonical `EnrollmentAuthorization` binding A, B, scope, request nonce, previous epoch/commitment, sequence, timestamp, expiry, and operation;
4. explicit local user confirmation of B's public fingerprint; and
5. one-time replay claim and atomic next-list persistence.

No server flag, routing ID, QR alone, or SHA-256 digest is sufficient. If a future delivery path cannot provide the existing authenticated session proof, that path is unsupported and must fail closed rather than introduce a new root key or detached signing system.

## 3. New-device bootstrap boundaries

### B may receive

- its own public identity reference and device ID;
- the canonical public device list and current epoch/commitment;
- the authorization object and bounded transaction status;
- public peer identity material needed for explicit verification;
- outputs of B's own newly established device-scoped session.

### B must never receive

- A's or another device's private identity key;
- another device's vault/session pickle or private ratchet state;
- recovery secrets or server-admin reset material;
- message, attachment, or call media keys unrelated to B's own session;
- hidden verification decisions or a server-controlled trust assertion;
- permanent enrollment bearer tokens.

The relay/server may route encrypted control and store opaque public metadata. It cannot activate B or derive private material.

## 4. Device-list update contract

The update is accepted only when all of the following hold:

- `previousEpoch = N` and local accepted epoch is N;
- `nextEpoch = N + 1`;
- `previousCommitment = C_N` exactly;
- authorization digest and authenticated sender proof verify;
- B's device ID is not already present;
- canonical output has no duplicate IDs or unknown fields;
- replay claim succeeds once;
- both devices persist the same immutable next list.

The new commitment is computed as `SHA-256(canonicalDeviceListObjectBytes)`. A changed device entry, epoch, lifecycle, author, or commitment changes the canonical digest and fails verification. Same-epoch divergent lists are conflicts, never last-writer-wins merges.

## 5. Attack analysis

| Attack | Required outcome and protection |
| --- | --- |
| Attacker adds a fake device | Rejected because only active verified A's authenticated session can authorize, fingerprint comparison is explicit, and B remains pending until persistence/verification. A compromised unlocked A remains an endpoint threat. |
| Stolen old approval | Rejected by nonce/sequence/expiry, previous epoch/commitment, and atomic replay claim. |
| Replay enrollment request | Rejected as duplicate/expired; request cannot be reused with a different public identity. |
| Malicious server | It can route, delay, or drop opaque envelopes but cannot create an authenticated A proof, activate B, or choose a list epoch. |
| Compromised existing device | A can authorize while compromised; this is an explicit endpoint limitation. Revocation/recovery and contact review must address it later. |
| Rollback attempt | Lower epoch, skipped epoch, mismatched prior commitment, and stale authorization fail closed. |
| Same-epoch conflict | Divergent canonical lists are rejected and require a fresh ceremony; no silent merge. |

## 6. Test requirements

### Positive

- valid A/B request, fingerprint confirmation, authorization, epoch N→N+1, and immutable list persistence;
- B remains pending before confirmation and becomes active only after all conditions;
- B establishes its own modern session without receiving A's private state.

### Negative/adversarial

- wrong or unverified author identity;
- raw/unauthenticated control envelope;
- tampered author, target identity, scope, nonce, digest, epoch, or prior commitment;
- replayed request and replayed authorization;
- expired authorization, sequence reuse, and stale request;
- duplicate device ID and same-epoch divergent list;
- rollback, skipped epoch, wrong conversation, and server-only activation;
- compromised-author limitation is documented and surfaced as a security event, not silently trusted.

## Final decision

**NO — Phase 6B.2 is not yet ready for implementation.**

The enrollment ceremony and proof contract are now fully specified. Implementation still requires the existing runtime to expose and test the authenticated `CryptoSession` sender/identity context for this control path, plus a production atomic replay/list persistence adapter and cross-platform canonical vectors. Those are concrete implementation gates, not permission to add a new cryptographic authority. Until they pass, do not implement enrollment UI, recovery, notifications, or trust-changing operations.
