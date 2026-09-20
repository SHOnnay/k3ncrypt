# Phase 6B.1 device identity foundation

Status: implemented local foundation only. This milestone does not implement enrollment UI, recovery, notifications, mobile synchronization, revocation propagation, session migration, or production deployment.

## Architecture

`service/src/devices/` is an isolated public-only model layer:

```text
DeviceEntry (public identity reference + lifecycle metadata)
        ↓ validates/immutably snapshots
DeviceList (identity scope + epoch + previous commitment + entries)
        ↓ canonical UTF-8 representation
SHA-256 commitment and epoch validation utilities
```

The module is exported as a typed SDK boundary but is not wired into messaging, calls, attachments, mailbox delivery, or storage. It contains no private key, Vodozemac handle, CryptoSession, plaintext, or server authority.

## Implemented scope

- Public device entries with `pending`, `active`, and `revoked` lifecycle states.
- Strict device-list version, identity scope, epoch, previous-commitment, and duplicate-ID validation.
- Deep-frozen device and list snapshots so historical objects cannot be mutated in place.
- Deterministic compact canonical JSON with fixed field order and device-ID sorting.
- SHA-256 commitment calculation and commitment verification through WebCrypto.
- Monotonic epoch comparison, next-epoch validation, rollback rejection, and stale-epoch detection.
- Explicit lifecycle transition checks and rejection of revoked devices as authorities.
- Test vectors covering deterministic encoding, commitment changes, malformed fields, duplicate IDs, lifecycle transitions, rollback, stale epochs, and revoked authorization.

## Security boundaries

The existing `MessagingIdentity`, Vodozemac, `CryptoSession`, encrypted vault, message protocol, mailbox, attachment/media encryption, call security, and legacy behavior remain unchanged. The new module treats identity material as an opaque public reference; it never stores or derives a private key. A SHA-256 commitment detects mutation but is not an identity proof. Device-list authorization remains the existing authenticated `CryptoSession` boundary defined by the Phase 6B authority specification.

Malformed objects, unsupported versions, duplicate identifiers, invalid lifecycle transitions, rollback, stale epochs, and non-active authorities fail closed. No server response can activate a device in this milestone.

## Future work (not implemented)

- Phase 6B.2 enrollment ceremony and authenticated control-message integration.
- Revocation propagation, contact notifications, and offline conflict handling.
- Full-device-loss recovery and identity replacement.
- Epoch gates at new sessions, calls, attachments, and other adapters.
- Durable shared replay/list persistence and deployment review.
- Cross-platform/browser canonical-vector publication beyond the local test vector.
