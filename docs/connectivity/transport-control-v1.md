# Transport control v1 — compatibility contract

Status: Phase 0 design. No control frame is sent by this branch.

Feature ID: `transport-control-v1`, advertised only when a later connectivity flag is enabled. Send no control frame until the remote peer explicitly advertises support. A LAN admission transcript must bind offered and selected control versions; cached relay capability is only a hint.

Control frames remain encrypted through the existing conversation session and use a strict versioned wrapper. Unknown type/version/critical field must be rejected without rendering as chat text, changing verification or persisted conversation mode, or marking the session unhealthy. Relay-only and older clients retain current message behavior.

Before implementation, agree on the exact inner-frame discriminator and how it coexists with current `MessageFrame`/join-introduction parsing. Current decoders are strict in different ways; Phase 0 records their behavior without changing them. See ADR 0004 and the mixed-version matrix.
