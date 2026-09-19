# Media message integration

Media messages use the existing E2EE conversation as the control plane and the
authenticated attachment boundary as the ciphertext plane.

## Sender flow

1. The client validates the selected type and size locally.
2. The client encrypts bytes into bounded authenticated chunks; plaintext is
   never sent to the attachment service.
3. The authenticated attachment gateway creates an upload, accepts ciphertext
   chunks, and completes it.
4. The client sends a `k3ncrypt-media-v1` reference through the existing E2EE
   conversation. The attachment capability is carried only inside that
   protected message, never in a URL or unencrypted request.

## Receiver flow

1. The E2EE conversation delivers and authenticates the media reference.
2. The client requests ciphertext chunks through its authenticated conversation
   context and the capability contained in the protected reference.
3. The client verifies chunk ordering and AES-GCM authentication locally, then
   exposes bytes to the image/file/audio UI for display, playback, or export.

## Security boundaries

`MediaMessageWorkflow` only orchestrates existing attachment encryption,
delivery, and message serialization. It does not create keys, alter Vodozemac,
or bypass identity and verification. Attachment services store hashes of
capabilities and ciphertext/opaque metadata only; the server cannot decrypt
media.

## Privacy guarantees

No public URL, server thumbnail, EXIF processing, filesystem path, plaintext
filename, or permanent plaintext media storage is introduced. Microphone
capture remains the existing explicit, foreground-only recorder flow.

## Limitations

The repository still has no authenticated Express participant/session
middleware or HTTP attachment adapter. The workflow therefore accepts an
injected authenticated gateway; wiring that gateway into production routes is
blocked until the existing backend auth context is available. The UI must keep
media actions unavailable until that adapter is supplied rather than simulating
uploads locally.
