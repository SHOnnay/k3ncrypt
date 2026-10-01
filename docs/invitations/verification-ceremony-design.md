# K3NCRYPT invitation and verification ceremony design

**Status:** Design specification only. No production behavior is changed by this document. A separate cryptographic protocol review is required before implementation.

This document refines the proposed ceremony in [ADR 0001](adr/0001-qr-invitation-and-sas-verification.md). It addresses the product goal of making invitation and verification easy while preserving the meaning of **Verified**: the user has independently checked that the device identity in the current conversation belongs to the person they intend to contact.

## Recommendation

Use two separate steps:

1. **Scan invitation QR → create an unverified contact.** The QR carries the existing invitation. It starts contact setup and does not authenticate the person who shared it.
2. **Choose Verify → conduct a live, interactive SAS ceremony.** The devices exchange fresh, authenticated ceremony messages bound to the current conversation and both current device identities. Both show the same short comparison string. The people compare it in person or over an independent trusted channel, then each confirms on their own device.

Use a short, memorable word or emoji sequence, with a security-reviewed active-attacker work factor. Do not select the number of symbols until the protocol review accounts for entropy, encoding bias, repeated attempts, and attacker choice. Do not use an unbound six-digit PIN. The full fingerprint remains available as a legacy/manual method and as an advanced diagnostic; users should not need to type it for the normal flow.

Do not use the existing static fingerprint QR as the new primary verification ceremony. It is public identity data, not a challenge: it has no conversation binding, freshness, proof of current key possession, or replay protection. It can help a person compare identity values, but scanning it alone must never mark a contact verified. A future live verification QR could be an optional way to transfer a signed, short-lived ceremony offer, but it still needs authenticated response, freshness, transcript binding, and explicit confirmation. It is not needed for the initial recommended flow.

The invitation QR remains the primary onboarding mechanism. Verification uses the existing encrypted contact channel after both ends have a validated peer descriptor. If the channel cannot establish an authenticated ceremony, the UI falls back only through an explicit user choice to the existing full-fingerprint comparison; it never labels a scan, join, message, or relay receipt as verification.

## Current implementation audit

### Identity and cryptographic material

- A K3NCRYPT device identity has public Curve25519 and Ed25519 keys. The private identity/account material stays behind the Vodozemac runtime or Android native crypto handle; UI components receive public identity information only.
- Web `fingerprintVodozemacIdentity` and Android `IdentityFingerprint.generate` compute the same SHA-256 commitment over the domain string `k3ncrypt:vodozemac-identity:v1`, normalized Curve25519 public key, and normalized Ed25519 public key. The displayed `K3 ...` groups are a representation of that commitment. They are not secrets.
- Web stores observed identity keys and an explicit local `unknown`/`unverified`/`verified` state in `ContactIdentityRegistry`. A changed identity is made unverified and requires review. `ModernConversation.verifyContact` is the explicit local trust upgrade path.
- Android fetches the peer's public pre-key bundle and checks its identity against the invitation or the observed first-contact route. The Phase 0 `ContactVerification` record stores an explicit local verification decision bound to the conversation, peer route, and peer fingerprint. A missing or mismatched record is unverified. Identity private material stays in the native account.
- Both clients can produce signed control material using their identity account. The join-introduction already demonstrates Ed25519 signatures bound to conversation, sender route, and identity commitment. No SAS transcript, SAS-specific key exporter, session exporter, or verification QR challenge protocol currently exists.
- Existing Olm/Vodozemac sessions carry encrypted messages, but the session internals are not an approved cross-platform SAS key-export API. The new ceremony must not assume that Web and Android can export the same secret from a ratchet session. It must specify an interoperable, authenticated exchange using supported public-key signing and fresh ceremony contributions, or receive separate review for any exporter design.

### Invitation and verification UX

- The current modern invitation contains exactly `modern`, `control`, `address`, and `identity`; it is not signed as a complete invitation. The capability is a bearer value in the fragment. Joining validates the invitation and binds the claimed identity commitment to fetched public pre-key material. It does not prove who physically shared the invitation.
- Web has an invitation QR flow and a static verification QR payload containing only `{version, algorithm, fingerprint}`. The contact’s fingerprint is compared locally and the user separately confirms. The payload is not fresh or conversation-bound. There is no current scanner-mediated live verification flow.
- Android has invitation QR scanning/display, but the verification UI currently asks the user to compare/re-enter the full fingerprint. It does not implement SAS or consume the Web verification QR format as a verification ceremony.
- Neither platform implements SAS, bilateral ceremony state, SAS-specific capability negotiation, or a common transcript encoding. Web has a relay feature check for `join-introduction-v1`; that check is not a SAS capability and there is no equivalent cross-platform SAS negotiation. Web and Android fingerprints interoperate; a new ceremony does not yet exist to interoperate.

## Recommended user experience

### Shared lifecycle

```text
Create/share invitation QR
        ↓
Scan/open invitation → contact created · unverified
        ↓
Encrypted messaging can continue under current product policy
        ↓
User selects “Verify contact” on either device
        ↓
Both devices confirm the same live ceremony and show the same SAS
        ↓
People compare the SAS independently; each taps “Codes match”
        ↓
Each device persists its own explicit verified state
```

The contact header always says **Unverified** until the local verification store says otherwise. If only one person confirms, that device may show **Verified on this device** and **Waiting for their confirmation**; it must not imply the other device has verified. A peer's confirmation is useful ceremony progress but cannot write local trust state.

### Web flow

1. The inviter shares the current invitation QR/link. Display a short warning that it adds a contact but does not verify the sender.
2. The joiner scans/opens it; strict existing parser and identity checks create an unverified contact. Do not add trust fields to the invitation QR.
3. On the conversation, either person chooses **Verify contact**. Show who and which device identity is being verified, using the local display name only as a recognition hint.
4. Exchange ceremony messages over the current authenticated encrypted conversation. A capability check and cryptographic validation complete before showing the SAS.
5. Show the short SAS in large, accessible text with an audio/screen-reader equivalent that does not reduce the entropy. Prompt users to compare directly, or via a channel they independently trust. The same conversation being verified is not an independent comparison channel.
6. Each person chooses **Codes match**. Mismatch, cancellation, timeout, disconnect/restart, or binding change leaves the contact unverified and offers a fresh restart.

### Android flow

1. Scan the existing invitation QR using the current invitation parser. Contact creation remains unverified and does not set the verification record.
2. Show **Verify contact** beside the unverified status after a validated peer descriptor is available. Do not require fingerprint retyping during join.
3. Reuse the same protocol version, transcript, role ordering, string mapping, capability rules, and confirmation semantics as Web. Keep signing private keys in the native account handle; only signatures and public contributions cross the UI boundary.
4. Present and confirm the SAS with the same accessibility behavior as Web. Persist verification only after the local user explicitly confirms the current successful ceremony.
5. If the ceremony is interrupted or Android loses process state, discard transient ceremony secrets and require a fresh ceremony. Persist only the final trust decision and any non-sensitive audit/version metadata.

### Web ↔ Android flow

All wire fields, canonical bytes, role ordering, identity normalization, transcript hashes, SAS mapping, expiry rules, and state transitions must have shared fixtures consumed by TypeScript and Kotlin. No platform-specific rendering or string ordering may affect the computed SAS. Both clients must validate the same current public identity pair and conversation ID before rendering the code.

Capability negotiation must be mutual, authenticated, and scoped to the current peer/conversation. Do not infer SAS support from user-agent, relay metadata, or a successful invitation parse. With an old peer or unsupported feature, do not send new ceremony frames; label the legacy fingerprint method and let the user choose it explicitly. No silent trust upgrade or protocol downgrade is allowed.

## Protocol and security requirements

The following are requirements for a future protocol review, not a proposed wire implementation.

### Ceremony binding

The canonical ceremony transcript must bind, at minimum:

- protocol name, version, and ceremony method;
- conversation identifier and an unambiguous local conversation binding;
- both full current identity fingerprints and the underlying public identity keys or their validated commitments;
- sender/receiver roles in a deterministic order, independent of which side initiated;
- fresh contributions from both participants, with a reviewed commitment/reveal or equivalent anti-adaptation construction;
- authenticated channel/session context sufficient to reject a ceremony copied to another conversation or session generation;
- unique ceremony identifier, one-use state, creation/expiry constraints, and both sides' confirmation results.

The exact transcript fields, whether ephemeral key agreement is required, the derivation primitive, the SAS bit work factor, and the key-confirmation exchange remain cryptographic decisions. They require a separate ADR and review. Do not derive a SAS from public fingerprints, invitation fields, or a one-sided nonce alone. Do not export an Olm ratchet secret unless a separately reviewed cross-platform API and lifecycle are designed.

### Authentication, freshness, and confirmation

- Authenticate each ceremony contribution to the exact public identity key already validated for that contact. Prefer the existing identity signing capability if review confirms its API and canonicalization are safe for this purpose. The verifier must validate signatures and conversation/session binding before displaying a SAS.
- Contributions must be fresh and unpredictable. Commit before reveal, or use another reviewed method that prevents either participant or an active attacker from choosing its contribution after learning the other participant's value.
- Expire ceremonies, limit attempts, reject duplicate/replayed phases, and allow only one live ceremony per contact binding. Restart creates a new identifier and new contributions.
- Confirmation must be local and explicit on each device. A remote “confirmed” event cannot auto-confirm locally. Persist local `VERIFIED` only when the local user confirms a matching SAS for the current valid transcript. If a remote confirmation has not arrived, present local and remote states separately.
- Code equality by itself is not enough if the transcript fails authentication. Never show a valid-looking SAS before every required validation succeeds.

### Data safe for a verification QR

The current static fingerprint QR carries public data only, but is stale/replayable and not contact-bound. It is not adequate as a ceremony token.

If a future design adds a live verification QR, it may contain only bounded public ceremony data: protocol/version, ceremony ID, conversation binding, both expected identity commitments, role, fresh nonce/commitment, optional ephemeral public key, expiry, and a signature under the expected device identity. It must not contain invitation capability, private key, Vodozemac pickle, profile/contact list, secret contribution, or a trust decision. The receiving app must compare the QR's identity and conversation to the already open contact, validate signature and expiry, and complete a fresh authenticated response. A QR copied to another contact/session or replayed after use must be rejected. This QR would be a transport for ceremony data, not proof by itself.

### Interruption, identity change, and replacement

- On cancel, SAS mismatch, timeout, app restart, network loss, concurrent ceremony, or partial exchange, discard ephemeral material and leave local verification unchanged. Expose **Try again** and **Codes differ**; never silently retry the same transcript.
- If a public identity key, route-to-key binding, conversation binding, or authenticated session generation changes during a ceremony, invalidate it. A route change alone must not be accepted as the same identity without current bundle verification.
- If the identity key changes after verification, clear/downgrade the corresponding verification under existing identity-change behavior, show **Identity changed · review required**, and require a new ceremony. Never transfer verification to a replacement device or key based on the same nickname, invitation, account label, or route.
- Device enrollment/revocation and trust epoch changes need explicit binding rules. A device identity is the subject of verification; account/device-list approval is a separate trust decision and cannot substitute for person-to-person verification.

### Threat analysis

| Threat | Required behavior |
|---|---|
| Invitation substitution / QR interception | The invite remains an unsigned bearer invitation. Joining creates an unverified contact. A substituted invitation leads to different expected identity material; the live identity-bound SAS will differ when the users compare with the intended person. QR scanning never upgrades trust. |
| Active relay or network MITM | Relay may deliver, delay, duplicate, drop, or reorder ceremony frames but cannot forge identity-authenticated contributions. The authenticated channel and signed transcript must bind the exact peer identities and conversation. A relay cannot set a user's local verified state. |
| SAS replay | Bind SAS to both fresh contributions, ceremony ID, conversation, identities, and current session context; enforce single-use and expiry. Old SAS values must never be reusable. |
| Static/stale QR replay | Static fingerprint QR only compares a persistent public identity and proves no fresh possession. It cannot complete the new ceremony. A live QR, if later selected, must be signed, short-lived, single-use, and answered over the bound channel. |
| Device replacement / identity change | A new key produces a different fingerprint and transcript. Existing verification is downgraded; require a new ceremony. Never migrate verified state from an old key automatically. |
| SAS guessing, grinding, repeated attempts | Review entropy and bias against active attackers; bind both contributions with commit/reveal or reviewed equivalent; rate-limit attempts/restarts and alert on repeated mismatches. Choose exact SAS length only after analysis. |
| Downgrade to an old protocol | Require authenticated mutual capability. If the peer lacks support, do not start SAS or send unsupported frames. Clearly offer the current full-fingerprint comparison as a user-selected legacy method, and retain unverified until that method is explicitly completed. |
| Cancellation or one-sided confirmation | Keep per-device verification independent. A local confirm does not authorize remote trust. If a completion ACK is missing, report local verification and remote state separately; do not claim both confirmed. |
| Malicious or confused UI | Bind the code to the displayed contact, show identity-change warnings, prevent a second conversation from reusing the active code, and require explicit match confirmation after successful authentication. Names, avatars, routes, message delivery, and calls are not proof. |

## Compatibility and migration

- Invitation payload, link fragment, QR rendering content, relay behavior, message format, and Vodozemac sessions remain unchanged.
- Existing Web verification records remain local verified/unverified records as currently stored. Do not reinterpret a static verification QR as ceremony completion.
- Android Phase 0 stores explicit local verification tied to route and fingerprint. Existing Android records with no explicit marker remain unverified and require re-verification; do not infer verified status from old route/fingerprint fields. This is a safe downgrade, not an identity migration.
- Old Web/Android clients must not receive SAS control frames until mutual support is authenticated. They continue using the existing full-fingerprint comparison when the user selects that method. Unknown capability, malformed feature claim, interrupted negotiation, or unsupported version leaves the contact unverified.
- After a verified identity changes, both old and new code paths must fail closed: old persisted state cannot authorize a changed fingerprint. Mixed-version tests must demonstrate this before rollout.

## Implementation phases

### Phase 0 — Architecture and state audit (complete for this design)

Record existing fingerprint inputs, local trust stores, join and identity-change transitions, and Web/Android differences. Keep QR invitation as onboarding and contact verification distinct.

### Phase 1 — Cryptographic protocol ADR and review

Specify exact signed ceremony messages, canonical transcript encoding, role ordering, session/channel binding, fresh contribution construction, replay rules, expiry, SAS entropy/mapping, attempt limits, local/remote confirmation semantics, and identity-change invalidation. Resolve all open questions below. Independent security review is a release gate.

### Phase 2 — Cross-platform protocol fixtures and pure verification engine

Create shared accepted/rejected transcript fixtures and independent TypeScript/Kotlin implementation tests. Test byte-for-byte canonicalization, signatures, transcript derivation, SAS output, role symmetry, stale/replay rejection, and failure cleanup. No UI enables the feature in this phase.

### Phase 3 — Capability negotiation and authenticated control transport

Add mutually authenticated capability negotiation and versioned, bounded, authenticated ceremony frame handling over existing E2EE conversation transport. Do not alter message encryption, delivery ACK meaning, session creation, invitation parsing, or relay authorization. Old clients receive no new frames.

### Phase 4 — Web and Android ceremony UX behind a disabled-by-default feature gate

Add **Verify contact**, pending/progress/mismatch/cancel/timeout states, short SAS display, accessible comparison, bilateral state display, and explicit local confirmation. Keep legacy full-fingerprint method available. Verify nothing on join, QR scan, incoming message, session establishment, or peer confirmation alone.

### Phase 5 — Interoperability, migration, and staged enablement

Run Web↔Web, Android↔Android, Web↔Android, mixed-version, identity-change, interruption, replay, and attack simulations. Enable the capability only after review and rollback checks. Existing verified contacts retain only the platform's existing local evidence; missing or mismatched evidence downgrades to unverified and requires comparison again.

## Test matrix

| Area | Cases | Required result |
|---|---|---|
| Invitation boundary | Scan valid invitation; substitute invitation; malformed/duplicate/oversized fields | Contact is created only after current parser/identity checks; it is always unverified. No invitation field claims trust. |
| Fingerprint parity | Shared Curve25519/Ed25519 vectors; key normalization; Web and Android | Exact same fingerprint on both platforms for the same public keys; any changed key gives a different value. |
| SAS transcript parity | Both role orders; Web↔Web, Android↔Android, Web↔Android; canonical JSON/bytes | Both participants compute byte-identical transcript and SAS only for the same authenticated ceremony. |
| Authentication | Wrong signing key, invalid signature, changed identity, altered conversation, changed route binding | Reject before showing SAS; local trust unchanged. |
| Active MITM | Invitation substitution; separate sessions to each endpoint; frame modification; contribution grinding | The intended in-person pair sees mismatch or authenticated rejection; no trust upgrade. Test active attack work-factor assumptions. |
| Freshness/replay | Replay start, commit, reveal, completion; stale QR; expired challenge; duplicate frames | Reject idempotently or reject as replay; do not reuse SAS or mutate verification state. |
| User decisions | One side confirms; both confirm; one cancels; mismatch; remote forged confirm | Only each local explicit confirmation affects that device. UI never claims bilateral completion prematurely. |
| Restart/network | Process death at every ceremony stage, disconnect, reconnect, retry | Ephemeral ceremony is discarded; persisted contact stays at prior trust state; restart requires a fresh ceremony. |
| Identity lifecycle | Route changes, identity key rotates, device revoked, session replaced, contact deleted/restored | Invalidate ceremony; downgrade verification where current policy requires; require fresh identity review. |
| Capability/downgrade | Old client, absent feature, malicious feature claim, malformed version, negotiation interruption | No SAS frame sent to unsupported clients; explicit legacy path only; never silently upgrade trust. |
| QR privacy | Capture invitation QR, live QR if later added, clipboard/history/log inspection | No private keys, SAS secret, stable unrelated metadata, or capability leakage beyond existing invitation behavior; no QR contents in logs. |
| Accessibility | Screen reader, high contrast, localization, large text, switch access | Same comparison value and explicit decision available without relying on color or tiny visual details. |

## Unresolved decisions and release gates

1. Exact protocol: signed nonce exchange versus ephemeral signed key agreement, and whether a reviewed channel exporter is necessary. Do not assume the current Olm session can export a safe cross-platform secret.
2. Exact anti-adaptation construction, ceremony transcript schema, canonical encoding, roles, session generation binding, and how to bind the conversation if route/room identifiers can change.
3. SAS representation and active-attacker work factor: word/emoji list version, bit count, bias analysis, repeated-attempt limits, and localization/accessibility behavior.
4. Whether local verification is persisted immediately after that user's successful SAS confirmation or only after authenticated peer completion; UI must still report local and remote states independently.
5. Exact invitation expiry/revocation semantics remain outside this ceremony. The existing invitation has no proven absolute expiry; do not derive ceremony freshness from invitation age.
6. Capability negotiation source and rollback policy for currently deployed Web/Android beta versions. Peer feature claims must be authenticated and downgrade-resistant.
7. Whether to retain, improve, or remove the current static Web fingerprint QR after live SAS ships. It must not be relabeled as SAS or treated as equivalent without a separate review.

Until these decisions are resolved and reviewed, keep the existing fingerprint-comparison method, require explicit local confirmation, and leave QR joins unverified.
