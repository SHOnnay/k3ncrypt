# Phase 1C crash-consistent acceptance specification

Status: design only. No runtime, wire, transport or UI change is authorized. Existing ACK meanings remain in `current-behavior.md` and ADR 0006.

## Observed persistence and ACK order

### Web outbound

`ModernConversation.sendUnlocked()` checks device and contact state, creates an outbound session when needed, then calls `VodozemacRuntime.encrypt()`. The runtime writes a `vodozemac-commit` marker, encrypts, persists the advanced session and removes the marker before returning ciphertext. The conversation then writes the envelope and client ID to `modern-outbox`. `retryPending()` submits that saved ciphertext and separately writes relay ID/time into the outbox. `acceptDelivery()` may remove it after the existing relay `delivered` event. Session, outbox and relay-result writes are not one transaction.

### Web inbound

`ModernConversation.receive()` checks lifecycle, route, envelope and the `modern-seen` digest before decrypt. The digest is SHA-256 of `JSON.stringify(envelope)`; 1,024 entries are retained. For an existing session, `VodozemacRuntime.decrypt()` writes its marker, decrypts, **persists the advanced session**, removes the marker, then returns plaintext. The first inbound prekey path commits account/session before returning plaintext. The conversation parses the frame, awaits `onMessage`, then writes `modern-seen` as a separate secure record. The Web `ChatContext` callback reads/rewrites encrypted `product-messages` before updating React state. There is no transaction spanning session, product message and seen marker. Socket.IO emits `received` and `{accepted:true}` only after `receive()` resolves true. A seen duplicate returns true before another decrypt. The runtime commit marker does not cover the product message or seen record.

### Android inbound

`InboundMessageProcessor.receive()` checks digest and identity/trust, decrypts and decodes, then calls `CryptoStateStore.commitInbound()`. Its Room transaction writes account, session, message and digest together; the live session is published only after `STORED`. An uncommitted mutation invalidates volatile crypto state. The repository reports accepted/duplicate only afterward. Android hashes envelope string bytes, distinct from Web's JSON digest. Transactional source structure does not replace process-death testing with real storage.

## Crash windows

| Window | Current possible outcome | Required later guarantee |
|---|---|---|
| S1: sender crash after encrypt/session persistence, before outbox write | Ratchet advanced; no durable ciphertext to retry. | Do not claim queued/submitted. Decide whether recovery can safely reconstruct work or report failure; never re-encrypt an already submitted envelope for retry. |
| S2: sender crash after outbox write, before or after submission | Saved ciphertext survives, but relay outcome and ID/time may be unknown. | Retry exact ciphertext after restart; unknown is not rejection. |
| R1: receiver crash after decrypt/session commit, before product message write | Session advanced and seen marker absent; replay may fail decrypt, losing content. | Recover content/session/dedupe without loss or premature ACK, tested with real Vodozemac state. |
| R2: receiver crash or error during product message write | Session already advanced; product write may or may not be durable. | Resolve ambiguity after restart; never ACK uncommitted content. |
| R3: receiver crash after message write, before seen marker | Message may exist without dedupe; replay may duplicate consumer effect or fail decrypt. | One persisted message and recoverable dedupe after restart. |
| R4: ACK/report lost after receiver acceptance | Relay may retain/replay and sender may retry. | Accept duplicates idempotently before second decrypt; timeout is unknown. |
| R5: duplicate by live, mailbox or later path | Different adapter IDs refer to the same ciphertext. | One common durable envelope identity and one authenticated acceptance owner. |

A resolved write promise is the current application boundary; actual disk/process guarantees require platform fault injection. Relay submission, mailbox storage and receiver callbacks are not future authenticated peer receipts.

## Candidate designs

| Candidate | Strength | Limit and proof required |
|---|---|---|
| Transactional acceptance | One commit for encrypted session/account, product message and dedupe is the clearest receiver boundary. Android already uses Room for its inbound record set. | Web `SecureStorage.compareAndSwapRecords` and IndexedDB multi-record transactions exist, but current runtime, conversation and UI writes are separate. Prove shared ownership, first-session account handling and concurrent-tab serialization. |
| Write-ahead acceptance record | A versioned, bounded journal could support roll-forward/recovery when writes cannot share a transaction. | Journal must be durably coordinated with ratchet mutation and sufficient to recover R1; a journal written after session commit is too late. Keep plaintext/keys out of it. Specify expiry, corruption and recovery behavior. |
| Idempotent recovery | Stable envelope ID as product key can suppress duplicate consumer effects at R3/R4 and across paths. | Alone it cannot recover R1 after session advance before content write. A marker written before content could suppress an unaccepted message. Requires a companion atomic or ratchet recovery design. |

No candidate is selected. A later decision must prove a single durable acceptance or recovery invariant across session, content and dedupe, including first prekey session and competing browser tabs. Trust and identity checks stay with the conversation owner. A future peer receipt may be emitted only after this boundary commits.

## Stable envelope identity dependency

Web hashes serialized JSON; Android hashes the envelope string. Property order, whitespace, escaping and adapter framing can change these bytes without changing ciphertext. ADR 0001 proposes domain-separated SHA-256 over length-prefixed conversation ID and the exact validated `olmMessage` string. It is a correlation/dedupe key, not authentication. Before using it for an acceptance journal or receipt, approve cross-platform fixture parity, legacy check-both migration, malformed-envelope handling and bounded retention. Server mailbox dedupe stays independent. The Web 1,024-entry seen window cannot be assumed to cover the seven-day mailbox plus all retries; measure the supported lifetime.

## Gates

Inspect Web transaction scope and Android Room boundaries, select a candidate after real restart/fault tests, define ID migration and retention, and pass S1–S2/R1–R5 before enabling multipath or `peer-persisted`.
