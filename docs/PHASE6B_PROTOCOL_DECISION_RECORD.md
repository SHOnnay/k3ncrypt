# K3ncrypt Phase 6B protocol decision record

Status: design decision record only. These decisions do not authorize implementation or change the frozen Phase 1–5 protocols.

## 1. Device identity model

### Decision

- **User identity:** a local, user-visible grouping of independently verified device identities. It is not a server account and has no server-minted private key.
- **Device identity:** one independently generated public identity and its corresponding private key, owned by exactly one device. A device identifier is derived from the public identity and is not a routing/socket ID.
- **Device keys:** generated and persisted only inside the device's encrypted vault/platform keystore. Keys are never copied between devices, uploaded, or reconstructed by the server.
- **Device metadata:** opaque device identifier, public identity/fingerprint, algorithm/version, lifecycle state, device-list epoch, creation/revocation timestamps, and optional user-controlled display label. Labels and timestamps are metadata, not proof of trust.
- **Lifecycle states:** `pending-enrollment` → `pending-verification` → `active` → `revoked`; `recovery-replaced` is a terminal historical state. A device may not transition directly to `active` from a server response.

### Visibility and trust

Public: device identifier, public identity/fingerprint, lifecycle state, epoch, and bounded operational timestamps. Private: identity private key, vault/session keys, recovery material, plaintext, attachment keys, and call/message secrets.

The server may store and route opaque device records, epochs, status, and delivery metadata. It cannot decide that a device is trusted, mint a device identity, or derive private material. Trust is a client-side result of an authenticated ceremony and explicit verification.

### Security analysis

- **Threat prevented:** routing-ID substitution, server-created identities, and private-key escrow.
- **Tradeoff:** device count/status and update timing can leak metadata; users must manage a larger device inventory.
- **Remaining risk:** a compromised active device can use its own valid authority and expose content available to that endpoint.

## 2. Device enrollment ceremony

### Decision and exact flow

```text
Existing active verified device
  ↓ creates one-time enrollment transaction
New device generates its own identity locally
  ↓ displays short-lived public commitment/fingerprint
User compares both devices in an explicit ceremony
  ↓ existing device authorizes canonical transaction
New device remains pending until both sides verify the update
  ↓ device-list epoch advances and device-scoped session is established
Active device
```

1. The new device generates its identity and a random transaction nonce locally. It displays a canonical, human-comparable fingerprint/QR containing only public identity, nonce, purpose, current epoch, and expiry.
2. The existing active device obtains the new public identity through the local ceremony, not from an untrusted server assertion. It checks purpose, expiry, nonce, and the expected current device-list epoch.
3. The user confirms the matching fingerprints and intended device on both screens.
4. The existing device creates an approval control envelope bound to the canonical transaction, both device identities, the conversation/user scope, epoch, sequence, and expiry. The existing authenticated session provides the sender proof; no new key system or permanent bearer token is introduced.
5. The new device verifies the approval through the existing authenticated boundary, verifies the canonical device-list update, stores it encrypted, and acknowledges it. Both devices advance to the same epoch.
6. Only after both sides have persisted the update does the new device become `active`; otherwise it remains pending and expires.

### Replay and failure handling

Enrollment transactions are one-time, short-lived, epoch-bound, and replay-protected. Duplicate, expired, wrong-user, wrong-device, stale-epoch, malformed, or mismatched-commitment events fail closed. A lost connection leaves the device pending; retry requires the same transaction only while unexpired, and a conflicting retry requires a new nonce. No server response alone activates a device.

### Security analysis

- **Threat prevented:** QR interception, malicious server enrollment, replayed approval, device substitution, and silent trust inheritance.
- **Tradeoff:** enrollment requires two-device user interaction and can become unavailable when the existing device is lost.
- **Remaining risk:** the existing authenticated session is the sender-ownership boundary; a compromised active device can approve an attacker while unlocked. The exact proof format requires independent protocol review before implementation.

## 3. Device-list management

### Canonical format

The canonical list is a versioned, deterministic record containing: format version, user-scope identifier, monotonically increasing epoch, sorted device records, lifecycle states, update reason, previous-epoch commitment, and expiry/creation metadata. Device records are sorted by device identifier; unknown fields and duplicate identifiers are rejected. The canonical bytes exclude signatures before signing and are versioned for future migrations.

### Signing authority

The current decision is **not to introduce a new root key in Phase 6B**. Updates must be authorized by the currently active, explicitly verified device through the existing identity/session security boundary, with all affected device identities included in the canonical binding. A server-stored “verified” bit is never authoritative.

This is a design constraint, not proof that existing primitives already expose every required multi-device signing operation. If the current Vodozemac/identity boundary cannot provide an authenticated device-list approval without changing frozen primitives, implementation must stop and return to protocol design rather than inventing a parallel signing key.

### Epoch and conflicts

Epochs increase monotonically. A client accepts only the next valid epoch whose previous-epoch commitment matches its local state and whose authorization is valid. Same-epoch divergent lists, gaps, rollback, duplicate device identifiers, and unknown lifecycle transitions enter a conflict state and fail closed. There is no last-writer-wins merge for security-sensitive membership.

### Security analysis

- **Threat prevented:** server list forgery, rollback, split-brain membership, and stale-device acceptance.
- **Tradeoff:** conflicts may temporarily block delivery and require an active device or recovery ceremony.
- **Remaining risk:** a single active device is a practical authority bottleneck; a safe recovery authority and exact canonical authorization proof remain to be reviewed.

## 4. Revocation model

### Decision

Revoking a device is an explicit destructive action by an active verified device or approved recovery ceremony. The update marks the target device `revoked`, advances the epoch, commits a new previous-epoch binding, and invalidates future device-scoped sessions and delivery authorization for that device.

For a lost device, the user revokes it from another active device or uses the separately reviewed recovery ceremony. If neither exists, the system must prefer unavailable access over a server-admin reset. Revocation cannot erase plaintext already seen by the endpoint.

Contacts receive only the minimum authenticated identity/device-change signal needed to place their view in changed-pending-review. They do not receive private keys, recovery material, or a silent trust update. Sensitive messaging, attachment access, and call admission must fail closed when the local epoch/device status is stale or revoked.

### Security analysis

- **Threat prevented:** continued access by stolen/revoked devices, stale offline sessions, and hidden identity replacement.
- **Tradeoff:** offline revocation cannot instantly recall data already delivered; devices may be temporarily unable to communicate while reconciling epochs.
- **Remaining risk:** a compromised active device can delay or suppress revocation until another trusted authority is available; availability and notification guarantees require deployment testing.

## 5. Recovery model

### Decision

Recovery material is owned by the user, generated and encrypted locally, and stored only as ciphertext in a user-selected backup boundary. It is not a server account password, plaintext recovery code, or operator-held decryption key.

Recovery is a one-time, expiring replacement ceremony. The restored device generates a fresh identity, proves possession of recovery material and the recovery transaction, and creates a new device-list epoch. Prior devices are marked `recovery-replaced`/revoked unless the user explicitly retains and re-verifies them. Existing contacts see an identity/device change and must verify again; prior verification is never silently inherited.

Rollback, stale backup, malformed package, wrong user scope, concurrent recovery, and replay fail closed. If all active devices and recovery material are lost, secure recovery may be impossible. That is an accepted security tradeoff, not a reason to add server escrow.

### Explicitly rejected designs

- server-held private-key or vault-key escrow;
- silent recovery or support/admin identity reset;
- permanent QR bearer tokens;
- recovery that automatically preserves contact trust;
- plaintext recovery secrets in logs, URLs, notifications, or databases.

### Security analysis

- **Threat prevented:** server impersonation, recovery rollback, stolen backup substitution, and silent trust replacement.
- **Tradeoff:** users can permanently lose access without recovery material; replacement requires renewed verification.
- **Remaining risk:** recovery material is a high-value user secret and endpoint compromise can expose it; backup provider metadata and availability remain deployment concerns.

## 6. Implementation readiness decision

**Decision: Needs more design before implementation.**

The lifecycle, ceremony, epoch, revocation, and recovery policies are sufficiently explicit for a focused protocol review, but implementation must not begin until reviewers answer:

1. Whether the existing identity/session primitives can authenticate device-list approvals without a new signing/root-key mechanism.
2. How an active-device authority is recovered when all active devices are unavailable.
3. Exact canonical serialization and cross-platform fingerprint presentation.
4. Offline conflict and contact-notification behavior at scale.
5. Device-list epoch binding for mailbox, attachments, and calls without changing their frozen protocols.
6. Durable storage, audit, retry, and incident-response requirements for enrollment/revocation transactions.

Any implementation that cannot satisfy these questions without weakening privacy or frozen boundaries must be rejected or returned to design. No Phase 6B code, migration, default change, or Phase 6C work should start based solely on this record.
