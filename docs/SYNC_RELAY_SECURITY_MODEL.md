# Dedicated authenticated sync relay

## Why a separate path

The approved sync profile uses 32 KiB logical chunks. Base64 encoding, the sync
header and the existing Olm envelope exceed the original relay's 32 KiB payload
limit. Raising that limit globally would also expand messaging/call abuse and
mailbox boundaries. Instead, startup mounts an independent Socket.IO/Engine.IO
server at `/sync/socket.io`.

| Boundary | Limit / behavior |
| --- | --- |
| Original `/socket.io` | Unchanged 64 KiB Engine.IO packet limit |
| Existing messages and call signaling | Unchanged 32 KiB application payload limit |
| Existing mailbox | Unchanged quotas, retention and protocol; no sync mailbox added |
| New sync serialized encrypted envelope | At most 192 KiB, UTF-8 JSON bytes inclusive of envelope fields |
| New sync Engine.IO packet | 192 KiB + 1 KiB bounded transport-wrapper allowance |
| Existing decoded sync frame | At most 64 KiB; accommodates a 32 KiB base64-encoded logical chunk and header |

This change does not introduce a new encryption channel or primitive. Sync still
uses the existing authenticated CryptoSession signaling channel and dedicated
sync plaintext prefix, but **never sends its envelopes through `webrtc-signal`**.
The larger Engine.IO limit is isolated even at the transport layer. The separate
server runs on the existing HTTP listener; deployment must route its path over
the same authenticated TLS origin. No new port, public file URL or provider is
required.

## Authentication and trust

```text
ModernConversation's verified same-account peer + ready session
  -> DeviceTrustEnforcer / exact epoch + canonical commitment / active identities
  -> AuthenticatedSyncTransport -> existing persistent CryptoSession facade
  -> SocketSyncRelay -> /sync/socket.io (opaque ciphertext only)
  -> receiver's authenticated sync transport + current device trust
  -> RuntimeSyncController -> existing durable transaction + replay claim
  -> receiver acknowledgment -> source relay acknowledgment
```

The server authenticates **room access** using the existing control-capability
verifier and validates room lifetime on admission and sends. It binds an opaque
routing ID to a connection, rejects duplicate routes, limits a room to two routes
(the existing pairwise room model), and only sends to the exact specified peer
in that room. It applies bounded rate/in-flight limits and generic errors.
The capability travels in Socket.IO authentication data, not a URL. No new
authentication keys/accounts are created.

**Room access and routing are not device identity proof.** The relay validates
the modern envelope's shape/size but cannot verify its AEAD tag, epoch or hidden
sender. Those are endpoint checks; claiming otherwise would require giving the
server trust or encryption keys. A malicious room member may submit fabricated
ciphertext, but it cannot manufacture an accepted sync operation on another
device. The relay neither creates membership nor vouches for an epoch.

At the endpoint:

- ModernConversation requires a verified unchanged contact, active same-account
  membership, the live session binding, and a durable sync controller before
  opening the relay. It rechecks local trust and peer verification on traffic.
- AuthenticatedSyncTransport pins sender/receiver identities to that session,
  validates scope, stable device IDs, purpose and positive sequence, verifies the
  canonical list commitment at the exact epoch, and checks both memberships.
- Only transport-issued, single-consumption frames reach the controller. Replay
  claims/progress remain inside the existing persistence transaction; the relay
  does not replace them with a process-local replay cache.
- The receiver acknowledges only after the controller's durable acceptance
  resolves. This is **transport/controller acceptance**, not a new claim of
  application-record import or completed synchronization.
- A rejected frame, unavailable peer, timeout, changed identity or revoked/stale
  trust returns failure. No plaintext, old transport or legacy fallback exists.

## Lifecycle and limitations

Relay connections close with ModernConversation and on identity replacement.
Automatic reconnection and automatic retransmission are disabled. A connection
loss does not grant new admission or clear replay claims; the caller must use
the existing reauthorization/recovery boundary. The server stores no offline
sync queue. Lost acknowledgments may require reconciliation; this patch does
not invent a retry/receipt protocol.

The relay observes room relationships, routing IDs, sizes and timing. Endpoint
compromise and dishonest recipient acknowledgments remain outside its guarantee.
The broader account bootstrap, all-member freshness/admission, conflict handling,
complete record import and production SyncPersistence integration remain the
separate Phase 6 closure work. This transport patch does not mark them complete.

## Tests and validation

- Real local Socket.IO servers run the original and sync paths simultaneously.
  Original messaging and call payloads above 32 KiB are still rejected; an 80 KiB
  opaque sync envelope is delivered only to its selected peer.
- Wrong recipient, lost room authorization, malformed/legacy envelope and
  oversized sync input reject. Exact 192 KiB envelope boundary is tested.
- Endpoint tests use real lifecycle state, DeviceTrustEnforcer, encrypted vault
  and CAS transactions. They accept a frame containing a 32 KiB logical chunk
  and reject wrong recipient, stale epoch, invalid sequence and replay after
  vault restart. CryptoSession decryption is a fixture in that test; it is not
  evidence of a new cryptographic implementation. Existing crypto tests remain.
- Full Jest: 76 suites / 369 tests pass; one Mongo integration test is skipped
  because `MONGO_URI` is not configured.
- Service/client TypeScript, ESLint, client production build and
  `git diff --check` pass. Full npm audit reports zero vulnerabilities.
- No changes to existing relay handlers/limits, mailbox code, Vodozemac or
  CryptoSession algorithms, attachment/media crypto, or privacy capture code.

Files: `backend/sync/relay.ts`, its integration test, startup `index.ts`,
`service/src/sync/relay.ts`, authenticated sync transport and tests,
`service/src/crypto/modernConversation.ts`, and this document.
