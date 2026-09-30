# Invitation and verification implementation plan

**Status:** planning handoff only. This branch authorizes no runtime, UI, crypto, backend, or protocol changes. Follow `docs/connectivity/HANDOFF.md` stop conditions and review gates.

## Baseline and module boundaries

| Boundary | Current owner | Planned responsibility |
|---|---|---|
| Invitation creation/parse | `client/src/context/ChatContext.tsx`, `client/src/utils/urlHash.ts`, `android/app/src/main/kotlin/com/k3ncrypt/app/MainActivity.kt` | Preserve exact four-field v1 bytes and validation; add only reviewed carrier/presentation work later. |
| Room and pre-key availability | `backend/api/chatHash/index.ts`, `backend/api/chatHash/prekeys.ts`, `service/src/api/prekeys.ts`, `android/network/.../K3ncryptApi.kt` | Keep room authorization and bundle identity checks. Do not conflate room flags with pre-key TTL. |
| Peer identity/trust | `service/src/identity/contactIdentityRegistry.ts`, `service/src/crypto/modernConversation.ts`, Android `AndroidMessagingRepository.kt` and secure storage | Contact creation stays unverified; explicit local verification is the only upgrade. Align Android's displayed trust semantics before a common ceremony. |
| Fingerprint / verification QR | `service/src/identity/vodozemacIdentity.ts`, `verificationFoundation.ts`, Android `IdentityFingerprint.kt` | Keep existing fingerprint algorithm and fallback ceremony. New SAS must not replace it. |
| Transport | Existing relay / offline mailbox | Carry authenticated ceremony controls only after reviewed capability negotiation; no LAN/direct dependency. |

## Execution sequence for a future engineer

1. **Characterization, no behavior change.** Pin the beta baseline and add Web/Kotlin fixtures for existing full-link/fragment parsing, encoding, duplicate/unknown fields, QR round trips, published-bundle identity commitment, room deletion vs seven-day pre-key expiry, and local trust transitions. Capture old↔new client behavior. Confirm Android's route-plus-fingerprint `isTrusted` UI semantics and the Web registry's durable `verified` semantics; do not assume parity.
2. **Product-only carrier iteration.** Render and scan the *existing* invitation on both platforms; provide copy/share and browser fallback. Do not add a wrapper or app-link handler until origin and fragment-handling review. QR scan creates an unverified pending contact only through existing join functions. No new dependency without review.
3. **Trust-state parity prerequisite.** Specify and test an Android explicit verification record and identity-change downgrade path that maps to the existing Web trust rules. This is a separate security-reviewed branch. Keep route pinning distinct from verified state; do not migrate or relabel existing contacts as verified automatically. Define additive migration for old Android records as **unverified until explicit confirmation** unless stronger existing evidence is demonstrated.
4. **SAS security design gate.** Write a cryptographic protocol ADR with canonical transcript bytes, role ordering, fresh contribution exchange/commitments, key/session binding, expiry, replay protection, work-factor analysis, and cross-platform known-answer vectors. Review interaction with device lifecycle and session renewal. The present ADR intentionally does **not** choose a hash truncation, word list, or wire frame. Stop until independent security review approves the construction.
5. **Capability and mixed-version gate.** Follow connectivity ADR 0008 before advertising or sending SAS controls. Define server-first rollout if relay join feature IDs change. Old clients must receive no unsupported control frames and must retain fingerprint comparison. Add a feature-off rollback path.
6. **Ceremony implementation, separately reviewed.** Add a small conversation-owned ceremony coordinator with states `not-ready → ready → comparing → locally-confirmed/failed/expired`; it reads authenticated peer identities and current session context but cannot create identity or call `markVerified` without the explicit local confirmation action. Keep SAS values ephemeral. Store only approved local audit metadata; do not log code/transcript/capability. Add Web and Android views after core vectors pass.
7. **Rollout and observation.** Start off by default with internal beta cohorts; measure only bounded failure categories and durations. Exercise retry, restart, lock/unlock, two simultaneous invitations, identity change, lost control frame, compromised QR, and server downtime. Enable wider beta only after security review and mixed-version acceptance.

## Required future interfaces (contracts, not code signatures)

- `InvitationCarrier`: render/share/open existing opaque invitation without interpreting trust; never logs or uploads the fragment.
- `ContactDescriptorReader`: return authenticated local/remote immutable identity bindings and change status; never infer verification from route presence.
- `CeremonyContextProvider`: supply fresh, authenticated room/role/device/session binding and invalidate it when any constituent changes.
- `SasCeremony`: expose bounded ephemeral state and a display value derived from the reviewed transcript; no durable trust write.
- `VerificationAuthority`: accept **local explicit confirmation** for exactly the currently observed unchanged contact identity, then persist under existing secure storage. Refuse stale or changed contexts.
- `CapabilityGate`: prevent sending new controls to old peers; relay feature hints alone are not authentication.

## Migration and compatibility

- Existing invitations and stored conversations remain readable. No v1 field is reinterpreted. A future QR wrapper, if approved, is additive and only unwraps to the existing v1 invite on compatible clients.
- Existing verified Web records remain verified only for the same unchanged identity. Android pre-existing route pins must be audited before mapping to a verified label; default to unverified for a new ceremony when proof is absent.
- A new client with an old peer uses full-fingerprint comparison. A new peer without an authenticated descriptor shows **Waiting for contact**, not a fabricated SAS. No account migration or backend data migration is part of this plan.
- Any future invitation expiry policy is separate: the current room lacks automatic expiry while pre-keys expire after seven days. Do not silently add a timestamp to the current fragment.

## Test matrix and release gates

| Test | Expected result |
|---|---|
| Web→Web, Web→Android, Android→Web, Android→Android v1 share/scan/paste | Same invitation fields and identity commitment; contact unverified after join. Two real devices are required before claiming device-to-device validation. |
| Inviter receives authenticated join introduction after the joiner sends no chat | Both sides can see an unverified peer descriptor and existing fingerprint action; no false verified state. |
| QR/link substituted, altered identity, duplicate field, wrong origin, oversized input | Strict rejection or unverified warning; no trust write. |
| Deleted room, expired pre-key, service outage, interrupted publication | Distinct safe errors; no secret in UI/logs; no unsafe automatic republish. |
| SAS known-answer vectors across Web/Android, role swap, room/identity/session mutation | Exact match only for the same reviewed transcript; mutation changes or invalidates ceremony. |
| Comparison mismatch, stale/replayed confirmation, concurrent ceremonies, lock/restart | No verification upgrade; ephemeral code removed; old fingerprint flow available. |
| New↔old client and feature flag off | No unsupported control frames; existing fingerprint verification and relay messaging work. |
| Explicit local match on both devices, then identity change | Each device independently marks the same observed identity verified; change removes active verification pending review. |

**Stop conditions:** any need to change fingerprint generation, Vodozemac/session primitives, invitation meaning, trust authority, relay authorization, or backend schema requires a new approved decision. Do not merge the SAS ceremony based on a UI-only review.
