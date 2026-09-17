# K3ncrypt architecture

## Runtime dependency direction

```text
React UI
  -> ChatContext (application state)
    -> ChatE2EE conversation facade
      -> CryptoSession
        -> EncryptedEnvelope
      -> TransportManager
        -> Transport
          -> SocketIoRelayTransport
```

The relay transport receives only `EncryptedEnvelope` objects. It never receives plaintext, invitation secrets, derived keys, or a cryptographic session. Incoming Socket.IO messages are acknowledged only after the application callback has authenticated, decoded, protocol-validated, and replay-checked the envelope.

## Implemented boundaries

- `LegacyInviteCryptoSession` preserves the existing invite secret, HKDF-SHA-256 domain separation, and AES-256-GCM wire format. Its name deliberately records that it has no forward secrecy or post-compromise recovery.
- `VodozemacCryptoSession` is an isolated, explicit version-2 Olm adapter backed by the Rust/WASM handle; it is test/development only and not selected by the production facade.
- `DefaultTransportManager` owns transport lifecycle, room routing, and opaque-envelope delivery. It does not create or reset crypto state.
- `SocketIoRelayTransport` contains all Socket.IO event and acknowledgement behavior.
- `CryptoSession`, `Transport`, `TransportManager`, `SecureStorage`, `PublicPreferences`, and `AttachmentStore` are protocol-facing ports.
- `MessagingIdentity`, `ContactIdentity`, `TransportPeer`, and `LegacyRoutingIdentity` prevent relay addresses from being presented as user identity.

`BrowserSecureStorage` and `IndexedDbVaultPersistence` now implement the secret-storage boundary with Argon2id, a wrapped random SMK, HKDF-separated keys, and per-record AES-GCM. `IndexedDbPublicPreferences` remains a separate plaintext port. `AttachmentStore` is still only a future boundary.

## Envelope acceptance

For chat, acceptance is:

1. receive an opaque envelope from the active transport;
2. verify version/strategy and authenticate AES-GCM;
3. decode a valid JSON protocol payload;
4. check the sequence number against a bounded replay window;
5. publish the plaintext event;
6. resolve acceptance and emit the transport delivery acknowledgement.

The replay window records accepted sequence numbers within the latest 1,024 positions. It accepts `1, 3, 2`, rejects a duplicate `2`, and rejects numbers older than the bounded window.

## Identity model

- **AppLocalIdentity**: device-local record that owns a messaging identity without becoming a server account.
- **MessagingIdentity**: stable vodozemac public device identity persisted through encrypted Account state.
- **ContactIdentity**: a peer's public identity plus local verification and change-review status.
- **TransportPeer**: ephemeral network/routing address.
- **LegacyRoutingIdentity**: compatibility label for the current random per-page user ID.
- Room IDs and Socket.IO IDs are never identity IDs.

The Phase 2 crypto core generates identities and detects changes; final verification UI is not implemented.

## State and trust

The browser holds plaintext and current session keys in memory. The URL fragment carries the invitation secret. The relay sees addressing and traffic metadata but not authenticated envelope plaintext. The legacy static room key remains the largest cryptographic limitation.

WebRTC media uses browser DTLS-SRTP. Signaling uses the same `CryptoSession` boundary on the separate signaling channel. ICE servers and relay-only policy are injected configuration; the default server list is empty.
