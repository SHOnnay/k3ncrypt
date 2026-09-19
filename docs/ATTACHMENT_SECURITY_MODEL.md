# Encrypted attachment security model

Phase 4A adds only a client/service foundation. It does not add an attachment
UI, cloud storage, previews, compression, media playback, or a relay endpoint.
The existing Vodozemac, identity, vault, mailbox, transport, and protocol
selection boundaries remain unchanged.

## Encryption flow

1. The client generates a fresh 256-bit attachment key locally.
2. The file is split into bounded chunks (currently 256 KiB, with bounded
   total size and chunk count).
3. Each chunk is encrypted locally with AES-GCM using a fresh 96-bit nonce and
   authenticated chunk identity/index data.
4. Metadata is encrypted separately with AES-GCM and contains only size,
   chunk count, creation time, and expiry.
5. A future attachment reference and its key are sent inside the existing
   encrypted conversation message. The attachment subsystem does not perform
   message encryption or key exchange.
6. Download reorders and validates chunks, verifies authentication and size,
   then decrypts locally. Corruption, missing chunks, wrong keys, expiry, and
   malformed ordering fail closed.

AES-GCM is provided by the platform Web Crypto API; no custom cryptographic
primitive is introduced. Nonces are never reused within an attachment, and
additional authenticated data binds the attachment ID and chunk position.

## Trust boundaries and server visibility

The future storage adapter may receive only opaque attachment IDs, encrypted
chunks, encrypted metadata, bounded timestamps/expiry, and routing data needed
for delivery. It must never receive plaintext bytes, previews, thumbnails,
filenames, local paths, attachment keys, passphrases, or identity/session
material. The current Phase 4A storage implementation is in-memory only and
exists for tests; Mongo/object storage integration is a later reviewed step.

Sensitive temporary state must not use localStorage or sessionStorage. Any
future browser cache must use an encrypted storage boundary and explicit
expiry/deletion behavior.

## Limits and lifecycle

The foundation bounds total attachment size, chunk size, chunk count, and
retention time. Upload creation, unique chunk insertion, finalization,
retrieval, deletion, and expiry are represented by `AttachmentStorage`.
Implementations must make duplicate uploads, malformed chunks, unbounded
growth, and partial finalization safe and observable without logging secrets.

## Threat model

Attachments are protected from relay decryption and transport observers when
the existing modern conversation is correctly established. A compromised
unlocked endpoint, malicious browser/OS, malicious application-origin code,
or a user who shares the attachment key is outside this protection. Size,
timing, routing, and expiry metadata may remain visible to the storage
operator. Filenames and previews are intentionally excluded from the current
model.

## Extension points

The service foundation lives under `service/src/attachments/` and exposes
contracts, encryption/chunk validation, lifecycle storage, and a memory adapter.
Future encrypted attachment uploads can add an authenticated API adapter;
voice notes, call media, and local-network delivery must remain separate
feature modules and must not modify the frozen Vodozemac/session/vault/mailbox
implementations.
