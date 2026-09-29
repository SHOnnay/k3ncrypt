# Envelope identity v1 — proposed cross-path identity

Status: proposed; not a production format and not implemented in Phase 0. See ADR 0001. This identity is for deduplication/correlation, not authentication or trust.

After strict validation of the existing envelope, let `olmMessage` be the exact string at `data.olmMessage`; never serialize the object again. Proposed value:

```text
hex(SHA-256(
  UTF8("k3ncrypt/envelope-id/v1") ||
  u32be(byteLength(UTF8(conversationId))) || UTF8(conversationId) ||
  u32be(byteLength(UTF8(olmMessage))) || UTF8(olmMessage)))
```

The ID is conversation-scoped and stable across adapters; changing ciphertext or conversation changes it. It does not replace the relay's server dedupe key. Legacy `modern-seen` values remain readable; migration/check-both/write-new behavior requires Phase 1 ADR approval.

`protocol-fixtures/v1/envelope-identity.json` contains only public deterministic inputs and expected hashes. TypeScript and Kotlin Phase 0 tests validate fixture shape; algorithm parity is a Phase 1 acceptance test after the ADR is approved. Existing fixtures must not be edited.
