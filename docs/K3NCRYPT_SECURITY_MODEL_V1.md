# K3ncrypt Security Model v1

## Scope and supported deployment

K3ncrypt supports private 1-to-1 conversations using browser clients, one
relay/backend instance, persistent MongoDB, and modern Vodozemac sessions.
Multi-instance relay deployment remains unsupported and is rejected by the
production configuration gate.

## Threat model

K3ncrypt is designed to protect message content, session keys, identity
private material, the local encrypted vault, and encrypted offline ciphertext
from the relay and transport path.

The model does not protect against a compromised unlocked device, malicious
operating system or browser, code executing in the application origin, relay
metadata exposure, network metadata, or first-contact authenticity before the
users manually verify fingerprints.

## Architecture summary

```text
Identity
  ↓
Bundle publication
  ↓
TOFU verification
  ↓
Vodozemac session
  ↓
Encrypted persistence
  ↓
Encrypted outbox
  ↓
Opaque mailbox
  ↓
Recipient decrypt/persist
  ↓
ACK deletion
```

Long-term identity and session state remain client-side in the encrypted local
vault. The relay receives public bundle material and opaque envelopes only.

## Server trust model

The server can route encrypted messages, store ciphertext temporarily, and see
limited routing, mailbox, size, timing, connection, and delivery metadata.

The server cannot decrypt conversations or access private identity keys,
session keys, account pickles, or local storage keys.

K3ncrypt is designed so that the relay does not possess the keys required to
decrypt user conversations.

## Security guarantees and delivery properties

- Modern sessions reject malformed, replayed, duplicate, or downgraded input.
- One-time pre-keys are claimed conditionally and are not intentionally
  reusable.
- Offline delivery is bounded, opaque, at-least-once at the transport layer,
  and deduplicated before user-visible plaintext is accepted.
- Recipient state is persisted before ACK; ACK deletion is idempotent.
- Identity changes invalidate trust and require explicit user handling.
- Unsupported multi-instance and unsafe production configurations fail closed.

These are design properties and validation targets, not a claim of perfect or
absolute security.

## Known limitations

- Relay and network metadata are visible to the service and its infrastructure.
- A compromised unlocked endpoint, browser, operating system, or application
  origin can expose plaintext and local keys.
- First-contact identity authenticity requires manual fingerprint verification.
- Multi-instance Socket.IO routing is unsupported.
- Recovery from endpoint loss is intentionally limited; the relay is not a
  recovery service for private identity material.
- Media/call, group, multi-device, Tor, and LAN/site-to-site profiles are out
  of scope for this model.

## Validation status

The supported service/unit invariants, Rust crypto tests, and Chromium baseline
pass. Mongo index initialization and persistence were exercised with the
Compose Mongo service. Full relay/Mongo crash-delivery, real concurrency and
failure-injection evidence, Firefox compatibility, and the WebKit modern
storage flow remain required before considering modern-default for new
conversations. Existing persisted conversation modes remain authoritative.
