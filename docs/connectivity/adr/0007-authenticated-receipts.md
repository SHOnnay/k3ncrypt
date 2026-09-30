# ADR 0007: Authenticated delivery receipts

Status: Receipt security and evidence semantics specified in Phase 1H. No receipt frame, wire format, transport, UI, or runtime behavior is implemented or approved by this ADR.

## Context

K3NCRYPT currently has sender-visible relay responses and events named `received` / `delivered`. They are useful relay delivery evidence, but they are not cryptographically authenticated statements from the peer. Future delivery reporting needs distinct evidence for local submission, relay mailbox storage, application acceptance, and peer persistence. These observations are not interchangeable and need not form a strictly linear sequence.

## Receipt lifecycle and sender observability

| Evidence | Meaning | What the sender can observe today | Strength and limitations |
|---|---|---|---|
| `submitted` | The sender has durably queued an already encrypted envelope and a selected delivery adapter reports that an attempt was submitted successfully. | Local outbox state and adapter result. A timeout is an unknown attempt outcome, not a rejection. | Does not prove relay durability, receiver handling, or peer persistence. Keep adapter attempt ID separate from envelope ID. |
| `relay-stored` | The authorized relay explicitly confirms that an opaque envelope was inserted into or reused from its offline mailbox. | The relay's `chat-message` response with `stored:true` and relay message ID/time. | Relay assertion only. Does not prove recipient online, decryption, acceptance, or durable peer storage. |
| `receiver-accepted` | The recipient's application handler reported successful completion of its current acceptance path for this delivery. | The immediate live `chat-message` response and later relay `delivered` event; both are relayed observations. | The event does not authenticate the recipient to the sender. It is not a peer-persisted receipt, read receipt, or guarantee of future retention. |
| `peer-persisted` | The expected peer device sent a valid authenticated receipt after committing the accepted message and required replay/session state at the approved acceptance boundary. | Not observable through a cryptographically authenticated mechanism in the current protocol. | Proves only that the authenticated peer asserted persistence at that boundary. Does not prove a person read the message or that the peer will retain it forever. |

Keep evidence as separately typed observations associated with the envelope and attempt. Do not infer `peer-persisted` from `receiver-accepted`, from a stronger-sounding event name, or from mailbox deletion. A sender may learn `relay-stored` and later learn `peer-persisted`; a live path may yield `receiver-accepted` without any mailbox storage. Timeout and connection loss leave the outcome unknown.

## Current relay event review

Current behavior is defined in `current-behavior.md` and is unchanged:

1. For a live `chat-message`, the relay sends the envelope to the recipient's active socket and waits for its Socket.IO callback. If the callback says `{accepted:true}`, the relay returns `{id,timestamp}` to the sender. The response is a relay-mediated report of the recipient handler result.
2. If there is no live recipient or the live callback declines/times out, the relay inserts/reuses the opaque envelope in the mailbox and returns `{id,timestamp,stored:true}`. This proves only the relay's mailbox operation.
3. After a recipient handler returns true, the client emits `received` with the relay's message ID. The server checks the active socket/device binding, deletes a matching mailbox row if present, then forwards `delivered` with that relay ID to the other socket. In a live send, the `delivered` event can be emitted in addition to the immediate send response.
4. The current Web sender uses the relay ID to remove matching `modern-outbox` work. That relay ID is an attempt/mailbox correlation value, not the stable v1 envelope ID.

These events do not satisfy authenticated peer persistence because the assertion crosses the relay as an ordinary server-mediated event; it is not protected end-to-end by the conversation session. The relay can forge, replay, delay, suppress, or misassociate the event. It carries a relay ID rather than the stable envelope identity and does not bind the exact conversation, expected peer device identity, or a fresh receipt instance under peer cryptographic authentication. Active socket/device authorization is valuable relay access control, but it is not cryptographic proof to the sender that the peer's application persisted this envelope. Existing semantics and outbox handling must not be relabeled in a docs-only phase.

## Required authenticated receipt binding

A future receipt may support `peer-persisted` only if all of the following are verified:

1. **Cryptographic origin and integrity.** Carry the receipt inside a versioned control frame authenticated by the existing conversation encryption session, under a separately approved feature gate. Do not add a signing scheme, trust shortcut, or transport-level authentication claim. The receipt's authenticated session must resolve to the expected peer device. An adapter or relay must not be able to create a valid receipt.
2. **Conversation identity.** Bind the exact canonical conversation identifier and the receipt type/version. The receiver validates the conversation context against the pending envelope's conversation. A channel/room ID supplied only by transport is insufficient.
3. **Envelope identity.** Bind the stable v1 `envelopeId` from ADR 0001, derived from the exact validated ciphertext and conversation. Do not bind to a relay ID, attempt ID, plaintext hash, display name, or user-supplied identifier.
4. **Sender and receiver identity.** Bind both endpoint device identities and their roles: the device whose envelope is acknowledged and the receiving device asserting persistence. Resolve those identifiers through the authenticated session and current conversation/contact descriptor; profile names and local nicknames have no authority. Identity verification state remains independent and is never changed by receipt processing.
5. **Freshness and replay protection.** Bind a receipt version and unique, unpredictable receipt instance/nonce. Persist the receiver's receipt intent/identity atomically with the accepted envelope so restart can retransmit or regenerate an equivalent authenticated receipt without falsely re-accepting content. The sender accepts it only for a retained pending/completion record for the same envelope, conversation, and peer pair; valid duplicates are idempotent. Keep a replay/tombstone record long enough to reject delayed duplicates. A wall-clock timestamp alone is not freshness and must not be the only replay defense.
6. **Acceptance ordering.** Emit only after the ADR 0002 acceptance transaction has committed the ratchet/account state, accepted message and deduplication state. A failure before commit produces no receipt. A post-commit receipt-send failure leaves the receipt eligible for bounded retry.
7. **Capability compatibility.** Send no receipt control frame to a peer that has not advertised the exact supported control version. Old-client relay behavior remains unchanged. The precise feature-negotiation and fallback rules remain a separate protocol implementation gate.

The sender must validate the complete binding before recording `peer-persisted`. A valid receipt for an unknown, expired, already-retired, wrong-conversation, wrong-device, wrong-role, or mismatched envelope ID causes no delivery-state mutation. Duplicate valid receipts are harmless no-ops. Receipt acceptance never marks a human as having read the content.

## Storage and lifecycle requirements

Existing relay `delivered` events currently remove sender outbox entries. A future authenticated receipt cannot assume that this outbox row still exists when the receipt arrives. Before receipt implementation, define a separate bounded completion/correlation record that survives relay ACK and process restart, binds the receipt to the original pending envelope, and expires only after the approved retry/replay and receipt-delay horizon. Its creation and retirement must be crash-safe. Do not silently change current outbox cleanup in this specification phase.

The receiver must persist enough encrypted or non-sensitive receipt metadata with acceptance to retry after restart. Do not store plaintext, keys, or identity secrets in a receipt journal. Define capacity behavior that does not evict records for still-valid pending receipts.

## Decisions intentionally deferred

- Exact receipt wire/control-frame schema, including one-envelope versus bounded-batch encoding.
- Whether the existing conversation session is sufficient for all receipt cases and how session renewal/identity changes invalidate outstanding receipt work. The preferred mechanism is the existing authenticated session; no alternate transcript key is selected here.
- Whether receipt transmission consumes a ratchet step, batching limits, backoff, and receipt acknowledgment/loop prevention.
- Supported receipt/replay horizon, retention size, expiry policy, and storage-pressure behavior.
- How v1 IDs and receipt completion records coexist with legacy seen digests and relay IDs during rollback/mixed-version operation.
- Whether relay-only beta clients ever opt into receipts. Until separately approved, preserve current relay-only behavior and do not emit new controls.

## Required tests before implementation

See `../receipt-test-plan-v1.md` and `test-matrix.md`. In particular, test forged relay events, authenticated valid receipts, wrong peer/conversation/envelope, replay, duplicate, delayed receipt after relay outbox removal, crash before/after acceptance commit, receipt-send loss/retry, identity/session renewal, mixed versions, and proof that no receipt precedes durable acceptance.
