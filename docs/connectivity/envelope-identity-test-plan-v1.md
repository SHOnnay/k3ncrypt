# Stable envelope identity v1 test plan

Status: required validation plan; tests do not authorize runtime adoption. The v1 algorithm is specified in ADR 0001 and `envelope-identity-v1.md`.

## Cross-platform fixture parity

Run the same vectors from `protocol-fixtures/v1/envelope-identity.json` in independent Web/TypeScript and Android/Kotlin implementations. Both must produce the exact versioned string `v1:<lowercase-hex>`.

| Case | Input variation | Expected |
|---|---|---|
| Baseline vector | ASCII conversation and ciphertext | Exact fixture match on both platforms |
| UTF-8 vector | Non-ASCII conversation and `olmMessage` including multibyte characters | Exact fixture match; lengths count UTF-8 bytes |
| JSON metacharacters | Quotes, backslashes, slash and Unicode snowman in `olmMessage` | Hash exact inner string; do not parse/reserialize it |
| Outer-envelope key order | Equivalent valid outer JSON with reordered keys | Same ID after strict parse and extraction |
| Outer-envelope whitespace | Equivalent valid outer JSON with different whitespace | Same ID |
| Conversation binding | Same `olmMessage`, different canonical conversation ID | Different ID |
| Ciphertext binding | Same conversation, one changed `olmMessage` byte | Different ID |
| Adapter metadata | Same envelope with different relay ID, mailbox ID, retry attempt, or path wrapper | Same ID; adapter identifiers remain separate |
| Invalid envelope | Wrong version/strategy, unexpected keys, non-string `olmMessage`, malformed envelope | Reject before identity computation/acceptance |
| Invalid text encoding | Unpaired surrogate or non-encodable input at API boundary | Reject consistently; no replacement-character normalization |
| Length bounds | Existing envelope limit exceeded or u32 byte length overflow | Reject before allocation/hash |

## Retry, duplicate, and acceptance behavior

1. Encrypt once, persist the envelope, submit, then retry after simulated timeout. The ciphertext and v1 ID remain byte-for-byte identical.
2. Deliver the same ciphertext through relay live delivery, mailbox replay, LAN and direct adapters in every pairwise order. Once a copy is durably accepted, later copies do not decrypt again or create another message.
3. Crash/reload at each acceptance boundary. The v1 ID, encrypted message, session/account state and recovery record must be committed atomically as specified by ADR 0002; a failed transaction leaves none accepted.
4. Deliver a different ciphertext for the same conversation and a same ciphertext under a different conversation. Neither may be suppressed by an unrelated accepted marker.
5. Test concurrent tabs/processes accepting one ID. At most one durable acceptance and one user-visible message are produced; losing contenders resolve as duplicates without publishing mutated volatile session state.

## Legacy migration

Seed records in each platform's actual legacy representation:

- Web legacy SHA-256 of UTF-8 `JSON.stringify(validatedEnvelope)` in `modern-seen`.
- Android legacy SHA-256 of UTF-8 serialized-envelope bytes in the Room inbound digest store.

For a redelivered matching envelope, dual-read must recognize the platform's legacy marker and avoid a second decrypt. The implementations must not assume those legacy digest values match cross-platform. For a newly accepted message, atomically write the v1 identity and preserve any legacy compatibility data required by the supported rollback window. If the old envelope bytes are unavailable, do not manufacture a v1 identity from its legacy digest.

Test restart after each migration write; storage corruption; old-version reader after v1 write; marker pressure; maximum retry/mailbox lifetime; and expiry ordering. Under storage pressure, unexpired IDs cannot be evicted while the corresponding envelope is still deliverable. Delivery expiry and identity expiry must be ordered so no eligible ciphertext can arrive after its marker is dropped.

## Receipt security

When receipts are separately implemented, test authenticated receipts bound to exact v1 ID, conversation, expected device, direction/roles, and receipt version. Valid duplicates are idempotent. Wrong ID, wrong conversation, wrong device, changed identity, expired ID, unknown ID, replay after retirement, malformed version, and raw relay ACK must not remove pending work or mutate trust/session state. Receipt loss leaves outcome unknown and retry uses the original ciphertext.

## Performance, privacy, and observability

- Hashing runs only after envelope size/schema checks; benchmark maximum legal input on supported Web/Android devices.
- Confirm raw IDs are not logged or included in cleartext transport headers by default.
- Verify telemetry does not correlate IDs across conversations or paths.
- Ensure errors do not expose ciphertext, identities, or message content.

## Release gate

No multipath deduplication or authenticated receipt may rely on the ID until fixture parity, legacy dual-read, atomic acceptance, restart, duplicate-overlap, concurrency, retention/expiry, and receipt tests pass on supported Web and Android versions. Until retention horizon is decided, preserve legacy behavior and do not retire or evict still-live accepted IDs.
