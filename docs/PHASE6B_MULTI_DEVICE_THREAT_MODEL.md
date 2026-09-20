# K3ncrypt Phase 6B multi-device threat model

Status: design only. No multi-device enrollment, recovery, or protocol implementation is authorized by this document.

## Scope and security goals

The current model treats a verified contact identity and its active modern session as a one-device relationship. Phase 6B may add independently keyed devices for the same user, but must preserve explicit verification, fail-closed identity changes, encrypted local persistence, and immutable existing conversations.

Assets include device identity private material, public device records, verification decisions, session state, message/attachment keys, mailbox routing, revocation state, recovery material, and device metadata. The server may provide availability and durable metadata; it must not become an identity authority or key escrow.

## Threats

### Stolen primary device

- **Assets:** primary private identity, unlocked vault, device list, active sessions, recovery material.
- **Threat:** an attacker obtains the device or an unlocked profile.
- **Attack:** read plaintext/session state, enroll a device, approve a recovery, or impersonate the user to contacts.
- **Mitigation:** vault lock/lifecycle controls; explicit device revocation from another trusted device or recovery ceremony; no automatic trust transfer; contact-visible identity change; short-lived enrollment authorization; endpoint compromise disclosure.

### Maliciously added secondary device

- **Assets:** contact trust and future message access.
- **Threat:** an attacker persuades a primary device or server to add an unauthorized device.
- **Attack:** forge enrollment metadata, replay a QR/code, substitute a routing ID, or inherit the primary device's verification silently.
- **Mitigation:** per-device keys; authenticated user ceremony showing device identity/fingerprint; independent verification; one-time expiring enrollment transaction; monotonic device-list version; no inherited verified state; audit/revocation notification.

### Compromised secondary device

- **Assets:** messages delivered to the device, future group/device fan-out, contact privacy.
- **Threat:** a legitimately enrolled device becomes malware-controlled.
- **Attack:** exfiltrate plaintext or keys, send valid messages, suppress revocation, or keep receiving after removal.
- **Mitigation:** device-scoped sessions; explicit per-device revocation; future-message exclusion after a signed membership epoch; bounded offline queues; user-visible device inventory; no claim that device enrollment protects a compromised endpoint.

### Server attempts fake enrollment

- **Assets:** user identity continuity and contact verification.
- **Threat:** a malicious server/operator controls device-directory responses.
- **Attack:** invent a device, reorder/replay a device list, mark a device verified, or deliver an enrollment challenge to the wrong participant.
- **Mitigation:** server records are advisory; enrollment authorization is cryptographically bound to an existing trusted device/recovery ceremony; clients verify canonical device-list versions and identities; server cannot mint trust or private keys; downgrade and rollback fail closed.

### Relay compromise

- **Assets:** message confidentiality, enrollment/revocation privacy, availability.
- **Threat:** a relay can observe, delay, duplicate, drop, or reorder envelopes.
- **Attack:** replay enrollment events, suppress revocation, correlate devices, or exploit routing identifiers as identities.
- **Mitigation:** existing authenticated encrypted envelopes; sequence/expiry/replay checks; device-list epoch binding; opaque routing IDs; no plaintext enrollment secrets; fail closed on stale or conflicting state.

### Identity replacement or key change

- **Assets:** verified contact relationship and session continuity.
- **Threat:** a new key is presented as an existing trusted device.
- **Attack:** silently replace a device key, reuse a display name, or accept a changed fingerprint during reconnect.
- **Mitigation:** preserve old verification as historical evidence only; mark new device pending review; require explicit comparison/verification; block sensitive delivery until resolved; never automatically merge keys.

### Recovery abuse

- **Assets:** identity continuity, encrypted backup, device membership, recovery credentials.
- **Threat:** stolen recovery material or a malicious support/admin workflow.
- **Attack:** restore an old state, replace all devices, create a trusted device without user confirmation, or use server-held recovery secrets.
- **Mitigation:** user-controlled recovery secret; encrypted versioned backup; one-time/expiring recovery operation; rollback detection; explicit device-list replacement warning; revocation of prior devices; no plaintext recovery secret or server decryption key.

## Cross-cutting attacks and controls

- **Replay:** bind enrollment, list, revocation, and recovery events to a device-list epoch, sequence, expiry, and one-time transaction ID.
- **Downgrade:** existing conversations retain their persisted mode; device support must not make a modern session accept a legacy envelope.
- **Metadata leakage:** minimize device names, timestamps, IPs, and presence; do not expose a public device directory; document server/relay visibility.
- **Malicious contact:** a contact can read authorized messages and send abuse; membership and verification are distinct from contact goodwill.
- **Compromised endpoint:** decrypted content, screenshots, clipboard, notifications, and input remain endpoint risks outside protocol protection.

## Security decision

Do not implement enrollment or recovery until the protocol specifies canonical device-list state, user ceremony, revocation semantics, offline behavior, and rollback handling. A convenient server-side “add device” endpoint, copied private key, permanent QR token, or automatic trust inheritance is rejected as insecure.
