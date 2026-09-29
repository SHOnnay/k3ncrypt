# Envelope identity v1 migration plan

Status: specification only. No runtime or record migration is performed by Phase 1G.

## Current record formats

- Web stores `modern-seen` as a list of unversioned SHA-256 hex digests computed from UTF-8 `JSON.stringify(validatedEnvelope)`; it retains at most 1,024 entries.
- Android stores an unversioned SHA-256 hex digest of the UTF-8 serialized envelope string in the same Room transaction as inbound message/session state.
- These legacy digests are not interchangeable. The Web digest depends on JavaScript serialization of the parsed object; Android's digest depends on the exact outer JSON string bytes.
- Outbox retry reuses the saved ciphertext. Relay mailbox identifiers and relay attempt IDs are separate and are not migration inputs.

## Compatibility strategy for a future implementation

1. Add a versioned local identity representation (`v1:<lowercase-hex>`) without changing encrypted envelope or relay payload formats.
2. For each incoming envelope, strictly validate it, compute the existing platform-local legacy digest exactly as that platform did, and compute the v1 conversation-scoped ciphertext identity from the exact `olmMessage` and canonical conversation ID.
3. During the compatibility period, check both the legacy record and the v1 record before decrypt/acceptance. If either proves durable prior acceptance, do not decrypt again. Any v1 duplicate marker, encrypted message record, ratchet/account update, and recovery data must share the atomic acceptance boundary required by ADR 0002.
4. On new acceptance, write v1 identity in the same transaction as message and ratchet state. Preserve the existing legacy marker if required by older client/app versions; do not overwrite it with a v1 value or assume a legacy digest can be converted without original envelope bytes.
5. Keep old envelope formats and relay-only clients readable. Since v1 is local metadata, older clients need not understand it. Gate any future receipt/control separately under ADRs 0003 and 0004.
6. Do not remove legacy markers until the longest supported retry, mailbox replay, and delayed-delivery interval has expired, all stored entries have aged out under a reviewed retention policy, and rollback remains possible. If the horizon is unbounded or unknown, retain legacy compatibility or block retirement.

## Retention and rollback gates

The current Web 1,024-entry cap is not a safe migration horizon by itself. Before implementation, define:

- maximum sender retry lifetime;
- relay mailbox TTL and maximum replay delay;
- maximum allowed offline duration before a pending envelope is expired;
- accepted-ID retention and capacity behavior under storage pressure;
- behavior if an ID record is missing/corrupt while the encrypted message is present;
- rollback behavior for a client that writes v1 records and then runs an older binary.

The retention policy must ensure a still-retryable envelope cannot be decrypted a second time after its marker is evicted. Storage exhaustion must fail safely: do not discard unexpired dedupe state to make room and then acknowledge a duplicate. Any expiry policy must make corresponding pending envelopes no longer eligible for delivery before their dedupe records are removed.

Do not derive the v1 ID from a legacy digest. If an old message is seen again, the validated incoming envelope supplies the bytes needed to compute both identities; otherwise the old digest does not reveal the envelope. Legacy records that cannot be paired remain opaque until expiry/retirement.

## Compatibility and security checks

- Mixed old/new Web and Android clients continue unchanged relay messaging; no new outer field is required.
- Same ciphertext over relay, LAN, and direct paths maps to one conversation-scoped identity, with adapter attempt metadata stored separately.
- A changed ciphertext, conversation, or peer context does not match the old accepted ID; normal authenticated receive checks reject invalid sender/context regardless of ID.
- A v1 ID is not proof of sender identity. A receipt must be authenticated and bound to the expected peer device, conversation, and pending ID; only that receipt can support future `peer-persisted` evidence.
- If transport exposure is proposed, perform a privacy review for cross-path traffic correlation before placing IDs in cleartext headers or logs.

## Rollout sequence

1. Ship cross-platform fixture/parity tests and a storage schema reader without changing writes.
2. Verify old-format lookup and v1 computation on existing records, under restart and multi-tab/process concurrency tests.
3. Begin atomic dual-read/v1-write in a separately reviewed release; retain legacy data and relay-only behavior.
4. Measure the real retry/mailbox horizon and storage growth before defining expiry.
5. Retire legacy lookup only in a later version with a documented minimum-version and rollback policy. Do not couple retirement to LAN/direct enablement.
