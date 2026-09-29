# ADR 0003: Meaning and authentication of future receipts

Status: Proposed option D-R; owner decision required before implementation.

## Problem

Current relay and transport ACKs report different events (see `current-behavior.md`). None is a new standalone session-authenticated receipt bound to a cross-path envelope identity.

## Proposal

Use a bounded, session-encrypted `receipt` control frame only when both peers advertise `transport-control-v1` and multipath is enabled. Bind conversation, peer device and exact pending envelope ID. Emit only after durable message/session/replay acceptance. Treat duplicate receipt idempotently; unknown IDs and mismatches do not mutate the outbox. Relay-only keeps current behavior.

## Decision needed

Approve or reject ratchet cost, batching, retention and handling when peer receipt is lost. Do not silently equate “stored by mailbox” with “persisted by peer.”
