# ADR 0001: Stable envelope identity for multipath

Status: Accepted as a design specification in Phase 1G. Runtime adoption, wire exposure, and migration execution require a separate implementation review. No production behavior changes in this ADR.

## Context

Relay retry, mailbox replay, LAN/direct overlap, deduplication, and any future receipt need to refer to one encrypted envelope independently of its delivery attempt or path. Today they do not share a stable cross-platform identity:

- Web computes SHA-256 over `JSON.stringify(envelope)` after parsing. Property order and serialization details can affect the digest.
- Android computes SHA-256 over the serialized envelope string bytes. Whitespace, outer-field order, or equivalent JSON formatting can affect the digest.
- Relay IDs identify relay records/attempts. They are not stable envelope identities and must remain distinct.
- Web's persisted `modern-seen` list is count-bounded to 1,024 entries. Android stores a digest with its transactional inbound record. Neither current scheme establishes a common replay-retention horizon.
- Retry resubmits the saved ciphertext. It must not encrypt again to create a retry.

The current formats and meanings remain unchanged until a later implementation is separately approved.

## Decision

For identity version 1, define a conversation-scoped deterministic digest over the exact validated inner encrypted message string already carried by the envelope:

```text
envelopeId = "v1:" || lowercaseHex(SHA-256(
    UTF8("k3ncrypt/envelope-id/v1") ||
    U32BE(length(UTF8(conversationId))) || UTF8(conversationId) ||
    U32BE(length(UTF8(olmMessage))) || UTF8(olmMessage)
))
```

`conversationId` is the exact canonical conversation identifier used by the authenticated conversation owner. `olmMessage` is the exact string extracted from a strictly validated existing envelope. Neither value is re-serialized, normalized, trimmed, or decoded and re-encoded. Lengths count UTF-8 bytes, not characters. Inputs that cannot be encoded as valid Unicode scalar sequences or whose UTF-8 byte lengths exceed the 32-bit prefix are rejected. Implementations must additionally enforce the existing envelope size limits before hashing.

The conversation binding prevents accidental cross-conversation aliasing. A changed conversation or changed ciphertext produces a different ID. Re-delivery of the same ciphertext for the same conversation produces the same ID across Web, Android, relay, and future paths. The relay's own mailbox key and per-attempt identifiers remain separate.

This value is a deterministic correlation and deduplication key only. It does not authenticate the sender, prove trust, authorize a route, prove persistence, or replace Vodozemac authentication. Existing sender/conversation/session checks remain mandatory before acceptance. Receipts must be authenticated and independently bound to the expected peer device, conversation, and pending envelope ID under ADR 0003.

## Alternatives considered

| Design | Security and replay properties | Migration and compatibility | Decision |
|---|---|---|---|
| Hash the full ciphertext/envelope serialization | Collision resistance is strong when SHA-256 is applied, but hashing a re-serialized object is not cross-platform stable. Hashing the raw outer JSON still couples identity to adapter/wrapper formatting. | Existing Web and Android digests already differ; fixes require exact byte rules and legacy lookup. | Reject raw or re-serialized outer-envelope hashing. |
| Sender-assigned message ID | Random IDs can be stable across retries and convenient for receipts. If carried outside encryption, an unauthenticated ID can be substituted, replayed, or used for cross-path correlation. If included inside the encrypted frame, receivers must decrypt before dedupe, and adding it changes the message format and session plaintext. | Requires a protocol/frame version, old-client behavior, authenticated binding, and migration. Existing messages have no such ID. | Do not use for v1. Re-evaluate only with a separately versioned message-format proposal. |
| Conversation-scoped ciphertext digest | Deterministic for the same validated ciphertext and conversation, independent of JSON wrapper and transport attempt. It is not an authenticator; a malicious party can calculate it for ciphertext it already sees. | Requires legacy check-both migration and retention policy, but no envelope or cryptographic format change. Existing messages can be identified from their `olmMessage` string. | **Select for v1.** |
| Hybrid: sender ID plus ciphertext digest | Can provide a human/protocol message handle while a digest binds the exact envelope. Still requires authenticated in-message ID binding; cleartext metadata creates linkability and substitution surface. | Highest migration cost; adds message-format and receipt versioning. | Defer. Consider only if future requirements cannot be met by the v1 digest. |

## Use and privacy rules

1. Compute once from the validated envelope and canonical conversation ID; carry the same value through all attempts and paths.
2. Retry the exact saved encrypted envelope. Never create a new identity for a retry.
3. Deduplicate only after the existing sender, conversation, trust, and cryptographic checks establish an authenticated message, except that an already durably accepted ID may be recognized before a second decrypt to handle legitimate replay.
4. Commit the ID in the same durable acceptance transaction as the ratchet/account state and encrypted accepted-message record, as required by ADR 0002.
5. Do not place `envelopeId` in cleartext transport metadata by default. It can link repeated traffic observed on different paths. If a future adapter needs it for routing/deduplication, document exposure, scope it to a conversation, and obtain privacy review. Authenticated receipts may carry it only inside the authenticated control channel.
6. Keep adapter attempt IDs, relay mailbox IDs, and envelope IDs as separate typed fields; never treat one as another.
7. Bound input lengths, record count, storage time, and receipt lookup. Do not evict an ID while an identical envelope can still legitimately be retried or replayed.

## Migration and compatibility

See `../envelope-identity-migration-v1.md`. Existing `modern-seen` digests must remain readable and be checked alongside v1 IDs during a compatibility window. A legacy digest cannot be translated into a v1 ID without the original validated envelope and conversation identifier; do not rewrite or discard legacy entries speculatively. The current 1,024-entry Web bound is not evidence of adequate retention. Define the supported retry/replay horizon before selecting count/time retention or retiring legacy data.

The ID is local metadata in v1; old clients continue sending and receiving the unchanged envelope. A future authenticated receipt/control frame must be feature-gated separately and must never be sent to an unadvertised peer. The v1 ID alone does not require a wire migration.

## Required acceptance evidence before implementation

- Independent TypeScript and Kotlin implementations match every published fixture byte-for-byte, including non-ASCII inputs and boundary/error cases.
- Same conversation and exact `olmMessage` yield the same ID after retry, mailbox replay, and path wrapping/reordering; changed ciphertext or conversation yields a different ID.
- Legacy seen records are recognized during migration, and old clients continue relay-only behavior.
- Duplicate detection is durable across restart and remains active for the approved maximum retry/mailbox replay horizon.
- A forged or mismatched receipt cannot clear an outbox item; duplicate valid receipts are idempotent.
- Logs, cleartext path metadata, and user-facing UI do not reveal message text, identity material, or unnecessary cross-path correlation data.
