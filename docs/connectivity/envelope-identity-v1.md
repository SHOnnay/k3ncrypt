# Stable envelope identity v1

Status: design specification accepted in Phase 1G; not implemented by the beta runtime. See ADR 0001 and `envelope-identity-migration-v1.md`.

## Exact construction

After strict validation of the existing envelope, let `conversationId` be the exact canonical conversation ID and `olmMessage` be the exact string at `data.olmMessage`. Compute:

```text
"v1:" || lowercaseHex(SHA-256(
  UTF8("k3ncrypt/envelope-id/v1") ||
  U32BE(length(UTF8(conversationId))) || UTF8(conversationId) ||
  U32BE(length(UTF8(olmMessage))) || UTF8(olmMessage)
))
```

Lengths are UTF-8 byte lengths. Do not JSON-serialize either input, normalize Unicode, trim, or decode/re-encode the encrypted message string. Reject invalid Unicode scalar sequences and values exceeding the encoded length prefix or the existing validated-envelope limits.

The prefix is part of the storage/API identity namespace; the hash bytes are lowercase hexadecimal. The protocol fixture vectors in `protocol-fixtures/v1/envelope-identity.json` are public deterministic examples, not secrets. Implementations must verify expected hashes against those vectors and extend boundary cases before runtime adoption.

## Properties and non-properties

- Same conversation plus identical `olmMessage` yields one ID regardless of outer JSON key order, whitespace, adapter framing, path, retry attempt, or relay mailbox ID.
- A different conversation or different `olmMessage` yields a different digest, subject to SHA-256 collision resistance.
- The ID is not an authenticator, signature, trust proof, route authorization, or receipt. Normal identity, trust, sender, conversation, and session validation remains authoritative.
- A party that sees the same ciphertext and conversation can calculate the same ID. Avoid exposing it in cleartext metadata by default because it can correlate observed attempts across paths.
- It identifies one encrypted envelope, not a logical user action across re-encryption, devices, or ratchet sessions. Re-encrypting the same text yields a new ciphertext and therefore a new ID.

## Candidate comparison

See ADR 0001 for the security/migration table. The selected v1 is a conversation-scoped digest of the exact ciphertext string. A sender-assigned ID requires a versioned authenticated message-format change; a hybrid adds that cost without improving v1 deduplication. Future consideration of either must be a separate ADR and must not silently reinterpret existing IDs.

## Receipt binding

A future receipt must authenticate the expected peer device and bind the exact `envelopeId`, canonical conversation, receipt version, and intended sender/recipient roles. It must be emitted only after the ADR 0002 durable acceptance boundary. Receipt acceptance is idempotent; unknown, expired, wrong-conversation, wrong-device, or mismatched IDs do not mutate pending delivery. No receipt may be inferred from the ID or a relay event.

## Compatibility

This identity is local correlation metadata in v1 and does not alter the existing encrypted envelope format. Relay IDs remain independent. Existing `modern-seen` values must be checked during migration under the procedure in `envelope-identity-migration-v1.md`. Do not enable multipath dedupe or future receipts until fixtures, retention, legacy handling, and restart tests pass on Web and Android.
