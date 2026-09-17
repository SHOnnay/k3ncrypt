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
- `DefaultTransportManager` owns transport lifecycle, room routing, and opaque-envelope delivery. It does not create or reset crypto state.
- `SocketIoRelayTransport` contains all Socket.IO event and acknowledgement behavior.
- `CryptoSession`, `Transport`, `TransportManager`, `SecureStorage`, `PublicPreferences`, and `AttachmentStore` are protocol-facing ports.
- `MessagingIdentity`, `ContactIdentity`, `TransportPeer`, and `LegacyRoutingIdentity` prevent relay addresses from being presented as user identity.

`SecureStorage`, `PublicPreferences`, and `AttachmentStore` intentionally have no browser implementation yet. There is no current durable client state to migrate, and mapping secrets to localStorage would create false security. They are contract boundaries for the later encrypted database design.

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
- **MessagingIdentity**: future stable public cryptographic identity.
- **ContactIdentity**: a peer's public identity plus local verification status.
- **TransportPeer**: ephemeral network/routing address.
- **LegacyRoutingIdentity**: compatibility label for the current random per-page user ID.
- Room IDs and Socket.IO IDs are never identity IDs.

No identity key generation or verification is claimed in Phase 1.

## State and trust

The browser holds plaintext and current session keys in memory. The URL fragment carries the invitation secret. The relay sees addressing and traffic metadata but not authenticated envelope plaintext. The legacy static room key remains the largest cryptographic limitation.

WebRTC media uses browser DTLS-SRTP. Signaling uses the same `CryptoSession` boundary on the separate signaling channel. ICE servers and relay-only policy are injected configuration; the default server list is empty.
