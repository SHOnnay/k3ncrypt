# Receiver receipts v1 — proposed semantics

Status: semantics and security requirements specified in ADR 0007; receipt frame and runtime remain unimplemented and unapproved. Existing ACKs are specified in `current-behavior.md` and must not be relabeled.

“Persisted by peer” may only be recorded from a receipt authenticated by the conversation session or a reviewed admitted-channel transcript key. The receipt binds the conversation, expected peer device and exactly one pending envelope identity (or a bounded batch); unknown IDs are ignored, duplicates are idempotent, and invalid/wrong-peer/wrong-conversation receipts do not clear pending data. Receiver emits only after the M2 durable acceptance boundary. Feature gating uses `transport-control-v1`.

Preferred proposal: session-authenticated control frames for peers that both advertise the supported control version and have the feature explicitly enabled. This may spend ratchet messages; batching, frame limits, receipt expiry, and rollout remain unresolved. Relay-only retains current behavior. No relay ACK or raw transport callback qualifies as a peer receipt. See ADR 0007 and `receipt-test-plan-v1.md` for sender-observable lifecycle, binding requirements, and tests.
