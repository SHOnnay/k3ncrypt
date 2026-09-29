# Phase 1B delivery-state specification

Status: design only. Phase 1A relay submission remains the running implementation. No new transport, frame, storage migration or UI state is enabled.

## Evidence, ownership and current mapping

ADR 0006 defines four separate pieces of evidence: `submitted`, `mailbox-stored`, `receiver-accepted` and future `peer-persisted`. They are not a monotone four-step pipeline. Conversation ownership retains encryption, trust, authenticated acceptance and durable message storage. RelayDeliveryBoundary submits already encrypted envelopes, preserves the existing five-second retry skip and passes persistence back to the conversation owner. The relay decides live forwarding versus offline mailbox storage. A future coordinator may correlate attempts, but cannot authenticate peers or promote relay evidence into peer persistence.

Today `chat-message` returns relay `{id,timestamp}` on a live receiver callback and `{id,timestamp,stored:true}` on mailbox retention. The service transport type exposes only `id`/`timestamp`, so Phase 1A does not expose `stored` as a distinct client-side result. The receiver transport emits `received` on handler success; the relay deletes a matching mailbox row and emits `delivered`. `ModernConversation.acceptDelivery()` removes matching outbox work on that relay event. This is existing beta behavior, not a future peer receipt. See `current-behavior.md` and ADR 0006; do not relabel it.

## Stable identity and deduplication

The v1 `envelopeId` design is selected in ADR 0001 and specified in `envelope-identity-v1.md`: it hashes a domain-separated, length-prefixed canonical conversation ID and exact validated `olmMessage` string. It is a non-secret correlation/dedupe value, never authentication. All paths must carry the same encrypted envelope bytes after a single encryption. Adapter attempt IDs and relay mailbox IDs remain separate. Receiver dedupe must be common across paths and occur before a second decrypt, using a durable acceptance record; sender correlation must survive restart. Existing TypeScript `SHA-256(JSON.stringify(envelope))` and 1,024-entry seen window remain the beta behavior and are insufficient as an unreviewed cross-platform lifetime contract. The seven-day mailbox expiry and sender retry policy need measurement before a retention bound is selected. Legacy records must remain readable during any later migration. This Phase 1G decision is specification only; no runtime change is authorized by it.

## Receipt and crash gates

ADR 0003 proposes a capability-gated, authenticated control receipt. It must name the exact pending envelope and conversation, come from the expected peer device, and be idempotent. It is emitted after the approved durable acceptance boundary only. Missing or timed-out receipts leave an unresolved outcome; they do not imply failure. Existing relay-only ACK and outbox semantics stay unchanged. ADR 0002 remains open on the Web persistence strategy, particularly ratchet advancement before consumer/seen writes. Android's inbound transaction does not eliminate Web crash risk. The CP1–CP6 matrix and the Phase 1B tests in `test-matrix.md` are acceptance gates, not assertions that current code passes them.

## Open decisions

1. Implement and validate the selected cross-platform ID and versioned legacy migration, then choose dedupe retention based on the measured longest legitimate replay/retry lifetime.
2. Select an implementable Web crash-consistency approach after inspecting the concrete vault, session and message transaction boundaries. Characterize sender crash recovery on each platform.
3. Approve or reject encrypted control receipts, including ratchet cost, batching, expiry and lost-receipt handling. Define peer capability gating and old-client fallback before any frame is sent.
4. Decide how future evidence metadata is stored and recovered without changing the current relay outbox and user-visible delivery labels.

Multipath remains blocked until these decisions, implementation and fault-injection tests are complete.
