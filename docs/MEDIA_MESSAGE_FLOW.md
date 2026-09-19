# Protected media message flow

Media references are serialized as `k3ncrypt-media-v1` payloads and must be
sent through `ModernConversation.send()`, the same encrypted message path used
for text. The attachment key is inside that encrypted payload; it is never a
separate relay field.

```text
select/record locally
  → validate MIME and size
  → encrypt/chunk locally
  → create opaque media reference
  → send reference through modern E2EE
  → retrieve ciphertext chunks
  → verify/decrypt locally
  → render/play locally
```

The reference contains only version, media kind, MIME type, bounded size,
optional duration, opaque attachment ID, encrypted metadata, and the attachment
key protected by the surrounding E2EE message. It does not contain filenames,
paths, device details, location, previews, or public URLs.

## Current integration boundary

Phase 4 currently provides the local preparation and message-reference
contracts in `service/src/media/`, plus voice preparation in
`service/src/voice/`. A durable encrypted-chunk upload/retrieval endpoint and
recipient download orchestration are intentionally not fabricated: the
existing backend has no attachment route. Those pieces must be added as a
separately reviewed opaque storage adapter before enabling media controls in
the UI.

## Privacy and failure behavior

All validation and encryption happen before any future upload. Corrupt,
missing, reordered, wrong-key, unsupported, oversized, or expired media must
fail closed with generic user-facing errors. No plaintext bytes, keys,
filenames, previews, or microphone/device metadata may enter logs, localStorage,
sessionStorage, relay records, or analytics.
