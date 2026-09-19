# Voice message security model

Phase 4B provides a service foundation only. It does not add recording UI,
voice calls, playback UI, transcription, cloud storage, public links, or
analytics.

## Architecture and data flow

```text
explicit record action
  → microphone permission
  → local MediaRecorder (WebM/Opus)
  → local validation
  → Phase 4A encrypted attachment chunks
  → existing E2EE message carries opaque reference/key
  → recipient downloads ciphertext
  → local integrity verification and decryption
  → future playback UI
```

Voice code lives under `service/src/voice/` and uses the attachment subsystem;
it does not modify message crypto, identity, storage, mailbox, or transport.

## Permission model

`BrowserVoiceRecorder` does not access a microphone during construction,
startup, import, or initialization. `getUserMedia({audio:true, video:false})`
is requested only after an explicit `requestPermission()` call. Recording
starts only after permission, and stopping or cancelling stops every acquired
track and releases the stream. Permission denial becomes a generic failure.

## Format and metadata

The initial browser format is `audio/webm;codecs=opus`, selected for broad
browser support and efficient voice quality without an external service. No
transcription, enhancement, compression service, device name, filename,
location, path, or user identity is captured. Only bounded duration and the
opaque encrypted attachment reference are part of the voice message contract.

## Encryption and trust boundaries

Audio bytes are passed directly to the Phase 4A attachment encryptor before
upload integration. A fresh attachment key, per-chunk AES-GCM nonce, and
authenticated chunk metadata protect the recording. The key is intended to
travel only inside the already encrypted conversation message. The relay and
future storage backend see ciphertext chunks and delivery metadata, never
plaintext audio, keys, previews, or microphone information.

Corrupt, incomplete, reordered, expired, or wrongly keyed chunks fail closed.
Voice code does not use localStorage or sessionStorage and must not log audio,
keys, device details, or passphrases.

## Device visibility and limitations

While the user records, the unlocked endpoint and browser necessarily have
access to microphone samples and plaintext audio. A compromised endpoint,
browser, operating system, or application origin is outside this model. Relay
metadata such as timing, size, routing, and expiry may remain visible.

This foundation has no user-facing recorder, attachment upload endpoint,
durable object-storage adapter, playback component, background recording,
voice-call media, or recovery flow. Those features require separate review and
must preserve the Phase 3 security boundaries.
