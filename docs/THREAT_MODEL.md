# Threat model

Updated: 2026-09-17.

## Protected assets and adversaries

K3ncrypt protects message plaintext, invitation/message secrets, room-control capabilities, local messaging private state, Olm sessions, contact verification, and storage keys. Attackers are assumed to know the source/protocol and may copy browser storage, guess room IDs, send hostile protocol data, replay transport packets, or later compromise the relay.

Current controls include client-side authenticated message encryption, independent 256-bit room-control capabilities, strict/bounded relay schemas, authenticated acknowledgements, replay handling, encrypted local records, an Argon2id-protected random SMK, and isolated high-level vodozemac handles.

## Trust boundaries

The UI receives plaintext only after crypto authentication. `CryptoSession` separates application logic from legacy/vodozemac formats. `TransportManager` sees only opaque envelopes and routing IDs. The relay can route but receives no message or local-storage key. `PublicPreferences` must never receive secrets. `SecureStorage` is the only persistence path for identity/session/capability/contact secret state.

## Explicitly out of scope or incomplete

- XSS/malicious JavaScript while unlocked, compromised browser extensions, OS compromise, and live-memory capture;
- traffic-analysis metadata at the relay;
- recipient endpoint compromise, screenshots, or copied plaintext;
- denial of service and globally distributed rate limiting;
- vodozemac pre-key directory authentication and production session negotiation;
- recovery, identity export, cloud backup, password reset, groups/MLS, Tor/LAN/Bluetooth/Wi-Fi Direct, and attachments;
- hardware-backed browser keys. Android Keystore work is future and is not represented by this browser design.

There is no biometric, camera, microphone expansion, location, contacts, Bluetooth, or QR-camera integration in Phase 2.
