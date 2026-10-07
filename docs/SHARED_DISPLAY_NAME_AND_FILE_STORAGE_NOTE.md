# Shared display names and larger files

## Shared display names

Contact nicknames are stored locally and are not shared. Invitations and join metadata do not currently contain an authenticated remote display name. `Contact · XXXX` is a temporary fallback label.

A future shared name may be an optional, bounded, signed/authenticated convenience field. It must not be part of the identity fingerprint or verification authority. A local nickname always overrides the claimed name; duplicate names are allowed. Name changes must not alter trust, and identity changes must still require explicit verification.

## File size

The beta file limit remains 8 MiB. Larger files need a storage-layout redesign first: encrypted chunks currently live embedded inside Mongo account documents, and MongoDB's BSON document-size limit makes a simple quota increase unsafe. The limit and chunk counts are unchanged here; no external blob store is introduced.
