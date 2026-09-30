# ADR 0006: Delivery evidence and state model

Status: Accepted as a specification for Phase 1B. No runtime state or UI change is authorized by this ADR.

## Decision

Keep independent evidence for each envelope and attempt. These are observations, not a linear sequence and not synonyms for today's UI status. A relay attempt can be mailbox-stored without reaching a receiver; a live receiver can accept without a mailbox row. A later receipt can arrive after either route.

| Evidence | Positive proof | Never proves |
|---|---|---|
| `submitted` | The selected adapter returned success for an attempt to submit the already encrypted envelope. Record the adapter and its attempt identifier separately from envelope identity. | Relay durability, receiver acceptance, peer persistence, reading, or delivery over another path. A timeout has unknown outcome. |
| `relay-stored` (`mailbox-stored`) | The authorized relay explicitly returned `stored:true` after inserting or reusing an offline mailbox entry. Keep its relay ID and expiry as relay metadata. | An online receiver, successful decryption, durable peer acceptance, or indefinite storage. |
| `receiver-accepted` | On the current relay path, the receiver application handler returned `accepted:true` for this delivery attempt. Web normally reaches this after its consumer and seen-marker writes; Android after its inbound transaction. | A separately authenticated peer receipt, user display/read, or an unconditional crash-consistency guarantee. The sender only hears this through relay-controlled events. |
| `peer-persisted` | A future, independently validated, peer-authenticated receipt identifies the expected conversation, sender envelope and peer device and is emitted only after the receiver's durable acceptance boundary. | Human reading, retention forever, or proof that every peer device accepted it. This state does not exist in Phase 1A. |

The current `chat-message` live `{id,timestamp}` is a relay report of `receiver-accepted`; `{id,timestamp,stored:true}` reports `mailbox-stored`. `received` and `delivered` are relay-mediated reports, not future peer receipts. `mailbox-replay` `accepted` means its loop finished, not that every queued item succeeded. Preserve these wire and UI meanings on relay-only clients. See `current-behavior.md` for the complete ACK table.

An envelope may have several attempts and observations. Do not infer a stronger observation from a weaker one. Store attempt IDs separately from the stable envelope ID. A failure or timeout of one attempt does not erase another path's positive evidence; it also does not turn an unknown outcome into rejection. A future authenticated receipt may resolve an unknown attempt. A raw adapter callback, relay event or mailbox deletion must never set `peer-persisted`.

## Preconditions before implementation

Implement and validate the stable identity and legacy migration selected in ADR 0001, the durable receiver acceptance boundary in ADR 0002, and the authenticated receipt mechanism in ADR 0003. Define retention and recovery for evidence so restart cannot promote or forget an unresolved envelope incorrectly. Keep existing relay outbox cleanup and user-visible statuses unchanged until a separately reviewed migration specifies them.
