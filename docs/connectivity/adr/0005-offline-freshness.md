# ADR 0005 — offline freshness / M6 owner decision package

Status: OPEN OWNER/SECURITY DECISION. No option is approved or activated.
Review base: sender-origin 5111aff9cbed6668194d2ab522bd80dcf1b0f9b1.
Historical skeleton: connectivity/lan-decision
bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2, same fail-closed requirement.
See [review package](../peer-admission-freshness-review.md).

## Current evidence, scope and persistence

| Question | Actual current implementation |
|---|---|
| What Web evidence exists? | TrustFreshnessEvidence v1 contains deviceId, identityReference, epoch, local device-list commitment and evidenceId. It carries no timestamp, lifetime, authority signature or current-global-state proof. TrustFreshnessAdmission itself assumes authenticated provenance from its caller. |
| Where from? | ModernConversation's Olm-encrypted device control handles trust-state events/snapshots and enrollment confirmation. It requires the contact verified/unchanged and a matching active same-account member; TrustStateEventCoordinator validates against the known lifecycle list. |
| When loaded? | A new DeviceTrustEnforcer is created from persisted lifecycle state at connect/restore. Members are configured from active entries. requestTrustRefresh is sent after relay join when a session exists. Evidence is recorded on authenticated control/enrollment receipt, not reloaded from storage. |
| What is durable? | SecureStorageDeviceLifecyclePersistence stores the lifecycle list, commitment/history/authorizations and separate local high-water record via encrypted secure-storage CAS. A future/conflicting event can suspend trust through the high-water record. |
| Does evidence survive restart? | No. TrustFreshnessAdmission.evidence is an instance-local Map; only lifecycle state/high-water survive. There is no persisted freshness-evidence clock/TTL. A fresh enforcer with multiple required active members has missing evidence; local-only member sets can pass without remote evidence. |
| What invalidates or conflicts? | Missing/nonactive member, wrong identity, epoch or commitment mismatch, empty/duplicate/oversized member set, or conflicting evidence rejects. Recreating the enforcer/clear loses evidence. A lifecycle update makes prior-epoch evidence fail. There is no time-based expiration; an unchanged local epoch can match indefinitely in one process. |
| Peer-provided newer state? | installTrustUpdate allows only the next epoch, matching prior commitment/scope, same member identities/count, an active matching sender in both states, and active-to-revoked changes. It is received over the verified existing session; it is not a transferable independent signature or a cross-account lifecycle authority. |
| Does peer sharing require relay? | The current AuthenticatedDeviceControlChannel sends signaling over the existing relay. No offline optional control channel is wired. Enrollment and backend proof/bootstrap also require online backend calls today. A future peer may convey reviewed authority evidence, but cannot certify it is the newest by signing its own stale view. |
| Android evidence? | Android stores account/device reference, trustEpoch and lifecycleState in its identity checkpoint and requires locally active state. It requests backend proofs for relay operations. No counterpart of Web all-member freshness-evidence admission or independently verifiable offline remote-lifecycle attestation is installed. |
| Backend freshness? | Each relay proof validates active device/epoch against backend durable state and is backend-authenticated with server-held HMAC. This authorizes the backend operation, not a third-party peer's offline admission. It is not a public-key peer-verifiable current-lifecycle proof. |

Source anchors: service/src/devices/freshness.ts:17;
service/src/devices/trust.ts:31; service/src/devices/runtime.ts:43,133,187;
service/src/crypto/modernConversation.ts:475,518,591,597,1427,1463,1516,1558;
backend/security/durableDeviceTrust.ts:104,110;
android/app/src/main/kotlin/com/k3ncrypt/app/AndroidIdentityLifecycleRepository.kt:100,202;
service/src/devices/trust.test.ts:51;
service/src/devices/securityClosure.test.ts:36.

Known lifecycle authenticity and global freshness are different properties.
A valid signature proves possession of the signing key and authenticity of
the signed bytes. It does not prove no newer revocation exists elsewhere.
A malicious/revoked peer can sign fresh challenges while disconnected from the
authority that revoked it. Matching local epoch/commitment is not evidence that
the authority has not advanced. A locally stored high-water record detects some
partial rollbacks, but a full backup can roll it back with the lifecycle record.

There is no demonstrated cold-start Internet-off verified Android pair with
required fresh remote lifecycle evidence. Source/unit fixtures do not establish
that experiment; base instrumentation validates Room/Keystore/M1 sender state,
not an optional path or offline freshness authority. The old ADR's request to
measure Android TrustFreshnessAdmission presupposes a gate absent from this base.

## Owner options

| Dimension | F1 — strict authenticated freshness | F2 — explicitly approved cached-offline relaxation | F3 — new offline admission disabled without fresh evidence |
|---|---|---|---|
| Security property | Require authenticated lifecycle evidence satisfying approved authority/scope/time-continuity policy at admission and throughout use. | Admit from previously authenticated pinned state only under an owner-approved bounded offline policy; disclose weaker revocation knowledge. | Block new optional admission whenever fresh authority evidence cannot be established; no age-based cached exception. |
| Weakness | Even an authenticated current snapshot only proves state at its issue/check; revocation afterward remains unknown until invalidation/renewal. Need a bounded assurance definition, never “no unseen revocation anywhere.” | A revoked or stolen device can remain usable offline while other parties only know cached active state. Signing challenges does not mitigate that knowledge gap. | Connectivity/authority failure can deny optional service even for uncompromised peers; policy can be abused for availability loss. |
| Usability | Optional paths only during evidence validity/renewability. Network interruption may close them; otherwise valid relay remains independent. | Better offline availability, with explicit local opt-in and persistent understandable warning; no automatic downgrade from F1/F3. | Simple conservative behavior: optional unavailable without fresh evidence. Relay can continue when reachable/authorized. |
| Internet-off LAN | Potentially works only if evidence remains valid under approved continuity rules or an independent authenticated authority is locally reachable. Current code provides no such approved assurance. | Allows a future previously verified pair to use LAN under approved age/continuity bounds; no offline first contact or verification. | No new optional path when fresh authority evidence is unavailable. If an approved local authority can supply genuinely fresh evidence, that is a separate reviewed case, not an exception invented here. |
| Revocation/theft | Known revocation closes immediately; unseen revocation exposure bounded only by approved evidence policy. | Known revocation always overrides cache; unseen remote theft/revocation remains an accepted residual risk for the approved interval. | Without accessible freshness authority, attacker possession of a formerly active key cannot obtain new optional admission solely from cached state. |
| Restore/rollback | Restored freshness cannot gain a new lifetime; uncertain clock/high-water continuity blocks admission. | Most sensitive to backup rollback and clock uncertainty; cache receipt plus continuity/high-water must be protected. Unknown age/restore blocks cached mode until approved resolution. | Restart/restore never resumes admission; fresh authority check required for a new one. |
| Complexity | Authority protocol, evidence authentication, scope binding, refresh/invalidation, clocks and tests; current Map is insufficient. | Highest: all F1 evidence machinery plus cache age/restore, opt-in/UI, bounded degradation and persistent audit-safe state. | Lower policy complexity, but still needs honest authority reachability/freshness definitions, fail-closed gates and cancellation/teardown. |
| UI/transparency | Show optional unavailable/revalidation with safe local reason; never mark peer unverified because Internet disappeared. | Persistent “cached offline state; newer revocations may be unknown” notice and explicit bounded-mode choice. Connection indicator must distinguish this mode. | Explain optional path unavailable due to freshness; do not imply identity mismatch or revoke trust on a path failure. |
| Old clients | Relay-only, no new admission/control traffic or trust migration from hints. | Relay-only; absence of F2 policy support cannot silently enroll a peer in weakened mode. | Relay-only, unchanged authorized legacy messaging. |

F1 and F3 overlap in their fail-closed boundary. F1 could allow previously issued
authenticated evidence only while an approved freshness policy can still
establish validity; F3 rejects new offline admission when establishing fresh
authority evidence is impossible and offers no cached-age relaxation. Neither
option promises instantaneous revocation knowledge in a partition.

Recommendation for owner review: F3 is the conservative interim policy while
authority/time/restore decisions are absent. F1 is a possible reviewed future
policy once assurance and renewal semantics are defined. F2 is an explicit
security relaxation and must not be auto-selected to make Internet-off LAN work.
This recommendation does not approve any option or modify existing relay gates.
All optional runtime remains absent pending the complete prerequisite set.

## Decision form — owner and security reviewer must complete

| Required decision | State |
|---|---|
| Selected option and applicable platforms/new versus existing admissions | OPEN |
| Who authenticates each account's lifecycle, and how pinned key/device/account mapping is proved across contacts | OPEN |
| Evidence issuance, independent validation, epoch/fork handling, refresh and revocation authority | OPEN |
| Freshness definition / maximum state age (especially F2), evidence continuity across sleep/reboot and clock changes | OPEN; no value selected |
| Backup/full-rollback detection and behavior when cache age/state is unknown | OPEN |
| Allowed Internet-off/new/reconnect behavior and already admitted connection teardown | OPEN |
| User consent, persistent warning/transparency, privacy-mode interaction and old-client rollout | OPEN |
| Approvers, policy revision, evidence/tests and rollback plan | OPEN |

No owner response is assumed by elapsed time or recommendation. Do not persist
Date.now alone as freshness authority, import senderOrigin as a timestamp,
approve a cached age or invent a remote timestamp. M6 policy bounds are distinct
from E1 message lifetime T and local handshake/admission resource timeouts.

## Required future tests

Online fresh / missing / stale / forked evidence; revoked local and remote device;
device/key/account substitution; next-epoch update and stale replay; peer signing
with stale lifecycle; backend unreachable before cold start; authority loss during
an existing path; reboot/sleep/clock rollback and forward jump; fully restored
backup; expired/unknown cached age; explicit F2 consent and warning; missing
old-client support; teardown/callback races. Use the approved option's exact
assurance rules; never turn a mock “fresh=true” into runtime freshness. Physical
offline-LAN validation remains a later separately reviewed task.
