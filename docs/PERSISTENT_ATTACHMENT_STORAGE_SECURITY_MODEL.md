# Persistent attachment storage security model

`PersistentAttachmentDeliveryStore` separates lifecycle and authorization
invariants from durable persistence. A repository stores metadata and chunks;
the adapter never decrypts, compresses, previews, or interprets ciphertext.

## Storage architecture

- Metadata repository: opaque attachment ID, encrypted metadata bytes, bounded
  size/chunk count, status, timestamps, and a hash-only capability verifier.
- Chunk repository: attachment ID, index/total, nonce/authenticated ciphertext,
  and storage timestamp.
- `MongoAttachmentPersistence` supplies Mongo collections, unique indexes on
  attachment IDs and `(attachmentId, index)`, and expiry/status indexes.

Plaintext filename, MIME, previews, message content, identity material, and
encryption keys are not part of either persistence type.

## Lifecycle and recovery

Uploads are resumable because metadata and chunks are independent durable
records. Recreating the adapter against the same repositories preserves an
in-progress or completed upload. Duplicate chunks are idempotent only when
their nonce, ciphertext, and total match; conflicting duplicates fail.
Completion requires every expected chunk. Expiry marks metadata unavailable
and removes its chunks; the cleanup job can call `expireAttachments()` on a
schedule. Mongo indexes provide uniqueness and efficient expiry scans; cleanup
is explicit so metadata and ciphertext are removed together.

## Database visibility and threat model

The storage operator can see opaque IDs, ciphertext, encrypted metadata bytes,
sizes, indexes, timestamps, status, and a capability hash. It cannot decrypt
media or recover keys from storage. Access checks remain generic and
constant-time at the adapter boundary, while the authenticated conversation
layer remains responsible for participant authorization.

A compromised server or unlocked endpoint remains outside the confidentiality
guarantee. Mongo transactions, backups, retention, and operational scheduling
must be configured by deployment owners; no cloud provider or public URL is
introduced here.
