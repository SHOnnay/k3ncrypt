# K3ncrypt Phase 6B final implementation specification

**Status: final design review; implementation is not authorized.** This document is the single design source of truth for a future Phase 6B implementation. It consolidates the Phase 6B threat model, protocol design, decision record, and cryptographic-authority review. It does not change source code, cryptographic primitives, protocol defaults, or Phase 1–5 behavior.

## 1. Complete system model

```text
User (local trust decisions)
  ↓ owns
Device identities (one independently generated identity per device)
  ↓ authorized through existing authenticated session
Canonical device list + monotonic membership epoch
  ↓ gates
Device-scoped sessions and verification state
  ├─ existing encrypted messaging/mailbox
  ├─ existing authenticated call signaling/WebRTC boundary
  └─ existing attachment/media authorization adapters
```

The user is a local grouping of independently verified device identities, not a server account. Each device owns its private identity and encrypted local state. An active, explicitly verified device authorizes membership changes through the existing modern `CryptoSession`; the server is a relay/storage participant, never the trust authority.

Trust relationships are: (1) a device trusts its own local vault and identity runtime; (2) a device trusts another device only after the enrollment ceremony and canonical list update; (3) a contact trusts a device identity only through explicit verification and current epoch review; and (4) the server is trusted only to provide availability and bounded opaque routing/storage, not confidentiality or identity decisions.

The server can observe opaque device identifiers, public identity material, list epochs, delivery/routing metadata, update timing, and availability. It must not receive private keys, session/vault keys, recovery plaintext, message/media plaintext, attachment keys, or a server-controlled trust bit.

## 2. Device identity design

### Local state

Each device independently generates the existing `MessagingIdentity` using the current Vodozemac-backed identity boundary. The private identity state, vault/session pickles, verification decisions, pending enrollment material, and recovery material remain in encrypted local storage/platform keystore. Device identity keys are never copied from another device and are never reconstructed by the server.

### Public and remote state

A device identifier is a stable opaque identifier derived from its public identity; it is not a socket, account, or bearer token. A public device record contains only:

- format/algorithm version;
- device identifier and public identity/fingerprint;
- lifecycle state (`pending-enrollment`, `pending-verification`, `active`, `revoked`, or terminal `recovery-replaced`);
- list epoch and bounded creation/revocation timestamps;
- optional user-controlled display label.

The remote metadata record is encrypted or authenticated as appropriate for its transport and contains no private material, plaintext recovery secret, message key, attachment key, or hidden trust decision. Labels and timestamps are metadata, not authority.

### Invariants

There is exactly one private identity owner per device. Device IDs are unique within a canonical list. A device cannot become `active` solely because a server returned a record. Identity changes preserve the existing changed-pending-review behavior and never silently replace a verified identity.

## 3. Device enrollment protocol

Enrollment is a one-time, short-lived ceremony between an active verified device and a new device.

### Messages and state transitions

1. **Request:** the new device generates a fresh identity and random transaction nonce locally. It creates a public enrollment commitment containing user scope, new device public identity, purpose, nonce, current known epoch, and expiry. No private key or permanent bearer secret is included. State is `pending-enrollment`.
2. **Presentation:** the user compares the canonical fingerprint/QR on both devices through the local ceremony. The existing device obtains the new public identity from that comparison, not from an untrusted server assertion.
3. **Approval:** the existing active device validates scope, nonce, purpose, expiry, expected epoch, and identity match, then emits a canonical control object through the existing authenticated `CryptoSession`. The object binds author device, new device, transaction, previous commitment, sequence, and expiry.
4. **List update:** both devices verify the authenticated control object, produce the same deterministic device-list bytes, and advance one epoch. The update is persisted locally before activation. Replay protection claims the nonce/sequence atomically in production.
5. **Session creation:** only after list persistence and explicit verification does the new device establish device-scoped modern sessions and transition to `active`. The existing device acknowledges completion.

### Authentication and failures

The existing authenticated modern session proves author-device control. A SHA-256 digest is only a mutation commitment, never an identity proof. A detached signature or other offline proof may be added only if the existing identity API exposes it without introducing a new primitive; otherwise the path remains session-bound and implementation is blocked.

Duplicate, expired, malformed, wrong-scope, wrong-device, stale-epoch, mismatched-commitment, unauthorized, or replayed messages fail closed. A lost connection leaves the new device pending and expiring. A conflicting retry requires a new nonce; a server response never activates a device.

## 4. Device-list authority and canonical model

### Authority decision

The chosen authority is an **active, locally verified existing device** using the existing authenticated `CryptoSession`. A new root key, server account, server-admin approval, silent device enrollment, multi-device threshold protocol, or permanent QR bearer is rejected for this phase. Multi-device or threshold approval can be considered only as a separately reviewed strengthening design.

### Canonical control object

The deterministic authenticated object is conceptually:

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

Records are sorted by canonical device ID. Unknown fields, duplicate IDs, invalid lifecycle transitions, non-canonical encodings, and invalid time windows are rejected. The canonical bytes exclude transport wrappers; the authenticated session covers all fields. A commitment is computed over canonical bytes and stored with the resulting list. Cross-platform encoding/fingerprint presentation must be finalized before coding.

### Versioning and verification

The format version is explicit and allow-listed. Unknown versions fail closed; no implicit downgrade or field reinterpretation is permitted. A receiver parses strictly, verifies the authenticated session and expected author identity, checks operation/nonce/sequence/time, checks prior epoch and commitment, claims replay state, atomically persists the next list, and only then exposes the membership result to adapters.

## 5. Epoch system

- The initial list starts at an explicit epoch and canonical commitment.
- Every accepted add, revoke, or recovery consumes exactly one next epoch.
- `nextEpoch` must equal `previousEpoch + 1`; gaps, rollback, reuse, and same-epoch divergence are invalid.
- The prior commitment binds each update to the locally accepted list.
- A stale device must reconcile the current list before sending/receiving sensitive new control traffic.
- Epoch advancement invalidates device-scoped authorization and future delivery for revoked devices; it does not rewrite existing Vodozemac sessions, message formats, attachment keys, or already decrypted endpoint data.

Impact by subsystem:

| Subsystem | Phase 6B effect |
| --- | --- |
| Vodozemac/CryptoSession | Frozen. Existing session establishment remains the cryptographic boundary. |
| Messaging/mailbox | Frozen formats and semantics. Adapters may gate new admission after epoch reconciliation; no automatic migration. |
| Calls | Existing authenticated signaling rejects stale/revoked device context; WebRTC cryptography is unchanged. |
| Attachments/media | Existing authorization adapters may require current membership epoch; ciphertext/key formats remain unchanged. |
| Verification | New device identities require explicit verification; epoch/device changes enter changed-pending-review. |

## 6. Revocation system

### Lost device flow

```text
User marks device lost on an active verified device
  ↓ explicit destructive confirmation
Canonical revoke control object
  ↓ authenticated + replay-claimed
Epoch advances and list persists
  ↓
Future sessions/delivery/calls for target are rejected
  ↓
Contacts receive minimum authenticated change notification
```

Revocation is immediate for the authoring device and eventually propagated to online peers. Offline peers must reconcile before sensitive operations; they cannot use a stale list to override a newer epoch. Revocation cannot recall plaintext already delivered to the endpoint.

Concurrent additions/revocations from one prior epoch do not merge automatically. A valid revocation for a device supersedes an uncommitted pending addition for that same device; divergent valid updates require a fresh ceremony and review. Contacts do not silently preserve verification across a device identity change.

## 7. Full device-loss recovery

Recovery authority is user-owned encrypted recovery material created locally before loss, or a still-active verified device. The server stores ciphertext and opaque version metadata only. A replacement device creates a fresh identity and completes a one-time, expiring recovery ceremony bound to user scope, recovery package, nonce, and known epoch.

Successful recovery creates a new epoch and marks prior devices `recovery-replaced`/`revoked` unless explicitly re-enrolled and re-verified. Contacts receive an identity-change event; prior verification is removed or placed in changed-pending-review. A malformed, substituted, stale, concurrent, or replayed package fails closed. If all devices and recovery material are lost, secure recovery may be impossible.

Rejected designs: server key escrow; support/admin identity reset; hidden recovery; silent identity replacement; plaintext recovery secrets; automatic inheritance of contact trust.

## 8. Offline distributed conflicts

Membership does not use last-writer-wins or silent merge.

- **Device addition:** accept only a valid next epoch with matching prior commitment, unique ID, valid enrollment nonce, and explicit verification. Concurrent adds from the same prior epoch conflict and require a new ceremony.
- **Revocation:** a valid next-epoch revocation supersedes an uncommitted pending add for the target device. Two divergent same-epoch revocations conflict unless they canonicalize to the identical resulting list.
- **Recovery:** a valid recovery replacement supersedes all prior uncommitted membership updates and invalidates prior authorities. Concurrent recovery attempts are rejected after the first atomic replay claim.

During conflict, clients retain ciphertext and show a security state but do not activate devices, send sensitive data, or alter contact trust. Durable shared atomic claims, TTL cleanup, and bounded storage are production requirements.

## 9. Existing-system compatibility

Frozen: Vodozemac, `CryptoSession` internals, identity key generation, mailbox protocol, encrypted message protocol/defaults, attachment encryption and key handling, media encryption, authenticated call-signaling cryptography, and legacy conversations.

Extended only through adapters: device-list persistence/validation, membership epoch checks, enrollment/revocation UX, verification state presentation, and session-admission gates. No adapter may expose private keys, raw vault state, message contents, or server-controlled trust. Existing conversations remain immutable and are never migrated automatically.

## 10. Server trust model

### Server may store or process

- opaque device IDs and public identity/fingerprint records;
- encrypted/authenticated control envelopes and encrypted metadata;
- routing, delivery, expiry, epoch, and bounded operational status;
- replay claims and durable list commitments required for availability.

### Server must never access or decide

- private identity/session/vault keys;
- plaintext recovery secrets, messages, media, attachment keys, or call content;
- user verification decisions or a server-minted trust bit;
- silent device activation, revocation override, or identity replacement.

The relay can drop, delay, duplicate, reorder, and correlate traffic. Those are availability/metadata threats, not authority.

## 11. Threat analysis

| Threat | Attack scenario | Protection | Remaining limitation |
| --- | --- | --- | --- |
| Malicious server | Forges a device list or activates a device | Session-bound canonical control, prior commitment, epoch checks, client-side verification | Server can suppress/delay updates and observe metadata |
| Compromised relay | Rewrites or replays enrollment/control envelopes | Existing authenticated session, canonical binding, nonce/sequence/TTL, replay store | Relay can deny service and correlate timing |
| Stolen device | Uses an unlocked or previously active device | Explicit revocation, epoch advancement, future-session/delivery rejection | Cannot erase plaintext already seen; revocation may await another authority |
| Malicious new device | Presents attacker identity during enrollment | Local fingerprint comparison, existing-device approval, pending state, explicit verification | Compromised approving device can authorize it |
| Replay | Reuses an old approval or recovery event | Nonce, sequence, expiry, prior epoch/commitment, atomic claim | Durable shared replay implementation is still a deployment gate |
| Rollback/split brain | Reintroduces an old list or divergent same-epoch update | Monotonic epoch and prior commitment; fail-closed conflict state | Availability suffers until an authority resolves conflict |
| Metadata leakage | Server infers device count, changes, timing, or availability | Minimize fields, bounded retention, encrypted content | Routing/timing metadata remains observable |

## 12. Implementation roadmap

### Phase 6B.1 — Local model and canonical validation

**Goal:** implement strict device records, lifecycle states, canonical serialization, commitments, epoch validation, and encrypted local persistence.

**Boundary:** no server trust; no changes to existing identity/session primitives.

**Tests:** canonical byte vectors across runtimes, unknown-field rejection, duplicate IDs, lifecycle transitions, epoch gaps/rollback, storage confidentiality, malformed inputs.

**Acceptance:** deterministic vectors agree across supported clients; invalid lists fail closed; existing Phase 1–5 tests remain unchanged.

### Phase 6B.2 — Enrollment, revocation, and conflict adapter

**Goal:** add the explicit two-device ceremony, authenticated control envelopes, replay claims, revocation, contact change notifications, and fail-closed offline conflict handling.

**Boundary:** only through existing authenticated modern `CryptoSession`; no raw signaling, permanent QR token, or server activation.

**Tests:** valid/invalid enrollment, tampered identity, replay/expiry, wrong epoch, concurrent add/revoke/recovery, lost connection, revoked-device admission, notification/reverification.

**Acceptance:** no device reaches `active` without local approval and persisted epoch; no conflict silently merges; legacy conversations remain unaffected.

### Phase 6B.3 — Session/admission integration and recovery

**Goal:** gate new modern sessions, attachment/call authorization, and device delivery on current membership; implement user-owned recovery replacement and operational persistence adapters.

**Boundary:** adapter-only integration; message, mailbox, attachment, media, and call cryptographic formats remain frozen.

**Tests:** restart/multi-instance atomic claims, stale/revoked devices, full-loss recovery, identity-change trust reset, cross-adapter epoch consistency, adversarial server/relay simulations, browser regression.

**Acceptance:** production storage/replay contracts are reviewed; recovery is explicit and observable; all stale or unauthorized paths fail closed; deployment runbooks and incident procedures exist.

### Phase 6B.4 — Independent security and deployment review

**Goal:** validate implementation against this specification in supported browsers and deployment topology.

**Boundary:** no feature expansion during review.

**Tests:** full unit/integration/adversarial suite, restart and failover, metadata/log inspection, key-material inspection, downgrade/replay tests, compatibility matrix.

**Acceptance:** independent review signs off canonical proofs, persistence atomicity, recovery, and frozen-boundary compliance. Only then may controlled rollout be considered.

## Final decision

**NO — Phase 6B is not ready for implementation.**

Remaining design gates are exact proof support in the existing identity/session APIs for every control delivery path; canonical cross-platform serialization and fingerprint presentation; full-loss recovery authority and incident handling; durable atomic shared list/replay persistence; offline conflict notification guarantees; and precise epoch enforcement at mailbox, attachment, and call adapters without changing frozen protocols. Until these are resolved and independently reviewed, no Phase 6B code, migration, feature flag, or protocol default change may begin.
