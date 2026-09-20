# K3ncrypt Phase 6B multi-device protocol design

Status: design only. This is a protocol proposal for review, not an implementation specification and not a change to the current message/mailbox protocol.

## Device identity model

Each device has an independently generated identity key and a device identifier derived from its public identity. A user identity is a locally presented grouping of verified devices; it is not a server account and does not replace existing `MessagingIdentity` or `ContactIdentity` primitives.

Each device record contains only public/operational data: device identifier, public identity/fingerprint, algorithm/version, creation/revocation state, device-list epoch, and bounded timestamps. Private identity keys, vault keys, session pickles, attachment keys, and recovery secrets stay in the device's encrypted storage or user-controlled recovery material.

The server may index opaque device identifiers and deliver encrypted control envelopes. It cannot decide that a device is trusted, sign a device list on behalf of a user, or derive a private key.

## Device enrollment flow

1. The new device creates its own identity locally and displays a short-lived enrollment commitment/fingerprint.
2. An already trusted device starts an enrollment transaction containing the new public identity, purpose, expiry, nonce, and current device-list epoch.
3. The user compares the new device through an explicit local ceremony (QR or equivalent out-of-band code). QR data contains public identity/commitment and expiry only; it contains no private key, vault secret, permanent bearer token, or attachment capability.
4. The trusted device authorizes the transaction through the existing authenticated modern session boundary. The new device remains unverified until the ceremony succeeds.
5. Both devices verify the canonical device-list update, advance the epoch monotonically, persist the update locally, and establish device-scoped sessions.
6. Contacts receive only the minimum encrypted identity-change/device-update information needed to require review. Existing conversation history is not silently rewritten.

Enrollment is one-time and expires. A server response or routing ID alone never completes enrollment.

## Device verification flow

Verification is explicit per device. A contact/user compares the device fingerprint or canonical public identity, confirms the intended device, and records a verified state bound to the device-list epoch. A verified primary device does not automatically verify a newly added device. Any key, algorithm, or epoch mismatch enters changed-pending-review and blocks sensitive continuation.

## Device revocation flow

1. A trusted device or approved recovery ceremony selects a device by public identifier.
2. The user confirms the destructive action and reason locally.
3. A revocation update advances the device-list epoch and records the device as revoked.
4. Future session establishment, mailbox delivery, attachment authorization, and call admission reject the revoked device.
5. Remaining devices persist the update and notify contacts when their view of the verified device set changes.

Revocation cannot erase historical evidence or retroactively make already decrypted endpoint data secret. Offline devices must reconcile epochs before sending or receiving sensitive traffic; conflicting updates fail closed pending review.

## Key and session lifecycle

- Device identity keys are generated independently and never copied between devices.
- Conversation/session state remains device-scoped; a server does not fan out private session material.
- Device-list epochs bind membership/control events and prevent stale device acceptance.
- New sessions are established through the existing reviewed CryptoSession/Vodozemac boundary; Phase 6B does not define new primitives.
- Revocation prevents future delivery and establishment; it does not promise deletion from a compromised device.
- Attachment and call authorization must use the current verified device/membership epoch when those features are extended.

## Recovery model

Recovery is user-controlled and intentionally conservative. A recovery package, if approved later, is encrypted and versioned locally before leaving the device. The server stores only ciphertext and opaque version metadata. Recovery requires an explicit ceremony, one-time authorization, expiry, rollback detection, and clear replacement/revocation of prior devices. If the user loses both trusted devices and recovery material, secure recovery may be impossible; availability must not be purchased by server-controlled identity reset.

## Server and relay visibility

The server may know opaque device identifiers, public identities, membership/epoch status, expiry, delivery status, and network/timing metadata necessary for routing and authorization. It may observe device count and update timing unless additional privacy measures are designed.

The server must never know private identity keys, vault/session keys, message/media plaintext, attachment keys, plaintext recovery secrets, or enough information to silently approve a new device. Relays forward encrypted control/message envelopes and can still drop, delay, reorder, and correlate metadata.

## Compatibility and frozen boundaries

Existing conversations remain immutable. No automatic migration, legacy fallback, protocol downgrade, message-format rewrite, mailbox semantic change, attachment-key redistribution, or call-crypto change is permitted. Phase 6B is an adapter/membership layer around the existing verified identity and session boundaries.

## Required protocol review questions

Before implementation, reviewers must decide canonical device-list encoding, conflict resolution, epoch authority, offline enrollment behavior, contact notification granularity, revocation delivery guarantees, recovery replacement semantics, device naming/privacy, and how existing two-party sessions react to device changes. Any answer that relies on a server-generated trust bit or permanent bearer QR token must be rejected.
