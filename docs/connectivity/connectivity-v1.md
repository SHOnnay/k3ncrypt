# Connectivity and delivery contract (proposal v1)

Status: Phase 0 specification. Relay-only production behavior remains the baseline. New connectivity flags default off.

## Invariants

- Conversation/session code remains the only owner of encrypt/decrypt, trust checks, session advancement and accepted-message persistence.
- Delivery receives an already encrypted, persisted envelope and retries those exact bytes.
- Discovery and route selection do not create, verify or repair contact identity.
- Existing relay proofs, mailbox semantics and old-client compatibility remain unchanged.
- A positive receive acceptance means the normal authenticated receive path completed its durable acceptance boundary.
- Transport submission, mailbox storage and peer persistence are distinct states.
- Path selection observes privacy settings; it cannot grant authorization.

## Proposed responsibilities

`ConversationOwner`: serialized send and authenticated receive operations. `DeliveryCoordinator`: durable queue, stable local correlation, attempts, retry and validated completion. `DeliveryStore`: additive metadata over current secure storage. `ConnectivityPolicy`: deterministic eligible-path selection. `PathAdapter`: bounded opaque-envelope send/receive, backpressure and lifecycle. Relay-specific join/proof/replay remains in `RelayMailboxCapability` implemented by the relay adapter.

Every async operation has timeout, cancellation and idempotent shutdown. Incoming envelopes from every adapter enter the same owner admission path.

## State vocabulary

`queued-local` means ciphertext and retry record were durably stored. `submitted` means an adapter accepted a send attempt. `mailbox-stored` means the server explicitly stored the envelope. `peer-persisted` may only follow a future authenticated receiver receipt. `retry-pending` means outcome remains unresolved. A timeout is unknown, not rejection. Existing UI statuses retain their current meanings until a reviewed receipt protocol exists.

## Default selection

Relay is the only enabled path by default. LAN/direct paths require both global and per-contact opt-in, verified and unchanged peer identity, active device lifecycle, healthy session, and current required freshness evidence. No path is preferred at the cost of delaying available relay delivery. Failed direct attempts retry the same envelope on relay. Empty path set retains the secure outbox. Do not fan out simultaneously by default; handle overlap idempotently.

`Hide my IP from contacts` must constrain candidate gathering before negotiation, not merely reject a selected direct path. Relay-only does not hide metadata from the relay operator.

## Compatibility and storage

Old clients continue relay messaging/calls. New path records are additive and versioned; absence means relay-only. Do not migrate or rewrite session, identity, invitation or mailbox records. New control frames are gated by peer capability. Unknown frames are dropped without becoming chat text or changing health/trust state.

## Sequence

1. Owner validates current policy and identity/session state.
2. Owner encrypts once and persists its encrypted outbox record.
3. Coordinator asks policy for an eligible adapter.
4. Adapter reports submission/mailbox outcomes; it cannot report peer persistence without a valid authenticated receipt.
5. Receiver adapter supplies the opaque envelope and bound sender context to the owner.
6. Owner authenticates, decrypts and durably accepts using existing code.
7. Receipt/relay callback follows that boundary according to its specified semantics.
