# K3ncrypt Phase 6 complete architecture specification

Status: consolidated architecture and security specification. This document is the source of truth for Phase 6 planning. It does not authorize implementation of unapproved phases and does not change Phase 1–5 code, cryptographic primitives, message formats, or protocol defaults.

## 1. Phase 6 objective

Phase 6 extends K3ncrypt from a secure single-device foundation toward deployable, multi-device privacy without moving trust to the server. It addresses production composition and validation, independently verifiable device membership, safe enrollment/revocation/recovery, and future platform/group extensibility.

The problems are: durable deployment boundaries, device loss and membership changes, stale-device authorization, cross-device identity verification, replay/rollback, and future mobile/group scaling. Historical encrypted conversations remain immutable; Phase 6 adds adapters and membership controls around the frozen core.

## 2. Security principles

- **No server trust authority:** the server relays opaque data and stores bounded metadata; it cannot approve a device or decide verification.
- **No private-key escrow:** identity keys, vault/session state, recovery secrets, message keys, attachment keys, and media keys remain client-owned.
- **No hidden approval:** enrollment, revocation, recovery, and identity changes require explicit authenticated ceremony and user-visible state.
- **Fail closed:** malformed, unauthenticated, stale, replayed, conflicting, or unverifiable state is rejected; availability is not purchased with silent trust.
- **Frozen cryptographic core:** Vodozemac, `CryptoSession` internals, message/mailbox semantics, attachment/media encryption, call cryptography, and legacy behavior are unchanged.
- **Minimal disclosure:** control envelopes contain only bounded public/operational data and remain encrypted through the existing authenticated session.

## 3. Multi-device architecture

```text
User local trust decisions
  ↓ owns
Independent device identities (one private identity per device)
  ↓ authorized through existing authenticated modern CryptoSession
Canonical DeviceList + SHA-256 commitment + monotonic epoch
  ↓ gates
DeviceAuthorizationVerifier → DeviceListUpdater
  ├─ new modern sessions / messaging admission
  ├─ attachment authorization
  └─ authenticated call admission
```

### Device identity

Each device independently generates the existing Vodozemac-backed `MessagingIdentity`. A device ID is an opaque identifier derived from public identity material, not a server account, socket ID, or bearer token. Private identity state remains in encrypted local storage/platform keystore.

### Device list and commitments

`DeviceList` contains version, user/identity scope, epoch, previous commitment, and sorted public device entries. Entries contain device ID, public identity reference, algorithm/version, lifecycle state, and bounded metadata. Canonical UTF-8 JSON has fixed field order, sorted device IDs, explicit integer/time rules, and rejects unknown fields. The list commitment is `SHA-256(canonical device-list bytes)`.

### Authority

An existing active, locally verified device authorizes membership mutations through the authenticated modern `CryptoSession`. A digest detects mutation but is not identity proof. No new root key, server trust bit, detached session-derived signing key, or administrator reset is permitted.

### Epochs

Every accepted add, revoke, or recovery update advances exactly one epoch and binds the previous commitment. Lower, skipped, reused, divergent same-epoch, or mismatched-commitment updates fail closed. Epoch checks gate new device authorization, new sessions, calls, and attachment operations; historical ciphertext and frozen formats are not rewritten.

## 4. Device enrollment

```text
New device B creates identity
  ↓ public enrollment request + nonce/expiry
Trusted verified device A compares fingerprint and approves
  ↓ existing authenticated CryptoSession control channel
EnrollmentAuthorization binds A, B, scope, nonce, sequence, epoch, commitment, expiry
  ↓ canonical verification + atomic replay claim
DeviceList N → N+1 and new commitment persist
  ↓ explicit verification and session bootstrap
B becomes active
```

The request is public-only and short-lived. A validates scope, purpose, identity, nonce, expiry, and current epoch, then creates an authorization object. Both devices verify the authenticated sender context, canonical digest, prior commitment, sequence, replay claim, and exact target identity. A server response or routing ID cannot activate B.

The control channel is a bounded versioned device-enrollment message carried by the existing `CryptoSession`; it is not raw transport, a message fallback, or call signaling. B receives its own public identity, the public device list/epoch, authorization status, peer public identities, and outputs of its own device-scoped session. B never receives another device's private key, session pickle, recovery secret, hidden trust state, or unrelated message/media key.

## 5. Device revocation

Revocation is an explicit destructive operation by an active verified device or approved recovery ceremony. The target becomes `revoked`, the epoch advances, and future device-scoped sessions, calls, attachment authorization, and new sensitive admission for that device fail closed.

For a lost or stolen device, the user revokes it from another active device or uses the separately reviewed recovery boundary. Online peers receive the minimum authenticated change event; offline peers must reconcile before sensitive operations. Revocation cannot erase plaintext already seen by an endpoint and cannot be retroactively applied to historical ciphertext.

Concurrent divergent updates do not use last-writer-wins. Same-epoch conflict requires a fresh authenticated ceremony. A stale device cannot override a newer epoch.

## 6. Recovery

Full device loss is a security event. Recovery authority is user-owned encrypted recovery material created locally or a still-active verified device. The server stores ciphertext/opaque version metadata only.

A replacement device creates a fresh identity, completes a one-time expiring recovery ceremony, advances the epoch, and marks prior devices `recovery-replaced`/revoked unless explicitly re-enrolled and re-verified. Contacts receive an identity-change event and must verify again; prior trust is never silently inherited. If all devices and recovery material are lost, secure recovery may be impossible.

Rejected designs include server key escrow, support/admin reset, hidden recovery, silent identity replacement, permanent QR bearer tokens, and plaintext recovery secrets.

## 7. Conflict handling

- **Rollback:** reject any candidate below the accepted epoch or with a broken previous-commitment chain.
- **Same epoch:** compare canonical commitments; divergent lists are conflicts and are not merged automatically.
- **Replay:** nonce, sequence, expiry, epoch, and author scope are claimed atomically; duplicates and expired transactions are rejected.
- **Offline state:** retain ciphertext and expose a security warning, but do not activate devices, alter trust, or send sensitive traffic while unresolved.
- **Persistence:** list, epoch, commitment, authorization claim, and operation status must commit atomically before new membership is exposed.

## 8. Server boundary

### Server may

- relay encrypted control/message/call envelopes;
- store opaque device IDs, public identity references, encrypted metadata, commitments, epochs, expiry, delivery status, and replay claims required for operation;
- provide bounded routing and availability APIs.

### Server may not

- create or approve trust;
- activate, revoke, or replace a device silently;
- access private keys, vault/session state, recovery secrets, message/media plaintext, or attachment keys;
- substitute a sender identity or decide verification;
- expose public media URLs or accept raw unauthenticated enrollment controls.

Relays can drop, delay, reorder, duplicate, and correlate traffic and timing. These remain availability/metadata risks.

## 9. Mobile preparation

Android and iOS clients must implement the same canonical encoding vectors, lifecycle/epoch state machine, and authenticated control boundary as the browser. Private identity/vault state must use platform-protected keystore/keychain facilities; plaintext keys must not enter logs, analytics, backups, clipboard, QR payloads, or ordinary preferences.

Mobile enrollment must require explicit foreground user confirmation, clear identity-change warnings, bounded QR/manual presentation, and lifecycle cleanup on background/termination. Offline queues must preserve nonce/epoch/replay rules. Push notifications may wake routing code but must not contain plaintext trust decisions, private keys, or bearer enrollment capability.

Mobile implementation is a client adapter, not a reason to alter Vodozemac, `CryptoSession`, mailbox, attachment, media, call, or legacy protocols.

## 10. Future compatibility

### Groups

Groups require a separately reviewed membership authority, sender-key or equivalent group-session design, membership epochs, removal semantics, fan-out limits, and metadata/DoS analysis. Existing one-to-one sessions and device-list rules cannot be silently reused as group trust.

### Group keys

Group key distribution must be client-controlled, authenticated to the current group membership, resistant to replay/removal, and independent of server trust. No group key escrow or server-selected membership is allowed.

### Group calls

Group calls add admission churn, media relay/SFU trust, participant removal, DTLS/signaling binding, and metadata leakage. They require a new threat model and browser/mobile matrix; no Phase 6 group-call behavior is implemented here.

## 11. Implementation roadmap

### Phase 6B.2 — Enrollment

**Objective:** implement the authenticated two-device request/approval ceremony and canonical N→N+1 list update.

**Dependencies:** Phase 6B.1 model, existing modern `CryptoSession`/identity context, canonical vectors, atomic replay/list adapter.

**Security tests:** wrong author/session, tampered identity/digest, expiry, replay, duplicate ID, stale/future epoch, same-epoch divergence, server-only activation, restart race.

**Acceptance:** B remains pending until explicit verification and atomic persistence; only active verified A can approve; no raw transport path exists; Phase 1–5 regression suite remains unchanged.

### Phase 6B.3 — Revocation

**Objective:** add explicit device removal, stale-device gates, and minimum authenticated contact change signaling.

**Dependencies:** enrollment list/epoch persistence, authorization context, durable replay claims.

**Security tests:** stolen/lost device, revoked session/call/attachment admission, offline reconciliation, notification suppression/replay, conflict resolution.

**Acceptance:** revoked devices cannot perform new sensitive operations; historical ciphertext remains unchanged; no server override or silent trust update.

### Phase 6B.4 — Recovery

**Objective:** implement user-owned full-loss replacement, fresh identity/epoch, old-device invalidation, and contact re-verification.

**Dependencies:** revocation, recovery package design, platform-protected local storage, incident/retry policy.

**Security tests:** substituted/replayed/stale recovery, concurrent recovery, all-material-lost path, prior trust reset, rollback, endpoint/key leakage.

**Acceptance:** no server escrow/reset; replacement identity is explicit; all prior devices are invalidated or deliberately re-verified; contacts see a mandatory identity change.

### Phase 6C — Groups and mobile

**Objective:** separately design and then implement platform adapters and group membership/calls only after one-to-one multi-device review.

**Dependencies:** 6B production evidence, mobile keystore/backup policy, group cryptographic protocol review, relay/SFU threat model.

**Security tests:** cross-platform vectors, device loss, group add/remove, key rotation, downgrade/replay, mobile lifecycle, relay metadata, browser matrix.

**Acceptance:** independent review approves new group/mobile trust assumptions; frozen Phase 1–5 protocols remain compatible; no feature ships on unreviewed server authority.

## 12. Threat model

| Threat | Attack | Protection | Remaining limitation |
| --- | --- | --- | --- |
| Malicious server | Forges list, activates fake device, or replaces identity | Client-side authority, authenticated `CryptoSession`, canonical commitment, epoch chain, explicit verification | Server can suppress/delay traffic and observe metadata |
| Stolen device | Uses unlocked or stale device after loss | Explicit revocation, epoch invalidation, stale admission rejection | Cannot erase plaintext already exposed; recovery may be unavailable |
| Fake enrollment | Attacker presents a public identity or intercepts QR | Existing-device approval, fingerprint comparison, pending state, authenticated authorization | Compromised active device can approve an attacker |
| Replay | Reuses old request/approval/recovery | Nonce, sequence, expiry, epoch/commitment, atomic replay claim | Durable shared replay store is a deployment requirement |
| Rollback | Reintroduces lower or divergent list | Monotonic epochs and previous commitments; fail-closed conflict | Availability loss during unresolved conflict |
| Identity impersonation | Routing ID or public record is treated as identity | Pinned verified contact mapping and session-bound author identity | Current runtime must expose this composed context correctly |
| Metadata leakage | Device count, timing, status, and routing are correlated | Minimized opaque metadata and bounded retention | Relay/server still observe operational metadata |

## Final implementation readiness

**NOT READY for full Phase 6 implementation.**

Exact blockers:

1. Runtime composition must expose and test the verified sender identity bound to each ready `CryptoSession`; routing IDs must remain non-authoritative.
2. The authenticated, bounded device-enrollment control channel must be implemented and tested in `ModernConversation` composition before trust-changing operations.
3. A production atomic claim-and-commit adapter must persist device list, epoch, commitment, authorization claim, and operation status across restart and multiple instances.
4. Cross-platform canonical enrollment/list vectors and same-epoch conflict tests must be published and pass.

Phase 6B.1 local validation may continue independently. Do not implement enrollment UI, revocation, recovery, mobile sync, groups, or protocol-default changes until these blockers are closed and separately reviewed.
