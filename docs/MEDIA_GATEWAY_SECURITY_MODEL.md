# Production media gateway security model

The media gateway is a transport bridge only:

```text
Media UI -> MediaMessageWorkflow -> HttpAttachmentGateway
         -> authenticated route -> AuthenticatedAttachmentService
         -> AttachmentService -> PersistentAttachmentDeliveryStore -> Mongo
```

## API flow

The route factory exposes create, chunk, complete, retrieve, and delete
operations. Every request first asks an injected session verifier for an
`AuthenticatedContext`; the authorization service then checks expiry,
conversation membership, permission, attachment scope, and capability before
the attachment service runs. Missing or invalid state returns only
`Attachment unavailable`.

Chunks travel as bounded `application/octet-stream` bodies with nonce/index
headers. Retrieval returns nonce and ciphertext as opaque base64url values.
The HTTP client never persists session headers, capabilities, or attachment
references outside the active workflow/message path.

## Storage and privacy boundary

Mongo receives encrypted metadata, ciphertext, opaque IDs, timestamps, status,
and hash-only capability verifiers. It never receives media keys, plaintext
media, filenames, previews, EXIF, or public URLs. The client decrypts only
after local integrity verification.

## Limitations

The route factory deliberately requires deployment-provided authentication and
authorization dependencies; it is not mounted with mock authentication. A
production host must compose it with its real session verifier and persistent
Mongo adapter before enabling live media delivery. Until then, the client
reports protected media as temporarily unavailable instead of claiming success.
