# Authenticated delivery receipt v1 test plan

Status: implementation acceptance plan only. No receipt frame or runtime behavior is implemented in Phase 1H. See ADR 0007.

## State evidence and sender observation

For each scenario, assert the sender records evidence with its source and attempt identifier, never collapsing independent observations into one delivery state:

| Scenario | Required sender evidence | Forbidden conclusion |
|---|---|---|
| Adapter accepts submission | `submitted` with adapter/attempt identity | Do not infer relay storage or receiver handling. |
| Relay stores offline envelope | `relay-stored` from explicit `stored:true` response | Do not infer recipient online or peer persistence. |
| Live receiver handler returns accepted | `receiver-accepted` observation sourced from relay response/event | Do not infer cryptographically authenticated peer persistence. |
| Valid peer receipt arrives | `peer-persisted` for exactly the bound envelope/conversation/device pair | Do not infer human read or indefinite retention. |
| Timeout, disconnect, lost ACK | Unknown attempt outcome | Do not mark rejected or erase positive evidence from another attempt. |

## Receipt binding and rejection cases

Test a valid authenticated receipt bound to the exact receipt version, canonical conversation ID, v1 envelope ID, local sender device, expected receiving device, and their explicit roles. Verify the receiver can produce it only after durable message/session/replay acceptance.

Reject with no delivery, trust, identity, or session-state mutation:

- unauthenticated or relay-forged receipt;
- wrong conversation, envelope ID, sender/receiver device, or role direction;
- unknown or expired pending ID;
- altered receipt body, unsupported version, malformed nonce, or stale identity/session binding;
- replayed receipt nonce for a different envelope or a different peer pair;
- relay `delivered`, `received`, `{accepted:true}`, `{stored:true}`, or mailbox deletion presented as a peer receipt.

Duplicate copies of the same valid receipt must be idempotent. A stale receipt for a retired record must not resurrect state or clear a newer envelope. Time-only freshness must fail the security review; clock skew must not make the nonce/replay checks ambiguous.

## Crash, retry, and persistence cases

- Crash before durable acceptance: no receipt is emitted; same encrypted envelope can be retried under the approved acceptance model.
- Crash after acceptance commit but before receipt send: accepted message remains exactly once; persisted receipt intent is retried after restart.
- Receipt send accepted by adapter but sender never sees it: receiver retries the equivalent logical receipt; duplicate receipt processing is harmless.
- Relay ACK removes existing outbox item before receipt arrives: the future receipt correlation/tombstone still resolves the exact envelope after restart.
- Receipt arrives after expiry/retirement: ignore without mutating other items.
- Storage capacity reached: preserve records for unexpired pending receipts or fail safely; never drop live replay/tombstone protection silently.

## Mixed versions and protocol gating

- New implementation with old peer: emits no receipt control; existing relay events/outbox semantics remain unchanged.
- Both peers advertise supported control version but receipt feature is disabled: no receipt control.
- Only after explicit future feature approval and mutual capability support may a receipt control be emitted.
- Unknown control type/version must follow the separately approved strict parser behavior and must not be surfaced as chat or alter verification.

## Completion criteria

The implementation must prove authenticated origin, exact conversation/envelope/device binding, freshness and replay protection; durable post-acceptance receipt intent; sender correlation after current outbox removal; duplicate idempotence; crash/restart safety; and unchanged relay-only behavior. Run on Web and Android independently, but this plan authorizes no Android feature implementation. Security review must approve the wire schema and nonce/replay design before any protocol code is written.
