# Path eligibility v1

Status: proposed pure policy function. It cannot mutate verification, identity or session state.

A new LAN or direct path is eligible only when all are true:

1. Existing contact is `verified` and `unchanged` in the current registry.
2. Local device lifecycle is active and required freshness checks pass.
3. Existing conversation session health is healthy.
4. Global path preference and per-contact path preference are enabled.
5. Adapter supports the requested path and privacy policy permits its address disclosure.

Otherwise the result is ineligible with a bounded reason code. Recompute at every connection attempt and on verification, identity, lifecycle, session-health or preference changes; tear down a path when eligibility is lost. Relay remains available under its existing authorization model.

`protocol-fixtures/v1/path-eligibility.json` is a language-neutral table for TS/Kotlin fixture-shape characterization in Phase 0 and semantic conformance later. Contact name, route presence, LAN presence and prior successful connection never establish eligibility.
