# Production attachment delivery architecture

The attachment delivery boundary separates metadata from ciphertext storage.
`AttachmentDeliveryStore`, `AttachmentMetadataStore`, and
`CiphertextChunkStore` define the adapter contracts; the existing
`MemoryAttachmentDeliveryStore` is the deterministic reference adapter for
tests. A future production deployment can implement Mongo metadata plus an
opaque object store without changing attachment encryption or the E2EE message
protocol.

## API flow (design)

1. An authorized conversation context creates an upload and receives an opaque
   upload ID plus a one-time capability. Only the capability digest is stored.
2. `PUT` chunk requests validate the capability, attachment ID, chunk index,
   nonce, size, expiry, and duplicate consistency. Retries reuse ciphertext.
3. Completion succeeds only when every bounded chunk exists.
4. Download requests require the same authorized conversation context and a
   valid encrypted reference. They return ciphertext chunks only.
5. Delete and expiry clear chunk state. Cleanup workers must remove abandoned
   uploads and expired metadata.

No public URL is created. The existing relay authorization boundary must be
used when HTTP routes are added; a standalone bearer URL would be unsafe.

## Storage model

Allowed metadata is limited to opaque ID, encrypted metadata, chunk count and
size, timestamps, expiry, status, and delivery state. Ciphertext blobs are
stored separately from metadata. Forbidden fields include filename, path,
plaintext MIME, user identity, conversation contents, and encryption keys.
Mongo implementations should use unique attachment IDs, TTL expiry, bounded
chunk indexes, atomic completion/quota checks, and idempotent deletion.

## Threat model and visibility

The storage operator sees opaque IDs, ciphertext size/chunk count, timing,
expiry, and routing context. It cannot decrypt media or access keys, plaintext,
previews, thumbnails, EXIF, or filenames. A compromised unlocked endpoint or
application origin remains outside the model.

## Current limitation

This repository currently has no reviewed attachment HTTP authorization route
or object-storage dependency. The in-memory adapter and persistent adapter
interfaces are therefore complete without exposing an insecure half-integrated
endpoint. Adding routes requires binding requests to an authenticated
conversation participant, integrating Mongo/object storage atomically, and
testing restart/quota/rate-limit behavior before production enablement.
