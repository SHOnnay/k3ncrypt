# Web atomic message acceptance v1

Status: implemented for the Web receive path. This changes no wire format, relay behavior, or acknowledgement meaning.

## Transaction boundary

For an established inbound session, the receive owner decrypts in memory and constructs all acceptance records before committing them together through `SecureStorage.compareAndSwapRecords`. The encrypted IndexedDB vault prepares encrypted record values, then `IndexedDbVaultPersistence` checks and writes the records in one IndexedDB read-write transaction. The transaction includes:

- the advanced Vodozemac session pickle;
- the encrypted-at-rest `product-messages` record, keyed by the existing envelope digest;
- the `modern-seen` replay marker;
- a temporary encrypted-at-rest `modern-accepted-message` recovery record used to retry consumer/UI projection if that projection fails after commit.

For the first inbound pre-key message, the same CAS additionally includes the mutated Vodozemac account record (including consumed pre-key state) and the new session record. Existing conversation mode/audit records required by the receive are staged into the same CAS. Plaintext is held only in memory while preparing the encrypted records, then zeroed before the transaction; error paths also zero it.

The acceptance commit is the existing durable receiver acceptance boundary. Only after it succeeds does the conversation call its consumer callback and resolve receive successfully, allowing the existing transport to produce its existing accepted/received response. The callback is a projection/notification hook; the durable product message is already committed and is not dependent on React rendering.

## Failure and recovery

- Before the atomic IndexedDB commit: an aborted transaction changes none of the acceptance records. The mutated in-memory session is quarantined. After restart, the prior persisted session/account remains authoritative, so the same ciphertext can be redelivered and decrypted again.
- After commit, before callback completion: the message, session, and replay marker are durable. A callback failure prevents the current receive from resolving successfully. Redelivery finds the persisted replay marker, retries the idempotent message projection from `modern-accepted-message`, and does not decrypt or create a second message.
- After successful projection: the recovery record is deleted. A later duplicate finds the replay marker and is acknowledged through the existing duplicate path without repeating decrypt or projection.
- CAS conflict, unavailable atomic storage, encryption failure while preparing a record, or IndexedDB transaction failure fails closed. No successful receive is returned. A fresh runtime must reload persisted state before retrying.

This is crash consistency for the Web vault's IndexedDB transaction model. It is not a claim about OS power-loss durability beyond IndexedDB's transaction contract or about user clearing site data.

## Existing-data migration

No migration is required. Existing `product-messages`, Vodozemac account/session, conversation metadata, and `modern-seen` records retain their current encodings and record addresses. The recovery inbox is created only for newly accepted inbound messages and is removed after projection. Older clients can continue to use existing persisted conversations and messages. Atomic receive acceptance requires a storage implementation that provides multi-record compare-and-swap; the Web encrypted vault does. If that capability is absent, receive fails closed rather than reverting to non-atomic writes.

An already-existing partial state produced by an older build (ratchet advanced but ciphertext absent from message history and replay state) cannot be reconstructed by this change because the missing plaintext is not available locally. The fix prevents new instances of that state; it does not repair prior message loss.

The existing JSON-envelope digest and retention window remain unchanged. They are not upgraded or claimed as cross-platform stable identifiers by this change. The current Web seen-list bound can still evict older digests; dedupe retention and cross-platform canonicalization remain separate future work.

## Validation boundary

`e2e/web-atomic-acceptance.spec.ts` uses the real WASM runtime and encrypted IndexedDB vault. It aborts the acceptance transaction, reloads the page, redelivers the same ciphertext, confirms one durable message and replay marker, and decrypts a subsequent message using the restored session. Service tests cover duplicate replay and retry of consumer projection. These tests exercise the runtime/storage acceptance boundary; they are not a full production relay or browser-process-kill test.
