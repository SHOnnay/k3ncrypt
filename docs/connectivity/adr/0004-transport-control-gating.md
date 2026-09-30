# ADR 0004: Version gating for transport controls

Status: Proposed; capability claims and downgrade rules clarified by ADR 0008 (Phase 1I). No runtime negotiation change is authorized.

Use feature ID `transport-control-v1` only after an approved capability negotiation binds both complete offers and the selected version to a fresh authenticated transcript, and gate use by an opt-in connectivity flag. The current relay-join `protocolFeatures` exchange is transient peer-asserted metadata: it is not authenticated negotiation and alone is insufficient to authorize control-frame use. For offline admission, bind offered/selected versions in the reviewed transcript. Do not send unknown controls to old clients. Define strict frame discrimination with cross-platform fixtures. Unknown controls are not chat, do not update verification/mode, and do not degrade the message session. Preserve relay-only behavior if optional negotiation is absent or fails.

Before implementation, characterize the existing TS and Kotlin unknown-frame behavior. Decide exact parser boundary and old-client fallback in Phase 1. Do not change existing frame format in Phase 0.
