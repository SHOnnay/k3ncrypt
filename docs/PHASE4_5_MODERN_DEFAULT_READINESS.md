# Phase 4.5 Modern-Default Readiness

## Current state

K3ncrypt currently has three creation policies:

- `legacy-default` is the safe fallback and remains the active default.
- `modern-explicit` permits an existing, explicit modern-conversation setup path.
- `modern-default` is recognized as a rollout value, but is not enabled by this repository.

The persisted conversation protocol is authoritative. Modern records are versioned and stored separately from legacy conversations. A policy change must never reinterpret an existing conversation, and there is no legacy-to-modern migration. Existing conversations therefore remain immutable with respect to protocol mode.

The modern path already has identity pinning, explicit verification, identity-change detection, session invalidation on accepted changes, encrypted persistence, and fail-closed rejection of legacy envelopes at the modern session boundary. The Phase 4.5 additions are deliberately limited to pure policy-resolution and verification-data boundaries; they do not change protocol defaults, session behavior, or UI.

## Conversation-policy audit

`service/src/crypto/conversationPolicy.ts` is the single policy boundary for creation defaults. Unknown or absent configuration resolves to `legacy-default`. Only the two named modern values are accepted. The new resolver has these invariants:

1. `modern-default` selects modern mode only when a conversation has no persisted mode.
2. `modern-explicit` does not silently opt every new conversation into modern mode; an explicit caller path remains required.
3. A persisted `legacy` mode remains legacy even when the active policy becomes `modern-default`.
4. A persisted `modern` mode remains modern even if the active policy is rolled back.
5. No resolver writes or migrates records. Persistence remains the responsibility of the existing conversation flow.

The default is intentionally not switched in Phase 4.5.

## Changes needed before a modern-default rollout

- Keep `legacy-default` while compatibility, browser, deployment, and recovery gates are incomplete.
- Roll out in stages: explicit modern usage, internal/canary modern-default, then a measured default for new conversations.
- Make the rollout decision a single, auditable deployment configuration. Client and service configuration drift must fail closed rather than selecting a different protocol silently.
- Persist the selected mode at creation and treat it as immutable thereafter. Rollback changes only the policy for future conversations.
- Require successful modern-session, storage-restart, identity-change, and multi-device tests in every supported browser before enabling the default.
- Retain a clearly bounded legacy compatibility path for existing records; do not add a migration job.

## QR verification foundation

`service/src/identity/verificationFoundation.ts` defines a canonical, versioned public payload:

```json
{"version":1,"algorithm":"vodozemac","fingerprint":"K3 ..."}
```

The encoder emits one deterministic key order. The decoder validates exact keys, version, algorithm, size, and fingerprint format, and rejects reordered or augmented payloads. It carries a fingerprint only; it does not contain private keys, session state, message content, or capability tokens.

The foundation exposes these states: `unknown`, `unverified`, `verified`, and `changed-pending-review`. A changed identity always projects to `changed-pending-review`, even if the prior identity was verified. QR scanning, camera permissions, automatic trust, and UI are intentionally out of scope. A future UI must compare the displayed fingerprint through an independent channel and call the existing explicit verification operation.

## Identity-change recovery model

When a known contact presents a different identity, the registry preserves the prior identity, marks the contact unverified, records the pending identity, and emits a change event. Sending or trusting the replacement must not happen automatically. Recovery is:

1. stop treating the contact as verified;
2. notify the user through a future presentation layer without exposing internal errors or keys;
3. compare the new fingerprint out of band;
4. explicitly accept the pending identity;
5. establish a fresh session and require fresh verification.

The existing modern conversation path invalidates the old session when a pending identity is accepted. Rejection or unresolved review must remain fail-closed. There is no silent key replacement and no recovery based on a password, server assertion, or plaintext token.

## Multi-device implications

Identity and session state are device-local encrypted records. A new device must be added through an explicit, authenticated pairing/recovery flow; it must not clone private identity material through QR data or automatically inherit a verified state. Each device identity change requires fresh review.

Device lists, cross-device session fan-out, and recovery UX are not implemented here. Before modern-default, the product must specify how a conversation identifies a device, how removed devices are revoked, how verification state is represented per device, and how offline messages are handled while a device is pending review. Any ambiguity must block rollout rather than fall back to trust-on-behalf-of another device.

## Threat boundaries and risks

- Legacy protocol handling remains a compatibility risk; modern-default does not make old conversations modern or change their security properties.
- Environment/configuration drift could create inconsistent defaults if deployment does not enforce one policy value.
- First-contact trust is still unverified until users explicitly verify a fingerprint.
- Identity changes can indicate compromise, device replacement, or an expected recovery; accepting them without an independent check is unsafe.
- Metadata and traffic analysis remain outside the E2EE boundary.
- Browser storage, tab isolation, device compromise, and malicious extensions remain endpoint risks.
- QR data is public verification material, not authentication and not proof of control of a device.

## Blockers

Modern-default should remain disabled until all of the following are complete and recorded:

- cross-browser modern conversation and restart/recovery validation;
- authenticated deployment configuration with drift detection;
- explicit multi-device enrollment and revocation design;
- reviewed identity-change UX and recovery runbook;
- production observability that records only non-sensitive policy/mode outcomes, never keys, fingerprints beyond the intended UI, message content, or tokens;
- an independent security review of the rollout and rollback procedure.

## Production recommendation

**Do not enable modern-default yet.** Keep `legacy-default` as the repository default, allow modern only through the existing explicit path, and use the new migration-safety tests as a gate. Once the blockers are closed, enable modern-default only for new conversations in a staged rollout. Persist each new conversation's mode, preserve all existing modes, and make rollback safe by changing only future creation policy. No protocol migration, crypto change, or UI trust shortcut is warranted for this phase.

