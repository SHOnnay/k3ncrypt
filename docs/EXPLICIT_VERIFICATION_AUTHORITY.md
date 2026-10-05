# Explicit contact verification authority

Verified means this client recorded the user's explicit comparison of the exact current peer identity. Pin means an identity is saved for cryptographic continuity checks. A pin, saved contact, encrypted session, successful call, network route or remote claim never establishes verification.

Both main clients use four semantic outcomes: unverified, verified, identity changed pending review, and unknown/unavailable. Only verified for the exact unchanged current identity permits normal verified calls. Each device owns its local decision; there is no verification synchronization or server-wide verified flag.

## Android

`ContactVerificationAuthority` uses the existing encrypted Room `CryptoStateStore` record namespace `contact-verification-v1`, keyed by stable conversation UUID. Schema v1 is a bounded binary record containing current observed fingerprint, optional explicitly verified fingerprint, and sticky pending-review flag. It stores no private keys, capabilities or routing addresses. An absent record for a known pin is unverified; corrupt/unreadable/future-version or unknown identity is unknown and denies calls. Existing pins are never migrated to verified.

The existing contact comparison area displays the pinned fingerprint. The user enters the exact independently compared fingerprint and presses **I have verified this fingerprint**. The repository checks the current published bundle against the pin and records only that exact explicit decision. **Mark unverified** removes the verification decision while preserving the contact and any pending identity review.

Observed identity changes invalidate the verified outcome before pin acceptance. A record mismatch also denies calls immediately, even before an observation write. The pending-review flag persists across restarts and does not disappear when an older identity is observed again. Reverification requires an explicit exact-identity comparison. Routes are deliberately absent from this authority.

Existing conversation pin replacement and encrypted-session rules remain strict. This branch does not silently adopt an observed replacement key, rebind existing ratchets, or discard queued messages. The UI directs changed-key users to review a fresh invitation/contact binding before verifying it. In-place old-conversation key rotation remains an existing identity/session repair limitation; the authority itself supports exact-identity re-observation and explicit reverification, without making a saved old pin authorized for a new key.

The singleton messaging repository owns the authority. Its mutex serializes verification actions with protected call reads/sends; the authority mutex serializes record reads and mutations. Each identity/decision/review tuple is persisted as one encrypted record, so a split identity-plus-boolean write is impossible. Reads compare exact identity and fail closed on mismatch. This is one app process's local authority, not a multi-process or synchronized database service.

## Web

The existing `ContactIdentityRegistry` remains authoritative. It stores exact identity ID/public key/algorithm, explicit verification and timestamp, and pending change material in protected `contact-identity` records. First observation is unverified regardless of the remote flag. Identity change downgrades verification and requires review. Accepting a pending identity leaves it unverified. Explicit verification refuses unresolved change and the app supplies the exact fingerprint that was displayed for comparison. Reset leaves the contact and pending-review state intact. Recovery reset retains its existing authority.

Registry operations serialize per shared storage object; production storage uses atomic compare-and-swap for record updates, rejecting concurrent changes. A call composition now queries current local registry state rather than retaining verification as a creation-time snapshot. The exact identity captured by the composition must still match the registry identity. Unknown/corrupt/missing state fails closed. The main legacy conversation path has no equivalent authority, so its app call launch/incoming admission is refused; legacy SDK wire support remains compatibility code.

## Call admission and visibility

Android outgoing launch, incoming signal admission, acceptance and protected sends use the repository authority API. Verification loss/change closes the active Android call. Web launch/media preparation, encrypted incoming admission, accept and further protected signaling use current local verification and existing device/session authority. Verification UI reset/change disposes the app's call media. Call code never marks contacts verified.

The existing signaling `sender.verification = verified` field is preserved with its digest/encoding for compatibility. It is only a legacy schema value required by the old format. It is not evidence about the receiver's local decision. A matching pin or a remote verified assertion against local unverified/changed/unknown state is rejected before admission. Unsupported/false wire values remain rejected by existing parsers; no wire or crypto redesign occurs here.

Visibility reads the authority: Verified only for the exact locally verified identity, Unverified for pins without a decision, Identity changed · review required for pending changes, and Verification unavailable for unknown state. Pin, relay connection and verification remain separate details. Verified does not prove remote presence, delivery, current global revocation freshness or unrestricted call security.
