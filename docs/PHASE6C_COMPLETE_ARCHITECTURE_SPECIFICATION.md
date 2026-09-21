# Phase 6C complete architecture specification

Status: DESIGN ONLY — NOT READY FOR IMPLEMENTATION.
Reviewed baseline: `fe59eed5576fa453407766272c594727ea81ca2c`.

## 1. Scope, evidence, and precedence

This package covers recovery, Android/iOS/desktop clients, group messaging,
group calls, metadata protection, and security operations. It defines intended
architecture and explicit gates without adding source code or changing defaults.

Inputs: [Phase 6 master specification](PHASE6_COMPLETE_ARCHITECTURE_SPECIFICATION.md),
[authority design](PHASE6B_CRYPTOGRAPHIC_AUTHORITY_DESIGN.md),
[Phase 6A report](PHASE6A_COMPLETION_REPORT.md),
[latest Phase 6B audit](PHASE6B_FINAL_SECURITY_AUDIT_REPORT.md), and the
[sync protocol](PHASE6B8_SYNC_PROTOCOL_SPECIFICATION.md).
The newer audit overrides completion claims in the 6B.8A/6B.8B reports for readiness.
Inspection confirms public raw sync acceptance, caller-supplied session identity,
optional/fire-and-forget persistence, and missing recovery in `service/src/sync/`.
Independent device identities and secure synchronized product behavior are design
goals; this document does not assume that complete behavior currently exists.

The stricter sync conflict authority decision remains applicable to own-device
membership. Phase 6C must not silently replace its prior-member barrier with a
server sequencer or timeout. See [security principles](PHASE6C_SECURITY_PRINCIPLES.md).

## 2. Target components and trust boundaries

```text
Foreground user approval / locally verified contact
                    |
       Independent device identity + encrypted vault
                    |
       Verified lifecycle, epoch and commitment gate
          /                |                    \
 Existing 1:1 core   Own-device sync adapter    New group adapter
      frozen         transactional store       reviewed MLS profile
                          |                         |
                    Platform storage          Group call admission
                    and lifecycle             endpoint media encryption
                          |                         |
                 Ciphertext relay/queue          SFU + TURN
```

Native platform shells own permissions, secure storage, lifecycle and updates.
Shared application adapters own records and authorization; reviewed protocol
libraries own cryptographic state. No UI input supplies verified peer identity.
Recovery imports eligible records into a fresh vault, never restores old live
ratchets. Groups have a separate membership domain from own-device lists.

Required interfaces are responsibilities, not claims that APIs already exist:
`VerifiedDeviceContext` resolves a peer from its authenticated session and current
scope; `AtomicSecurityStore` commits protocol state, replay evidence and journal
status with CAS; `RecoveryImporter` stages backup data; `GroupMembershipAdapter`
checks device/group authorization; platform adapters gate release and capture.
Every adapter must have an unavailable state and explicit disposal/revocation.

## 3. Full-device-loss recovery

### Selected authority and material

Choose fresh identity replacement with user-held encrypted backup material.
Do not preserve a lost identity by copying private identity keys or introducing
a recovery signing root. A surviving verified device uses normal enrollment.
When none survives, the user can recover selected data and rebuild relationships,
but cannot prove old cryptographic identity ownership solely with the backup.

Before loss, the user explicitly exports a versioned encrypted recovery archive
and stores an independently generated high-entropy archive secret offline.
The archive contains selected contacts as unverified observations, optional
retained text history, appearance preferences, provenance and deletion evidence,
plus the last observed public scope/epoch/commitment. It excludes private identity
keys, session pickles, attachment capabilities, media keys, push credentials,
OS permissions and verification flags that could confer trust.

The secret only unlocks that archive. Optional remote archive storage holds
ciphertext and opaque locators, never the secret or a password-reset equivalent.
An offline copy is the initial supported design. An authenticated, reviewed
archive encryption format/library and canonical manifest profile must be chosen
before implementation; do not invent an encryption format in application code.

### Ceremony and state transitions

`no trusted device -> local archive unlocked -> replacement pending -> contacts
reverified -> new relationships active`. Any conflict or uncertainty suspends.

1. Install an authentic client; create fresh device keys and a new local vault.
2. User supplies the archive and secret locally. Validate version, integrity,
   resource bounds and provenance; stage data without enabling sessions or trust.
3. Show the old identity observation and new fingerprint, selected import classes,
   and explicit warning that old devices may still hold data or operate elsewhere.
4. Create a fresh replacement scope/identity generation. The old public checkpoint
   is a reference only. Do not claim a valid old-scope N+1 mutation: no old trusted
   author exists. The prior master document's recovery epoch advancement therefore
   requires clarification/approval before coding; a new identity cannot forge an
   old authority chain. New-scope epoch starts from that scope's initial state.
5. Notify known contacts of a replacement *claim*. Delivery is best effort; the
   claim itself does not authenticate continuity. Each contact compares the new
   fingerprint through an independent channel, confirms replacement, blocks the
   old association, and establishes a fresh session. UI shows pending/confirmed
   per contact rather than claiming all contacts were notified successfully.
6. A newly verified group identity requests fresh group admission. Administrators
   remove all old device leaves and rekey before resuming affected traffic.
7. Atomically import eligible historical records with provenance and old expiry.
   Do not expose recovered text as a newly authenticated incoming message.
8. Produce a new recovery kit after activation; label previous archives obsolete.
   Copies of old archives remain readable to anyone holding their old secret.

### Loss, theft, replay, and limits

Stolen archive alone should expose no content under the selected cryptographic
profile. Archive plus secret exposes included history/contacts; it does not confer
automatic old identity authority. A thief can attempt social impersonation, so
contact comparison cannot be reduced to knowing recovered personal details.
Old and duplicate archives cannot reset live trust, undo deletion, or rejoin an
old group. Persist import identifiers locally; a fully reset device cannot detect
every stale archive without an independent checkpoint, so it remains unverified.

Recovery cannot remotely wipe old devices. Contacts that have not accepted the
replacement and partitioned groups may still communicate with old identities.
Fresh verification and group removal define the security cutover, not the moment
the archive was unlocked. If all devices and material are lost, data recovery is
unavailable; a fresh identity can still be created and verified independently.
Concurrent replacement claims cause visible conflict and require re-verification.

## 4. Official client ecosystem

Choose native platform lifecycle/security adapters with a shared, versioned
application conformance suite and reviewed protocol library bindings. UI framework
selection cannot bypass those adapters. Browser WASM and native library builds
must run the same vectors; actual library/platform qualification is a gate.

| Platform | Required storage adapter policy | Lifecycle and distribution |
| --- | --- | --- |
| Android | OS Keystore wrapping key; use hardware backing when validated; encrypted app-private vault | Signed releases; exclude live identity/session data from automatic restore; opaque push hints |
| iOS | Device-bound Keychain protection; use available hardware protection for supported operations | Signed releases; explicit backup exclusion; foreground enrollment and bounded background work |
| Windows | User/device-bound OS credential protection; TPM-backed wrapping when supported | Signed installer/update; per-user ACLs; lock/resume tests |
| macOS | Device-local Keychain wrapping; supported hardware isolation where available | Signed/notarized package; sandbox and unlock lifecycle tests |
| Linux | Secret Service where available plus encrypted local vault; optional qualified TPM adapter | Signed packages; secure file permissions; passphrase-locked mode if no suitable secret service |

These are required platform policies, not assertions that every OS/hardware
combination supports the same key algorithm. Non-exportable wrapping keys may
protect exportable encrypted Vodozemac state; do not claim all protocol private
keys run inside hardware. Select minimum OS versions and API access controls using
the qualification gate. Failure of the secure adapter disables enrollment until
an explicit passphrase-protected supported mode is chosen; never plaintext fallback.

Install creates a pending independent identity. First access means either creating
a new user scope or explicitly pairing to an existing one; there is no new central
password account. Enrollment binds fingerprints and current membership, then
sync requires separate export/import consent. Removal first commits revocation
and propagates fences; local deletion drops wrapping keys and best-effort files.
Uninstall by itself is not distributed revocation. Flash copies and stolen data
cannot be reliably remotely erased.

Vault locking, suspend/resume, reinstall, clock rollback, simultaneous processes,
and interrupted update must preserve replay/counters or suspend operations.
Notifications carry generic wakeups only. Contacts/location permission is absent;
media uses foreground picker/capture consent. Background network work is bounded
and carries no analytics. Microphone/camera only activate for an explicitly joined
call; camera defaults off; end, failure and lifecycle termination release tracks.
No background capture in the initial profile.

## 5. Group messaging

### Protocol choice and authority

Select MLS as the group protocol family, with one leaf per independently trusted
device. MLS provides asynchronous group key establishment with forward secrecy
and post-compromise security; application authentication and authorization still
need a K3NCRYPT profile. [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)

Pairwise fan-out duplicates ciphertext and membership work per device. Ad hoc
sender-key distribution leaves substantial rotation/compromise-recovery work.
Neither is the selected production group architecture. This does not modify the
one-to-one Vodozemac protocol or silently convert existing conversations.

Group identity is a random group ID, protocol version, genesis membership/policy
commitment and authenticated transcript. Display names are non-authoritative.
A credential binds user scope, device ID, device identity reference and authorized
group key to current lifecycle evidence. A group library's signing/ephemeral keys
are device-owned group material; their binding to the existing verified identity
requires a specified adapter and independent review, not a server certificate.

Initial policy: creator establishes visible administrators. An administrator can
propose admission/removal; the joining user explicitly consents and each new leaf
must satisfy the existing device-trust ceremony. No automatic group access merely
because a same-user device was enrolled elsewhere. Removing a user removes all
their leaves. Device revocation invalidates that device across all group bindings.
Leaving removes the local user's authorized leaves through a group transition.
Loss of all administrators blocks additions/role changes; it does not appoint
the server as replacement administrator.

### Epochs and lifecycle

Device-list epoch and MLS group epoch are distinct. Store both plus their verified
binding; a numerical match is not proof. Validate group commits against the
previous authenticated transcript and authorization policy before durable apply.
Offline queued plaintext operations require re-authorization in the current epoch.
Queued old ciphertext is not relabeled as new-epoch content.

Concurrent/forked valid commits suspend affected sending when detected. Retain
evidence; do not select a trust branch by timestamp or server preference. Exact
commit scheduling, reconciliation, and group-specific resolution semantics are
an implementation blocker. Do not pretend own-device unanimous fencing already
solves independent-user group consensus. A malicious relay can isolate consistent
views; branch detection requires peer comparison or other reviewed consistency
evidence and cannot guarantee availability during partition.

### Charlie removal example

Alice/Bob validate a removal commit excluding every Charlie device, commit the new
group state atomically, discard superseded sending material, and send only under
the new epoch. Charlie's old state cannot decrypt newly generated epoch traffic
when the library/profile and honest recipients enforce that transition. Senders
that have not learned the removal cannot promise that property yet: suspend on
stale/uncertain membership and require reconciliation. Charlie retains old copies;
an authorized colluding member can disclose new plaintext.

New members receive no historical epoch secrets. History sharing is off by default
and any later explicit export weakens history exclusion for those selected records.
Forward secrecy depends on erasure and avoiding backups of live protocol secrets;
post-compromise recovery requires an honest update after attacker access ends.
There is no protection while an attacker controls an active recipient endpoint.

Group stores transact epoch, transcript, replay state and outbound intent before
success. Ratchet uncertainty suspends; never restore a stale pickle to retry.
The group library, ciphersuite/profile, credential encoding, limits and test vectors
must be fixed before coding. Group attachment-key distribution is also gated;
existing attachment authorization does not automatically grant group access.

## 6. Group calls

Choose an SFU for scalable media forwarding with endpoint frame encryption and
client-authorized call membership. Peer mesh is simpler for tiny calls but has
per-peer uplink cost; TURN relays connectivity and does not provide group routing
or identity authority. An SFU terminates transport protection, so WebRTC transport
encryption alone is insufficient for the required server-blind media boundary.

Use SFrame as the proposed frame-encryption standard beneath a reviewed group-call
key-management profile. SFrame does not itself provide the application membership
or key distribution system. [RFC 9605](https://www.rfc-editor.org/rfc/rfc9605)

A call is a distinct cryptographic membership context: only currently joined,
authorized device leaves receive call secrets. Do not derive call secrets from a
messaging-group exporter accessible to nonparticipating members. Bind call ID,
group context, participant device, media epoch, sender/track and counter to the
reviewed media profile. Prevent nonce reuse across restart/track replacement.
Require proof of roster/key update before resuming media after participant removal.
No media-key fallback to SFU or transport-only encryption is allowed.

Participant removal pauses affected release, removes all relevant call leaves,
rotates call media material and rejects old key/counter contexts. Reconnect uses
fresh membership validation; unresolved rekey ends or suspends the call. Identity
change revokes admission pending re-verification. Key transport uses authenticated
endpoint control, never relay assertions or public URLs.

Exact MLS-to-SFrame key schedule, sender-authenticity semantics against malicious
participants, browser/native encoded-frame support, ciphersuite and replay windows
require an independently reviewed interoperable profile. They are not supplied by
the existing call implementation. Unsupported clients fail visibly before capture.
SFU/TURN see network addresses, timing, rates and routing/track information needed
to forward. Endpoint compromise or recipient recording remains possible despite
the absence of an application recording feature. No server mixing/transcription.

## 7. Metadata hardening

The server can observe connections, opaque routing/device identifiers, sizes,
queues, timing, push endpoints and inferred relationships. Encrypt message bodies,
contact names, group titles, control details and recoverable metadata end to end;
no server-held master key exists. Public authentication material remains public.

Minimize stable identifiers across unrelated contexts, log retention, directory
enumeration and push payloads. Separate relay, attachment, push and operations
access roles; do not claim unlinkability when the same operator can correlate them.
Profile fixed-size encrypted message/attachment buckets with explicit maximum
overhead and compatibility tests before enabling padding. Padding reduces size
precision, not timing or social-graph inference. Media padding has a separate
bandwidth/latency budget. Avoid silently changing frozen envelopes.

Optional proxy/anonymity routing is an opt-in future adapter. It must route DNS,
signaling and downloads consistently and prevent direct ICE candidate leakage;
relay-only calls trade peer-IP privacy for TURN visibility and cost. Global timing
observers and colluding hops remain threats. No cover-traffic default until battery,
abuse and bandwidth tests justify a bounded policy. Push-provider correlation and
mobile background restrictions must appear in the privacy disclosure.

## 8. Production security operations

Keep server TLS/signing/deployment/TURN secrets separate from client secrets.
Issue short-lived scoped TURN credentials only after authorized admission; exclude
them from URLs/logs. Infrastructure KMS/HSM may hold infrastructure signing keys,
never client content keys. Rotate service secrets with bounded overlap; suspected
compromise triggers revocation and deployment replacement, not silent user-key reset.

Logs allow event class, error category, coarse time, release version and aggregate
health counts. Exclude plaintext, recovery material, fingerprints/contact lists,
tokens, raw SDP, media, session dumps and stable user correlators. Security logs
are access-controlled and retention-limited; opt-in client diagnostic reports are
locally previewable/redacted. Disable core dumps containing unlocked process memory.
Approve concrete retention periods and incident-access controls before deployment.

Use locked dependencies, SBOMs, isolated reproducible release jobs, signed artifacts,
two-person release approval, provenance and independent review for security changes.
Update manifests bind platform, artifact hash, release counter and expiry. Reject
unauthenticated/rollback updates; emergency rollback is a newly signed higher
release counter with an approved compatible data migration. Archive old encrypted
state for analysis only, never roll live replay/ratchet state backwards.

| Incident | Containment and restoration |
| --- | --- |
| Server compromise | Isolate systems; rotate infrastructure secrets; rebuild from trusted images; inspect metadata exposure; clients reconcile trust rather than accept server repair |
| Device compromise | Revoke device and fence affected sync/groups/calls; replace device identity; re-verify affected contacts; warn that already exposed plaintext cannot be recalled |
| Dependency/update compromise | Halt release/update distribution; revoke affected signing credentials; publish advisory through independent channels; rebuild/review artifacts; assess identity exposure and require explicit remediation |

Operate a private vulnerability reporting channel, triage severity and notify users
with actionable scope. Preserve minimum redacted evidence. External reviewers must
exercise actual deployed composition and unsupported-state behavior. Restore drills
must test encrypted databases, rollback detection, expired sessions and audit-log
redaction; backups of servers do not recreate client identity authority.

## 9. Readiness and exact unresolved decisions

NOT READY. Design work may continue; production feature implementation depends on:

1. Reverified closure of Phase 6B F-01–F-09 and concrete transactional/delivery
   adapters with restart/concurrency evidence; earlier completion reports suffice
   for neither authentication nor distributed freshness.
2. Explicit approval of fresh-scope recovery semantics versus the older master's
   old-scope epoch advancement, plus a selected archive format/library and vectors.
3. A selected MLS implementation/profile, credential-to-device binding, group
   authorization wire schema, concurrency/fork resolution and membership limits.
4. A reviewed call key-distribution/SFrame profile and sender-authenticity model,
   validated on every supported client platform.
5. Minimum OS/browser versions, supported platform secure-storage APIs, backup/
   update policy and conformance matrix, with no unsupported silent fallback.
6. Approved operational retention, incident ownership, signed-release deployment
   and tested authentication/replay/TURN infrastructure from Phase 6A.

These are concrete gates tracked with owners and evidence in the roadmap. This
document completes the architecture coverage; it does not invent missing proofs
or imply production readiness.
