# Encrypted attachment delivery security model

Phase 4 delivery is a storage-only layer over the Phase 4A encrypted
attachment foundation. It never decrypts media and does not create a public
URL or a second authentication protocol.

## Data flow

```text
local validation/encryption
  → initialize opaque upload
  → submit authenticated ciphertext chunks (resumable)
  → complete only when every bounded chunk exists
  → send attachment reference inside existing E2EE message
  → authorized recipient retrieves ciphertext
  → local integrity verification and decryption
```

The in-memory implementation in `service/src/attachments/delivery.ts` is a
contract/reference adapter for tests and future Mongo/object storage. It stores
only encrypted metadata, opaque IDs, ciphertext chunks, bounded size/count,
timestamps, expiry, and lifecycle status.

## Authorization and lifecycle

Each upload is initialized with an opaque participant access token; only its
SHA-256 digest is retained by the adapter. Every chunk, status, completion,
retrieval, and deletion operation requires that context. Unknown IDs, wrong
tokens, expired/deleted records, incomplete uploads, malformed chunks, and
conflicting duplicate chunks fail closed. Identical retries of an already
stored ciphertext chunk are idempotent. Expiry clears chunks and marks the
record unavailable.

This is not a public file URL. A future backend route must bind the access
context to an already authorized conversation participant and preserve the
existing relay authorization boundaries.

## Privacy and threat model

The storage operator may see opaque IDs, ciphertext size, chunk count, timing,
expiry, and delivery state. It must never receive plaintext bytes, attachment
keys, filenames, previews, thumbnails, EXIF data, user identity, or message
contents. The adapter does not log or interpret ciphertext. A compromised
unlocked endpoint/browser remains outside the protection model.

## Failure and operational limits

Uploads are bounded by the Phase 4A maximum size, chunk size, and chunk count.
Interrupted uploads can resume with the same ciphertext; re-encryption is not
required. Completion rejects missing chunks. Future durable adapters must add
atomic quota accounting, request rate limits, cleanup workers, and Mongo TTL/
uniqueness indexes without changing the mailbox or conversation protocol.

No cloud provider, CDN, public link, server-side decryption, transcoding, or
plaintext cache is part of this phase.
