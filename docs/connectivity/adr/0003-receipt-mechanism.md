# ADR 0003: Meaning and authentication of future receipts

Status: Requirements expanded by ADR 0007. The session-encrypted control-frame approach remains the preferred proposal, but wire schema, batching, ratchet cost, retention, and rollout still require explicit approval before implementation.

## Problem

Current relay and transport ACKs report different events (see `current-behavior.md`). None is a new standalone session-authenticated receipt bound to a cross-path envelope identity.

## Proposal (not implemented)

Use a bounded, session-encrypted `receipt` control frame only when both peers advertise `transport-control-v1` and multipath is enabled. Bind conversation, peer device and exact pending envelope ID. Emit only after durable message/session/replay acceptance. Treat duplicate receipt idempotently; unknown IDs and mismatches do not mutate the outbox. Relay-only keeps current behavior.

## Open decisions

Approve or reject ratchet cost, batching, retention and handling when peer receipt is lost. Do not silently equate “stored by mailbox” with “persisted by peer.”

## Phase 1B validation contract

Before any `peer-persisted` transition, validate the authenticated frame under the expected conversation session; bind the exact stable envelope ID, conversation, sender/receiver device identities and roles, and fresh receipt instance. Reject wrong peer, changed identity, wrong conversation, unknown or retired ID, malformed frame and unsupported version without changing pending work. A duplicate valid receipt is idempotent. Relay transport ACKs, mailbox deletion, and an unauthenticated path receipt are insufficient. ADR 0007 defines the full sender-observable lifecycle, current relay event limitations, binding and replay requirements, and validation gates.

The receiver may emit a receipt only after the approved ADR 0002 durable acceptance boundary, including replay/dedupe state. Both peers must advertise `transport-control-v1`; older clients must never receive the frame. Relay-only behavior and existing outbox cleanup are unchanged. Specify a bounded batch/frame size, receipt expiry, retained pending-ID window, lost-receipt retry behavior and whether receipt control consumes a ratchet step before approving implementation. A receipt proves application persistence at the receiving device's claimed boundary, not reading or future data retention. D-R remains undecided; ADR 0007 records the requirements but does not approve a wire protocol.
