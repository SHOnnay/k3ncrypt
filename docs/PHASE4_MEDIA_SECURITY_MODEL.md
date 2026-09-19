# Phase 4 media security model

Phase 4 media features are client-side extensions over the frozen Phase 3
security core. Media is never sent as plaintext to the relay.

## Architecture

User action → local validation/processing → Phase 4A encrypted attachment →
existing E2EE message reference → opaque ciphertext delivery → recipient-local
integrity verification/decryption.

Voice uses the explicit microphone lifecycle in `service/src/voice/`. Images,
videos, and files use the bounded preparation contracts in
`service/src/media/`. No feature introduces a second cryptosystem.

## Permission model

Microphone and camera access is requested only after an explicit call/record
action. Tracks are released immediately when recording/calling ends or is
cancelled. There is no background capture, startup permission request, or
permission for unrelated devices. Permission lifecycle is represented by
`MediaPermissionTracker` and must remain observable to future UI.

## Server visibility and trust boundaries

The relay/storage layer may see opaque IDs, encrypted chunks, bounded size,
timestamps, expiry, and routing metadata. It must not receive plaintext media,
keys, previews, thumbnails, filenames, local paths, device names, location, or
public media URLs. Media keys are intended to travel only inside an existing
encrypted conversation message.

## Media-specific protections

- MIME type and size limits are checked before encryption.
- Attachment AES-GCM provides authenticated chunks and corruption detection.
- Chunk ordering, missing chunks, duplicate chunks, and expiry fail safely.
- Browser `File` preparation consumes bytes and MIME type only; filesystem paths
  and original names are not part of the service contract.
- No external cloud provider, CDN, transcription, analytics, or server-side
  transcoding is used.

## Calls

Existing WebRTC signaling remains subject to the frozen transport and identity
boundaries. Future audio/video call UX must request permissions only at call
start, release tracks on termination, and document STUN/TURN, peer-IP, timing,
and connection metadata exposure. Calls are not re-encrypted with attachment
crypto.

## Limitations and future work

This phase adds service foundations and permission tracking, not a polished
media UI, durable object-storage adapter, resumable upload protocol, preview
pipeline, playback gallery, or public sharing links. Any such work requires
separate threat review and must preserve the Phase 3 security boundaries and
legacy/modern protocol behavior.
