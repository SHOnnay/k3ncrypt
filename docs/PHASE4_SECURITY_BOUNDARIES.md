# Phase 4 security boundaries

This document freezes the Phase 3 security core while allowing later feature
work to proceed through explicit presentation and service extension points.
Phase 4 work must preserve the supported topology: one relay, persistent
MongoDB, browser clients, and modern Vodozemac 1-to-1 conversations.

## Frozen security core

The following components are security-critical and must not be modified as a
side effect of feature work:

- `service/src/identity/`: long-term identity, public bundles, contact
  identity tracking, and verification/change handling;
- `service/src/crypto/` and `service/src/core/`: Vodozemac session lifecycle,
  framing, replay handling, ratchet persistence, and the legacy/modern mode
  boundary;
- `service/src/storage/`: encrypted vault and persistence/key boundaries;
- `backend/db/` and `backend/socket.io/`: opaque offline mailbox, bounded
  storage, conditional claims, ACK deletion, TTL/uniqueness constraints, and
  relay authorization;
- `service/src/transports/` and backend transport listeners: opaque envelope
  routing, strict schemas, capability checks, and fail-closed behavior;
- verification state and fingerprints: TOFU pinning, explicit user review,
  identity-change invalidation, and no automatic trust carryover;
- protocol policy: existing persisted modes remain authoritative, and
  multi-instance deployment remains rejected.

Phase 4 must not change cryptographic primitives, Vodozemac bindings, key
hierarchy, encrypted-storage format, mailbox protocol, transport security,
protocol defaults, or legacy migration behavior.

## What Phase 4 features may use

New features may consume the existing service façade and explicit conversation
interfaces for authenticated, already-established modern sessions. UI code
may render status and invoke narrowly scoped service commands, but must not
hold private keys, pickles, vault keys, or identity secrets. New network
messages must be versioned, schema-validated, size-bounded, and carried as
opaque authenticated ciphertext through the existing transport boundary.

Feature state belongs in feature-specific service modules and client hooks or
components; it must not be added to the identity, ratchet, vault, or mailbox
implementations merely for convenience.

## Extension points (design only; not implemented)

### Encrypted attachments

Add a client-side attachment service under `service/src/attachments/` with a
UI adapter under `client/src/features/attachments/`. Encrypt bytes locally
with fresh per-object content keys before persistence or transport. Bind the
object identifier, conversation identity, chunk index, size, and digest as
authenticated metadata. The relay may store opaque encrypted chunks and
bounded metadata only; it must never receive plaintext, reusable keys,
thumbnails, or file paths. Attachment keys must be delivered through the
established modern session, not through a new ad-hoc key exchange.

### Voice messages

Keep capture/encoding and playback in a client feature module such as
`client/src/features/voice/`, with encryption delegated to a service boundary.
Microphone permission must be requested only after explicit user action.
Encoded audio must follow the attachment envelope rules and remain encrypted
before leaving the device. Do not add recording state to `ChatContext` or the
Vodozemac runtime.

### Call media

Keep call UI and lifecycle in `client/src/components/CallOverlay/` and a
future call feature service. Media permissions, WebRTC negotiation, and
ICE/STUN/TURN configuration remain separate from message cryptography.
Signaling continues through authenticated opaque envelopes; media endpoints
must not gain access to identity private material or vault keys. A future
implementation requires an explicit threat review for peer-IP and metadata
exposure.

### Local networking

Any LAN/site-to-site or peer-discovery work must live behind a new transport
adapter under `service/src/transports/` and an opt-in client feature. It must
not bypass capability authorization, envelope validation, session
serialization, verification state, or the single-relay production profile.
Discovery metadata and local addresses require a separate privacy review;
local transport is not automatically trusted merely because it is on a LAN.

## Permission and privacy rules

Request camera, microphone, filesystem, Bluetooth, local-network, or similar
permissions only at the moment a user explicitly starts the corresponding
feature. Do not add analytics, trackers, advertising, remote fonts, or remote
assets. Do not place secrets in localStorage, sessionStorage, URLs, logs,
telemetry, or DOM attributes. Feature errors must be generic and must not leak
keys, plaintext, pickles, or passphrases.

## Threat boundaries

The relay may observe routing, timing, sizes, connection state, and bounded
opaque mailbox metadata, but is not trusted with decryption keys. The model
does not protect a compromised unlocked endpoint, malicious OS/browser,
malicious code in the application origin, or first-contact authenticity before
manual verification. Phase 4 features must document any additional metadata,
permission, endpoint, or recovery exposure before implementation.

## Recommended future organization

- `client/src/features/<feature>/`: feature UI, hooks, and presentation state;
- `service/src/<feature>/`: feature orchestration and typed service boundary;
- `service/src/crypto/`: frozen message/session cryptography only;
- `service/src/storage/`: frozen vault/persistence primitives only;
- `service/src/transports/`: approved opaque transport adapters;
- `backend/api/` and `backend/socket.io/`: authenticated, schema-validated
  relay endpoints only;
- `docs/`: threat model, data-flow, permission, and operational reviews.

Every feature should add tests for plaintext exclusion, authorization,
replay/deduplication, lifecycle cleanup, permission timing, and failure
behavior before it is enabled in a production profile.
