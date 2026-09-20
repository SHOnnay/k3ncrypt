# Modern Default Controlled Rollout Plan

## Scope

This plan controls how new conversations may move from the current legacy default to modern E2EE. It does not migrate existing conversations and does not change Vodozemac, identity storage, mailbox, attachment/media, or message protocol internals.

## Policy values

- `legacy-default`: create legacy conversations; this remains the repository and production fallback.
- `modern-explicit`: modern conversations are available only through the existing explicit setup path.
- `modern-default-beta`: create modern conversations for an approved beta/canary cohort only.

Unknown values, including the retired `modern-default` spelling, fail closed to `legacy-default`.

## Stages and gates

1. **Foundation (current)** — keep `legacy-default`; run migration, downgrade, identity-change, QR parsing, and restart tests in CI.
2. **Explicit modern** — allow opt-in modern conversations for internal users and security testers. Require verified identity review and collect only aggregate success/failure metrics.
3. **Beta default** — set `modern-default-beta` for a small, explicitly approved cohort. Persist the selected mode at creation. Monitor failures, recovery requests, browser compatibility, and session establishment without logging content, keys, QR payloads, or tokens.
4. **Expansion** — increase the beta cohort only after a security review signs off each gate and legacy compatibility remains intact.
5. **Production decision** — a separate approval may introduce a production modern-default value after the beta has demonstrated reliable recovery, multi-device behavior, and rollback.

## Invariants

- Existing conversations keep their persisted protocol mode forever; policy changes never rewrite them.
- A modern session never accepts a legacy envelope or silently downgrades.
- Rollback changes only the policy for future conversations. It does not reinterpret existing records or sessions.
- Identity changes remain pending review. QR confirmation compares public fingerprints but never grants trust automatically.
- Invalid QR input, unknown policy values, expired state, and incomplete identity review fail closed.

## Identity-change and verification UX

The client shows the previous and newly presented fingerprints, states that the reason is unknown, and offers verify again, reject, or block. Rejecting leaves the contact unverified; blocking ends the conversation. Accepting a changed identity remains an explicit action after an independent comparison and starts fresh session state through the existing modern path.

QR payloads are canonical, short-lived UI state. They contain only the version, algorithm label, and public fingerprint. They are not stored permanently, are not authentication tokens, and do not contain private keys, message content, or session material. No camera permission or scanner is introduced by this phase.

## Risks

- Browser storage loss or device compromise can interrupt recovery and requires explicit re-pairing.
- Configuration drift between deployments could create inconsistent creation policy; deployment must validate the allowed enum.
- Legacy conversations remain on their existing security properties and must not be presented as modern.
- Multi-device enrollment, revocation, and per-device verification need a production runbook before broad rollout.
- Aggregate rollout metrics can still reveal operational metadata; retain only what is necessary and never include security material.

## Rollback strategy

Set the policy back to `legacy-default` (or leave only `modern-explicit`) and stop creating new beta conversations. Do not delete or rewrite persisted mode records. Existing modern beta conversations continue using their modern session boundary; existing legacy conversations continue using legacy handling. Any session or identity failure is handled by the existing fail-closed recovery path, not by downgrade.

## Compatibility checklist

- Legacy invite and mailbox behavior unchanged.
- Modern persistence survives restart and stale configuration.
- Modern-to-legacy envelope rejection remains covered.
- QR payload parsing rejects unknown fields, invalid fingerprints, reordered JSON, and malformed input.
- Identity changes invalidate prior verification and require explicit review.
- Client production build, service TypeScript, lint, Jest, and browser validation pass for the supported matrix.

## Recommendation

Keep production on `legacy-default` for now. Use `modern-explicit` for controlled validation. Enable `modern-default-beta` only after the remaining multi-device, deployment-drift, browser, and recovery gates are signed off; do not create a production `modern-default` value until a separate security review approves the beta evidence.

