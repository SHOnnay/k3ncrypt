# ADR 0004: Version gating for transport controls

Status: Proposed.

Use feature ID `transport-control-v1` through the existing relay feature negotiation, gated by an opt-in connectivity flag. For offline admission, bind offered/selected versions in the signed transcript. Do not send unknown controls to old clients. Define strict frame discrimination with cross-platform fixtures. Unknown controls are not chat, do not update verification/mode, and do not degrade the message session.

Before implementation, characterize the existing TS and Kotlin unknown-frame behavior. Decide exact parser boundary and old-client fallback in Phase 1. Do not change existing frame format in Phase 0.
