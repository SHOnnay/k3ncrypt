# Identity model

Updated: 2026-09-17.

K3ncrypt keeps four concepts separate:

- `AppLocalIdentity` is a local application record that owns a messaging identity and creation metadata. It is not an online account.
- `MessagingIdentity` is the cryptographic device identity. The prototype uses a random vodozemac Olm `Account` containing public Ed25519 and Curve25519 identity keys plus private state retained in Rust/WASM and encrypted storage.
- `ContactIdentity` is a locally stored public identity for another device, with unknown/unverified/verified state and identity-change review state.
- `TransportPeer` is an ephemeral Socket.IO/relay routing UUID. It is never treated as a person, account, or cryptographic key.

`PersistentVodozemacIdentity` creates or loads an Account only through the crypto core. UI code receives the algorithm, canonical public-key bytes, and a stable fingerprint: SHA-256 over the versioned Curve25519 + Ed25519 public representation, formatted as grouped `K3 …` base64url text. No private-key accessor exists.

`ContactIdentityRegistry` stores contact identity records through `SecureStorage`. A changed key produces an `identity-changed` security event, timestamp, and pending public identity. It never silently replaces a known identity; in particular a verified identity stays current until an explicit `acceptPendingChange()`, after which verification resets to `unverified`.

Room IDs, Socket.IO IDs, user-entered names, email addresses, phone numbers, and unlock secrets are not messaging identities. The phase deliberately has no verification UI, QR scanner, recovery export, account directory, or server identity backup.
