# K3ncrypt Phase 6B.2 runtime integration boundary

Status: normative integration design only. No enrollment code, cryptographic primitive, mailbox/message change, or trust-changing UI is introduced by this document.

## 1. CryptoSession integration

### Existing boundary

The current `CryptoSession` encrypts/decrypts logical channels and exposes readiness, but it is deliberately not a public identity directory. `ModernConversation` already owns the surrounding authenticated context: the active Vodozemac session, local `MessagingIdentity`, conversation ID, transport, remote routing address, and `ContactIdentityRegistry` record.

Enrollment must therefore use a **composed authenticated context**, not infer identity from a relay address or add methods to the cryptographic primitive:

```text
ModernConversation runtime
  ├─ ready CryptoSession (existing primitive)
  ├─ local MessagingIdentity reference
  ├─ verified remote ContactIdentity reference
  ├─ conversation/control purpose
  └─ transport sender-routing candidate
        ↓
DeviceAuthorizationVerifier
        ↓
DeviceListUpdater
```

### Sender identity extraction

1. Receive an opaque control envelope with `senderRoutingId` only as a routing candidate.
2. Confirm the envelope arrived on the expected modern `CryptoSession` control channel for the conversation; decrypt/authenticate it through the existing session.
3. Resolve `senderRoutingId` to the locally pinned `ContactIdentityRegistry` record for that conversation.
4. Require the decrypted authorization's `authorDeviceId` and `authorIdentityReference` to match the verified contact identity bound to that session. A routing ID, room ID, socket ID, or public list field alone is never identity proof.

Outbound authorization uses the local `MessagingIdentity` reference and the ready session's authenticated sender context. The transport receives only the encrypted envelope and routing metadata.

### Receiver validation and point of verification

`DeviceAuthorizationVerifier` runs after envelope decryption and before any device-list mutation. It validates channel/purpose, conversation scope, expected verified author identity, canonical authorization digest, request binding, epoch/commitment, expiry, and replay claim. `DeviceListUpdater` is called only after verification succeeds and an atomic persistence transaction is available.

The control message type is a versioned, bounded `device-enrollment-control` payload carrying the canonical request/authorization structures from `PHASE6B2_ENROLLMENT_PROTOCOL_SPEC.md`. It is not sent on the message or call-signaling channel, and it has no plaintext fallback.

### Primitive freeze

No new root key, detached signing scheme, derived session signing key, or Vodozemac change is introduced. The existing authenticated `CryptoSession` envelope and the existing verified identity registry provide sender proof. If a runtime path cannot supply this composed context, it must be unavailable/fail closed rather than use raw transport.

## 2. First-time bootstrap flow

### Options

| Option | Security/availability | Decision |
| --- | --- | --- |
| QR pairing as trust proof | A QR can be copied or relayed; it is a presentation channel, not cryptographic authority | Reject as sole proof |
| Manual verification code | Same out-of-band comparison properties, but higher transcription error and no structured public payload | Keep as accessibility fallback, not the primary protocol |
| Existing identity verification mechanism, presented as canonical QR/fingerprint and followed by the existing Vodozemac pre-key/session flow | Reuses `MessagingIdentity`, `ContactIdentityRegistry`, explicit verification, and current `CryptoSession` establishment without a new key system | **Choose** |

### Chosen flow

1. B generates its identity locally and publishes/advertises only its existing public Vodozemac bundle through the current modern conversation bootstrap boundary.
2. A fetches the bundle through the existing authenticated conversation/link context and observes it in `ContactIdentityRegistry` as unverified.
3. A and B compare the canonical public fingerprint. A QR is the structured display of public fingerprint, device ID/commitment, nonce, purpose, and expiry; manual grouped fingerprint entry is an equivalent fallback.
4. The user explicitly confirms the comparison; the existing verification foundation records the contact as verified. QR content alone never flips trust.
5. The existing Vodozemac pre-key/session establishment creates the authenticated `CryptoSession`; no existing private session state is copied to B.
6. Only then may the enrollment control channel be opened for a device-list authorization.

If bundle publication, contact verification, or session establishment fails, B remains pending and no device-list update is accepted. A server cannot convert a published bundle into a verified identity.

## 3. Device-authority adapter

### Boundary

```text
ready CryptoSession + verified identity context
                  ↓
        DeviceAuthorizationVerifier
                  ↓
           DeviceListUpdater
```

### Verifier inputs

- authenticated modern `CryptoSession` handle/context and control channel;
- conversation ID and expected purpose/version;
- sender routing candidate and pinned `ContactIdentity`;
- local accepted `DeviceList` and current epoch/commitment;
- decrypted canonical `EnrollmentRequest` or `EnrollmentAuthorization`;
- current clock and replay-claim port.

### Verifier output

On success, a typed internal result containing only the validated operation, author/target public references, transaction nonce, sequence, prior epoch/commitment, expiry, and canonical digest. It contains no private key, raw session state, message plaintext, or transport object.

On failure, a generic rejected/unavailable result plus bounded non-sensitive diagnostics. It never returns a partially trusted device entry.

### Updater inputs/outputs

`DeviceListUpdater` accepts only a verifier result and an immutable current list. It validates `nextEpoch = current + 1`, prior commitment equality, duplicate IDs, lifecycle transition, and atomic persistence. It returns an immutable next-list snapshot and new commitment only after persistence succeeds. It does not publish notifications, migrate sessions, or revoke existing protocol state in this phase.

### Failure cases

Reject on missing/unready session, wrong channel/purpose, unknown routing identity, unverified/changed contact, wrong conversation, malformed canonical object, digest mismatch, nonce/sequence replay, expiry, stale/future epoch, prior-commitment mismatch, duplicate ID, invalid lifecycle transition, atomic persistence failure, or server-only activation attempt.

## 4. Persistence atomicity

### Required transaction

The following records must commit as one logical transaction:

1. immutable `DeviceList` object;
2. new epoch and previous commitment link;
3. resulting device-list commitment;
4. authorization record/nonce claim, including expiry and sequence;
5. operation status sufficient to distinguish pending from committed.

No caller may expose the new active membership before all five are durable. If any write fails, the transaction is aborted or recoverable as pending; a retry must not create a second accepted epoch or consume the authorization twice.

### Storage boundary

The existing `SecureStorage` interface does not currently promise multi-record transactions or atomic compare-and-set. Phase 6B.2 therefore requires a new reviewed adapter boundary (not a cryptographic primitive) with atomic claim-and-commit semantics. A memory implementation may be used only for deterministic tests; it is not production persistence.

The transaction must be scoped to `userScope`/conversation, enforce uniqueness on `(transactionNonce, authorDeviceId, sequence)`, reject stale epochs, provide TTL cleanup, and survive restart/multi-instance races. Logs and diagnostics must not include identity private material, recovery secrets, plaintext, or authorization bearer data.

## 5. Integration threat boundaries

- **CryptoSession:** authenticates and encrypts the control envelope; it does not become a device directory or new signing key.
- **Identity registry:** supplies explicit local verification and changed-identity status; a server record cannot override it.
- **Transport:** forwards opaque ciphertext and routing metadata only; raw transport cannot call the updater.
- **DeviceAuthorizationVerifier:** the sole post-decryption authorization point.
- **DeviceListUpdater:** the sole mutation/persistence point for immutable lists.
- **Messaging/mailbox/calls/attachments:** remain frozen until later epoch-adapter work explicitly gates new operations; historical ciphertext is untouched.

## 6. Implementation readiness

**NOT READY.** The design boundary is now explicit, but implementation must wait for these exact runtime decisions/gates:

1. Confirm the application composition can provide the verified sender identity associated with each ready `CryptoSession` without changing the primitive API or trusting `senderRoutingId`.
2. Define and test the authenticated control-channel framing/type and its bounded receive path in `ModernConversation`.
3. Add the reviewed atomic claim-and-commit persistence interface; current `SecureStorage` alone is insufficient.
4. Publish cross-platform canonical enrollment vectors and integration tests proving same-epoch divergence, replay, and restart races fail closed.

No enrollment UI, recovery, notification, session migration, or server authority should be implemented until these gates pass.
