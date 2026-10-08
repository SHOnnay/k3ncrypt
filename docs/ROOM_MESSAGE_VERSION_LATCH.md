# Room message version latch

The `room-message-v1` downgrade floor is local encrypted vault state scoped to
the exact tuple `(roomId, remote pinned identity reference)`. The record
address is a domain-separated SHA-256 digest of that tuple; the encrypted
record stores `version: 1`, `roomId`, `remoteIdentityReference`, and the
monotonic `minimumWrapperVersion` value. A missing record represents an older
relationship that has not yet established a floor. A malformed, mismatched,
or unauthenticatable record is an error and never means version zero.

## Establishment and send policy

Only a successfully authenticated and durably accepted V1 frame from the
current pinned identity raises the floor to 1. Relay protocol-feature metadata
is a non-authoritative optimization: a positive hint may select V1 before the
peer has returned an authenticated V1 frame, while a missing or negative hint
cannot lower an existing floor. A sender that has not received authenticated
V1 evidence cannot claim the peer has proven V1 support; this preserves legacy
bootstrap compatibility for older peers. Current invite/session establishment
does not authenticate a shared protocol-version transcript, so new rooms are
also compatible until authenticated V1 evidence arrives.

After the floor is 1, new messages and retry sends use V1 even when the peer is
offline or the relay omits the feature hint. Legacy receive is terminally
rejected. Existing legacy ciphertext is never re-encrypted in place or
automatically retransmitted.

## Persistence, concurrency, and outbox

For an inbound message, the floor record update (including an explicit
version-zero guard for a legacy acceptance), Olm ratchet, accepted application
history, identity/session repair, replay markers, and any legacy-outbox holds
are included in the same secure-storage compare-and-swap transaction. A
concurrent floor change invalidates the acceptance transaction; the operation
fails closed and mailbox replay can retry from durable state without
overwriting a higher value. The outbox is
also guarded when new ciphertext is committed, so a send that read version
zero cannot commit legacy ciphertext after another tab raises the floor.

When authenticated V1 raises the floor, unsent legacy outbox entries are
durably marked `heldNotSentSecurely` in that acceptance transaction. Retry
skips held ciphertext. The Web projection reports “Not sent — retry required.”
An explicit text retry creates a new event ID and V1 ciphertext, and removes
the old held outbox entry in the same enqueue transaction. The old local text
history entry is replaced only after the new secure event is durably created.
Held attachment references are never retried automatically; they require the
user to select the source file and start a fresh protected transfer.

Legacy ciphertext already accepted into a relay mailbox cannot be recalled by
raising the floor. The recipient terminally rejects that old event after the
floor exists; it is not recorded as an accepted message and does not produce
Delivered/accepted status. A following valid V1 event remains processable.

## Identity changes and compatibility sunset

The K1 floor remains stored under K1. A replacement identity K2 uses a
different tuple and receives no inherited protocol capability or trust. The
existing identity-change review continues to block stale K1 traffic. Explicit
acceptance/re-verification of K2 does not copy K1's floor; K2 can establish its
own floor only through authenticated V1 evidence. Missing K2 state is distinct
from corrupt K2 state.

Legacy rooms may continue legacy delivery until authenticated V1 transition.
Latched rooms never return to legacy. No sunset date is set here; a later
release may remove legacy receive support after compatibility and deployment
policy are separately approved.
