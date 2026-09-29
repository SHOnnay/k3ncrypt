# Receiver receipts v1 — proposed semantics

Status: proposed. The owner decision D-R remains open. Existing ACKs are specified in `current-behavior.md` and must not be relabeled.

“Persisted by peer” may only be recorded from a receipt authenticated by the conversation session or a reviewed admitted-channel transcript key. The receipt binds the conversation, expected peer device and exactly one pending envelope identity (or a bounded batch); unknown IDs are ignored, duplicates are idempotent, and invalid/wrong-peer/wrong-conversation receipts do not clear pending data. Receiver emits only after the M2 durable acceptance boundary. Feature gating uses `transport-control-v1`.

Proposed D-R option: session-encrypted batched control frames for peers that both advertise support and have multipath enabled. This spends ratchet messages and must have bounded batch/frame limits. Relay-only retains current behavior. No relay ACK or raw transport callback qualifies as a peer receipt.
