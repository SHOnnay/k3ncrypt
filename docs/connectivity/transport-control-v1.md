# Transport control v1 — compatibility contract

Status: Phase 0 design. No control frame is sent by this branch.

Feature ID: `transport-control-v1` is a future capability name, not currently advertised by runtime. If later implemented, advertise/use it only when the connectivity flag is enabled and after both complete offers and the selected control version are bound to a fresh authenticated transcript as specified by ADR 0008. The existing relay `protocolFeatures` value is only a transient peer-asserted compatibility hint and alone cannot authorize a control frame. Cached relay metadata must be revalidated in the authenticated admission transcript. No new feature ID may be added to the current strict relay allowlist without an approved compatible rollout.

Control frames remain encrypted through the existing conversation session and use a strict versioned wrapper. Unknown type/version/critical field must be rejected without rendering as chat text, changing verification or persisted conversation mode, or marking the session unhealthy. Relay-only and older clients retain current message behavior.

Before implementation, agree on the exact inner-frame discriminator and how it coexists with current `MessageFrame`/join-introduction parsing. Current decoders are strict in different ways; Phase 0 records their behavior without changing them. See ADR 0004 and the mixed-version matrix.
