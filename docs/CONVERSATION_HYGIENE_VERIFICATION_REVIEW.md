# Conversation hygiene and human verification review

Prior review status: the eight-digit short-code implementation stopped at the requested security boundary. The subsequent authorized continuation implements conversation hygiene and QR-first presentation only. Canonical base: `58c4fd4bb77b51d1ad21eda659724913d42f6c39`. Review branch: `fix/conversation-hygiene-verification`. The short-code protocol below remains a proposal for review, not an audited or implemented protocol. Existing verification cryptography and authority remain unchanged.

## Reproduced conversation defect

A Playwright probe created two independent accounts against disposable Mongo and the real Web/backend. Each account had **one** ordinary conversation row before any invitation acceptance. After refresh/unlock each still had one row, labeled `Contact ·` plus a generated suffix. The probe passed in 4.2 seconds (8.8 seconds including startup). These observations reproduce the phantom-row symptom; they do not establish which particular expired/corrupt record exists on a user's live device.

Exact creation path:

1. `SetupOverlay.handleModernCreate` calls `createModernChannel` even for account creation (SetupOverlay.tsx:183).
2. `ChatContext.createModernChannel` allocates a room, opens the vault, constructs a `Private contact` descriptor without a peer, connects, and unconditionally persists that descriptor (ChatContext.tsx:425–434).
3. `readConversationDescriptors` validates descriptor shape, not the underlying relationship/session/contact records. `Sidebar` and `WorkspaceSection` project those descriptors directly.
4. `contactDisplayName` turns a generic descriptor label with no authenticated profile into `Contact ·` plus a room-derived suffix (copy.ts:28–34).
5. `restoreSession` projects all saved descriptors before attempting connection. Thus an unaccepted account/invitation bootstrap room survives refresh as an ordinary contact.

Other index writes are invitation join, authenticated contact-route updates and explicit nickname updates. Removal deletes the selected descriptor. Legacy join does not use this product index. No sample/default contact generator is needed to produce the observed row. Partial creation can leave durable vault/mode/publication state; failed joins and old index entries require validation rather than automatic deletion. Pending invitations must remain recoverable and distinct from accepted relationships.

The invalid-selection bug is also visible directly in code: `openConversation` clears messages, then `connectModern` closes the previous session and changes global recovery/message state **before** candidate connection succeeds. Its catch marks the global session unhealthy/blocked. A malformed history can throw before that catch. Therefore failure can poison a previously valid selection.

An existing restore error, `This private invitation expired. Create a fresh conversation to continue.`, is emitted when a persisted local pre-key address cannot be fetched. A focused probe confirms it maps to `UNKNOWN_SAFE_FAILURE`. A live user's exact underlying failure still requires bounded stage evidence; a failed fetch can also mean transient connectivity, so it must not be mislabeled as proven deletion/expiry solely from that catch.

## Proposed bounded conversation repair

- Separate account identity/device bootstrap from creation of an invitation relationship. Account creation should persist identity/device/profile state, not a normal conversation row.
- Preserve pending invitations separately, including their protected capability and durable room state. Promote only after the existing authenticated relationship introduction establishes peer mapping. Do not fake a session, auto-accept a peer or automatically destroy an old bootstrap room.
- Decode the index per entry. Preserve the original encrypted bytes. One malformed entry must not prevent intact entries from loading; duplicate entries need bounded quarantine rather than destructive rewriting.
- Classify saved entries as usable relationship, legitimate pending invitation, or unavailable/recoverable. Inspect the descriptor, strict modern mode record, local routing ownership, expected remote route, canonical contact registry, and protected session record/reference. A changed identity remains visible for review but untrusted. A valid pending introduction is distinct from a broken missing session. Do not require verification just to display a genuine chat.
- Use local encrypted quarantine metadata for unavailable entries; do not move/delete their encrypted history, session or keys. Normal Chats excludes them. Advanced recovery shows only a generic explanation and bounded reason. No clickable recovery item invokes normal conversation opening. No deletion action until its exact scope and recovery consequences are defined and explicitly confirmed.
- Validate a candidate and prepare its history without mutating the active selection. Stage callbacks behind a generation fence. Commit active session/contact/history only after success. If transport constraints require temporarily closing the old instance, restore it on candidate failure, or return safely to Chats if restoration fails. Late callbacks must not mutate a different active conversation. Quarantine a known corrupt entry without downgrading any valid contact.
- Test actual acceptance and invitation reopen, multi-contact independence, valid sending after a failed candidate, malformed records, refresh and browser reopening before integrating.

Proposed diagnostic mapping, emitted at actual boundaries rather than by loose error-message inference:

| Boundary | Bounded code |
| --- | --- |
| Descriptor/index entry invalid | CONVERSATION_RECORD_INVALID |
| Required protected session record absent | CONVERSATION_SESSION_MISSING |
| Room authoritatively unavailable | CONVERSATION_ROOM_MISSING |
| Required canonical contact absent | CONTACT_REGISTRY_MISSING |
| Descriptor/mode/peer mapping inconsistent | ROOM_MEMBERSHIP_MISMATCH |
| Partial relationship state | CONVERSATION_STATE_INCOMPLETE |
| Candidate restore fails without a narrower proven cause | CONVERSATION_RESTORE_FAILED |
| Transient fetch/connection fails | NETWORK_FAILURE |

No raw exception, room/transfer/database identifier, fingerprint, filename/path, token, key or message content belongs in logs or these recovery rows.

## Verification review: why implementation stopped

The existing `deriveHumanVerificationCode` computes SHA-256 of the domain-separated canonical sorted **complete** fingerprints and displays six decimal-encoded 16-bit words: **96 comparison bits**, not an eight-digit OTP. Existing QR payload version 1 contains the complete fingerprint and algorithm; strict matching compares the pinned identity. Locally bundled `qrcode` and `@zxing/browser` already implement real QR generation and camera scanning. The primary UI currently also permits the weak human action `Codes match`; this pass has not changed it.

An eight-digit decimal space has 100,000,000 values, approximately **26.575 bits**. A static fingerprint-derived code repeats for the same pair forever. An active attacker can search identities offline; local input throttling cannot limit that search. With control of both substituted identities, matching the two views can admit birthday-style search on the order of the square root of that space; the exact attack depends on the supported key/identity constraints. Therefore 1 in 100,000,000 must not be advertised as the total active-MITM security of a static construction.

RFC 6189 section 4.4.1.1 explains why short SAS security depends on commitment before an attacker learns both honest contributions; without that, the attacker can search for colliding values. Reference: https://www.rfc-editor.org/rfc/rfc6189.html#section-4.4.1.1

The current verification foundation has no synchronized verification-session commitment/reveal exchange. Adding one is a meaningful trust-protocol change. Merely adding unsynchronized local randomness makes the devices disagree; merely sending unhashed nonces allows adaptive choice. Replacing the existing 96-bit comparison with a static eight-digit hash would weaken comparison assurance. Both conflict with this request's security boundary, so no eight-digit trust ceremony is implemented.

## Minimal protocol requirements for review, not implementation authorization

A new session-bound short-code protocol needs a reviewed commitment/reveal state machine, preferably an established SAS design rather than an improvised exchange:

1. Explicit user initiation and peer acceptance; version, relationship scope, session identifier, roles, full local/pinned-peer identities and expiry bound throughout.
2. Fresh CSPRNG contributions on both devices, committed before either side reveals. The commitment must lock the intended identity transcript and random contribution. Freeze identity snapshots; abort on any trust/pin/relationship change.
3. Strict ordered states, both commitments received before reveal, commitment verification, duplicate/replay handling, crossed-initiation handling, bounded lifetime and restart behavior. New attempts use fresh contributions. Account for simultaneous sessions and an adversary forcing restarts; do not claim local typing throttling bounds protocol attempts.
4. Only after that exchange passes, derive SHA-256 over a canonical, domain-separated/versioned transcript containing **both complete identities and both fresh contributions**, with explicit role ordering. Exact encoding and fields require review and test vectors before coding.
5. Unbiased decimal conversion can use a digest stream of big-endian 32-bit words: accept a word only below 4,200,000,000, then take remainder modulo 100,000,000 and zero-pad to eight digits, grouped 4+4. Exhausting the digest requires a reviewed domain-separated counter expansion, never a biased fallback. This specifies a candidate encoding, not a complete reviewed SAS protocol.
6. Conditional on a correct commitment protocol constraining an attacker to a single independent attempt, accidental match/guess probability is 1/100,000,000. Repeated attempts increase risk. The short code is public comparison evidence, not a password, server proof or identity authority. Session completion must not automatically verify.
7. Manual input: no simultaneous expected-code display and match button. Separate show/enter roles, exact eight digits, mismatch leaves trust unchanged, bounded local attempts and temporary cooldown without permanent lockout. Clear matches on identity/session change. A correct entry enables a separate explicit final confirmation tied to the full pinned identity.
8. Remote exchange uses a channel already trusted or an in-person/known voice interaction. The same unverified chat is not independent identity proof.
9. QR remains the safe full-identity nearby method: explicit show/scan controls, strict complete pinned-identity matching, no automatic verification, final confirmation, camera cleanup on navigation/unmount, advanced-only payload fallback and no remote service. Existing unchanged verified contacts need no migration/reverification.

A protocol-free alternative is deliberate entry of the existing six 16-bit groups (30 decimal digits, 96 comparison bits) plus final confirmation, with full-identity QR as the primary nearby method. It is longer than the requested eight digits and should be selected explicitly rather than silently substituted.

## Unlock usability note

Repeated refresh unlock is inconvenient to the owner. A future design should review remembered unlocked/device sessions on Web and routine Android startup without requiring full unlock every launch. No unlocking policy or security strength is changed here.

## Prior review delivery state

No product fix, new protocol or dependency was added. No commit, push, canonical fast-forward, Render deployment or Android work was performed. Canonical branches remain at the expected base. The requested review branch is retained locally. Reproduction probes are observational and are not claimed as passing fixed-behavior regressions. Full implementation validation is not run because implementation stopped at the explicit security condition.

## Authorized continuation: bounded implementation

The continuation explicitly excludes short-code cryptography. Account/invitation creation persists an invitation lifecycle hint, not an accepted relationship. One read-only eligibility rule (`client/src/product/conversationEligibility.ts`) requires a valid descriptor, valid modern room mode/local routing ownership, matching peer/contact mapping and a protected session reference. Lifecycle hints and names are not authority. Old records without a hint are classified from their actual protected records. Changed identities remain available for review but retain the existing unverified state.

Unavailable and pending records are excluded from ordinary Chats, with a conditional secondary "Unavailable conversations" disclosure. The original encrypted index, session, history and identity data remain intact during classification. The unavailable projection is reconstructed locally on each unlock; it is not a server record or cross-device recovery service. Individual malformed entries do not block intact entries. Normal index updates preserve malformed entries rather than silently dropping them. No new removal action is provided because safe deletion/recovery scope is not established.

Restore/open boundaries check authoritative room state; confirmed expiry/deletion is unavailable. Transient connectivity is not evidence of data corruption or expiry. Bounded response parsing and fixed error codes avoid raw diagnostic leakage. Inbound acceptance uses local classification without an extra network probe inside its durable callback.

Candidate opens serialize. History is prepared before switching; candidate callbacks cannot mutate active session/contact/message state until the candidate succeeds. The old connection remains alive through candidate resolution. Only after connection and required final state succeed does the selected-instance fence move and the old connection close. Failed candidates close their own instance and leave the old one usable. Known incomplete rows are removed from the visible projection without deleting their saved records. Pending invitations can resume during unlock when no usable relationship is selected.

Verification presentation gives "Scan their QR" primary emphasis, "Show my QR" a secondary explicit disclosure, and "Compare security code" an optional remote panel with large existing groups and a copy action. Raw fingerprint/payload fields remain under Advanced security details. A match enables a separate final explicit action. Existing unchanged verified contacts remain verified. The six 16-bit groups, derivation, strict QR payload matching, identity-change rules and file/call gates are unchanged. No OTP or verification-session protocol is implemented.

Browser regressions cover two independent fresh accounts, refresh, reopening in a new browser process, accepted invitations, invitation reopen without duplication, multiple real contacts, failed-network candidate open, missing saved session, malformed saved entry, continued sending in the intact active chat and normal reload recovery. Expired-invitation UI testing injects an authoritative EXPIRED HTTP response; it does not change server expiration policy. QR decoder coverage uses a generated QR in a synthetic camera frame, not physical camera hardware.

## Continuation validation

Final focused Jest: 41 suites passed, 1 skipped; 230 tests passed, 2 skipped. Final full Jest: 143 suites passed, 4 skipped; 739 tests passed, 9 skipped. The final Chromium gate passed all five cases: accepted account/name/verification journey, multiple relationships and invalid-open isolation with continued sending, fresh/refresh/new-process unlock, authoritative expired-invitation fixture, and real QR decoder with mismatch and explicit final confirmation. QR camera input is synthetic; physical camera hardware is not validated.

Service SDK build, client production build, lint, backend TypeScript build and git diff --check passed. The existing client chunk-size warning remains. No Android validation or production deployment observation is claimed. Earlier full-suite runs concurrent with browser traffic had backend test failures; the final isolated full-suite run is green. No backend or rate-limiter change was made.
