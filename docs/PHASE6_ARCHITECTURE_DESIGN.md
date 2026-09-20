# K3ncrypt Phase 6 architecture design

Status: design-only proposal. This document does not authorize implementation, change protocol defaults, or start Phase 6 development.

## Design inputs and current architecture

Phase 1–5 establishes a client-owned security model. The browser owns identity, Vodozemac sessions, verification state, plaintext, and local encrypted persistence. The server creates and authorizes room/control records, relays opaque envelopes, and exposes bounded operational APIs. Attachment services are deliberately not mounted until a real application-session verifier and durable access registry exist. Calls use authenticated control signaling over a modern conversation session; WebRTC remains an endpoint/media transport boundary.

```text
React UI / ChatContext
  ├─ modern conversation
  │    ├─ VodozemacRuntime + encrypted vault
  │    ├─ CryptoSession
  │    ├─ encrypted message/outbox envelopes
  │    └─ TransportManager → opaque relay envelopes
  ├─ encrypted media workflow
  │    └─ local attachment encryption → protected reference → delivery boundary
  └─ authenticated call composition
       ├─ CallService + authorization/state machine
       ├─ authenticated encrypted signaling
       └─ WebRTC peer/media transport
```

The server/relay can observe routing, timing, sizes, availability, and deployment metadata. It must not receive plaintext messages/media, identity private material, session keys, attachment keys, or decrypted signaling. A compromised endpoint remains outside the protection of client-side encryption.

## Proposed Phase 6 architecture

Phase 6 should be an extension layer around the frozen core, with explicit adapters rather than changes to cryptographic primitives.

```text
                         ┌──────────────────────────────┐
                         │ Phase 6 product surfaces      │
                         │ devices, groups, recovery,    │
                         │ mobile, operations            │
                         └──────────────┬───────────────┘
                                        │ reviewed contracts
  ┌─────────────────────────────────────▼─────────────────────────────────┐
  │ Existing secure conversation boundary                                  │
  │ verified identity → Vodozemac/CryptoSession → encrypted envelopes     │
  │ mailbox/relay → local encrypted persistence                            │
  └───────┬──────────────────────────────┬────────────────────────────────┘
          │                              │
  encrypted attachment/media       authenticated call signaling
          │                              │
  ┌───────▼────────┐             ┌───────▼────────┐
  │ reviewed storage│             │ reviewed WebRTC │
  │/auth adapters   │             │/relay adapters  │
  └───────┬────────┘             └───────┬────────┘
          └──────────────┬───────────────┘
                         ▼
                 deployment controls
          identity/session, storage, logs,
          rate limits, browser and CI evidence
```

No proposed feature may introduce a second identity system, plaintext server key escrow, public media URLs, a parallel message protocol, or a downgrade path to legacy sessions.

## Candidate Phase 6 directions

| Direction | Purpose | Security impact | Complexity/dependencies | Recommendation |
|---|---|---|---|---|
| Production deployment hardening | Make existing attachment/call paths operable safely | Adds server auth, durable authorization, replay and retention assumptions | High; requires deployment credentials, Mongo, relay/TURN, CI | First gate |
| Multi-device | Let one person use several verified devices | Expands identity, revocation, recovery, fan-out, and compromise scope | Very high; requires explicit device model and protocol review | Design before code |
| Advanced identity recovery | Recover from lost/changed devices without silent trust | High impact; recovery can become a key-substitution path | Very high; needs threat model, user ceremony, revocation | After device model |
| Group conversations | Support more than two participants | Changes membership, sender authentication, fan-out, ordering, and key management | Very high; current two-party session assumptions do not scale | Do not begin casually |
| Group calls | Multi-party media/signaling | Adds SFU/mesh trust, membership churn, media privacy and DoS risks | Very high; depends on group identity and relay review | Later |
| Mobile applications | Native clients and platform permissions | Adds keystore, backup, screen/notification, lifecycle, and supply-chain risks | High; no mobile project currently exists | Separate product track |
| Server scaling | Multi-instance relay/storage availability | Shared replay, ordering, authorization consistency, and metadata spread | High; requires production observability and failure tests | After deployment hardening |
| Backup/recovery | User-controlled recovery of encrypted state | Backup compromise and rollback/replay risks | High; must not become server key escrow | Research only initially |

The recommended order is deployment hardening first, then a narrowly specified multi-device/identity model, then group messaging only after an independent protocol review. Mobile, group calls, and generalized backups should not be coupled to the first Phase 6 implementation.

## Extension rules

Phase 6 may add:

- versioned application adapters around existing `CryptoSession` and identity interfaces;
- durable server authorization and operational stores that hold hashes, opaque identifiers, status, and timestamps only;
- new UI state and platform adapters that request permissions after explicit user actions;
- test-only fakes behind the same fail-closed interfaces.

Phase 6 must not modify:

- Vodozemac primitives or opaque session internals;
- message framing, mailbox semantics, attachment encryption, or legacy behavior as a shortcut;
- verification state by automatically trusting a new device/key;
- relay behavior to inspect or decrypt content;
- production defaults before migration, rollback, and downgrade tests pass.

## Architecture conclusions

The principal architectural constraint is identity scope: current contacts and sessions are effectively one verified peer/device at a time. Multi-device and group work cannot be achieved by reusing routing IDs or by copying private state. The first Phase 6 deliverable should therefore be deployment and identity-boundary design, not a feature UI or a new cryptographic implementation.
