# Phase 6C implementation roadmap

Status: design only, NOT READY FOR IMPLEMENTATION. This is a sequence of major
milestones, not authorization to begin code changes. Architecture:
[complete specification](PHASE6C_COMPLETE_ARCHITECTURE_SPECIFICATION.md).
Security acceptance: [threat model](PHASE6C_THREAT_MODEL.md).

## Entry gate — finish and independently verify Phase 6B

Owner: core maintainers plus independent security reviewer.
Close F-01–F-09 in [the latest audit](PHASE6B_FINAL_SECURITY_AUDIT_REPORT.md):
session-derived identity and authenticated-only receive; real bidirectional
composition; mandatory transactional state/recovery; strict record permissions;
durable conflict and full-member admission; adversarial runtime tests.

Acceptance: two/three independent device runtimes with real encrypted sessions,
durable transactional storage and process restarts. Exercise revocation during
transfer, network partitions, forks, duplicate/delayed envelopes and failed writes.
Prove no premature ACK/content release and no raw bypass. Publish evidence and an
independent closure review. Prior test counts or completion documents do not close
this gate. Phase 6C architecture and qualification analysis may proceed meanwhile.

## Milestone 1 — recovery and client security foundation

Goal: user-controlled data recovery into a fresh identity and a shared platform
contract for Android/iOS/Windows/macOS/Linux.

Dependencies: entry gate; approved recovery-authority clarification; qualified
archive format/library; selected OS minimum versions and secure-storage profile.
Components: explicit export/import ceremony, staged historical importer, local
archive-secret handling, contact re-verification, native vault/permission/lifecycle
adapters, signed distribution baseline. No old identity/session key restore.

Security tests: complete device loss, stolen kit, archive replay/corruption,
unconfirmed replacement, failed contact notification, copied OS backups, missing
keystore, process kill and permissions/capture cleanup. Run identical identity,
encoding and storage invariants across all supported platforms.

Completion: fresh identity visible; contacts/groups grant no automatic authority;
unreachable old devices are not represented as globally revoked; selected records
import atomically with deletion/expiry evidence; every supported client passes
qualified storage and update tests. Unsupported configurations remain disabled.

## Milestone 2 — group communication

Goal: multi-user, multi-device text groups followed by end-to-end encrypted group
calls through an SFU within the same major release gate.

Dependencies: milestone 1; reviewed MLS implementation/profile and credential
binding; approved group conflict policy; reviewed SFrame/call-key profile and
platform encoded-media compatibility. Messaging membership evidence must be
accepted before call integration starts.

Components: independent group protocol adapter, device-to-leaf authorization,
visible administration/consent, atomic group epoch store, rekey/removal, fork
suspension, dedicated call-membership context, endpoint frame protection, TURN/SFU
routing. No migration of existing one-to-one or legacy conversations.

Security tests: Charlie removal across all devices; new-member history exclusion;
malicious administrator/member/relay; compromised/revoked device; conflicting
commits; lost Welcome/ACK; stale queued sends; call participant removal and wrong
sender/track/counter; malicious SFU and transport-only fallback attempts.

Completion: external protocol review, cross-client vectors and interoperability,
durable restart tests, measured group/call limits and demonstrated post-cutover
exclusion. Group attachments stay disabled until their separate authorization
mapping is explicitly reviewed; existing attachment crypto is unchanged.

## Milestone 3 — advanced privacy hardening

Goal: reduce observable metadata with measured cost and explicit limitations.

Dependencies: stable ciphertext delivery/call profiles and a defined telemetry-free
observability model. Components: context-scoped identifiers, minimized queues/logs,
qualified padding buckets, optional proxy routing, privacy-preserving push bodies,
relay-only call privacy mode. Cover traffic requires its own battery/abuse budget.

Tests: server/relay/push trace inspection; correlation before/after padding; DNS
and ICE address leaks; mixed-route reconnects; mobile background/energy behavior;
quota exhaustion and censorship. Fail closed rather than switching secretly to a
direct route when anonymity mode is selected.

Completion: published metadata disclosure matrix, bounded latency/bandwidth cost,
supported-mode/platform table and explicit statement that global traffic analysis
and recipient disclosure remain possible.

## Milestone 4 — production security and release acceptance

Goal: deploy reviewed capabilities with reproducible validation and operational
incident readiness. Security operations design begins in milestone 1; release
acceptance happens here.

Dependencies: preceding gates; Phase 6A real authentication/authorization/replay
adapters; production routing/storage/TURN configuration and ownership.
Components: signed provenance, dependency inventory, isolated release jobs,
anti-rollback update policy, infrastructure secret rotation, redacted observability,
bounded retention, vulnerability disclosure and incident runbooks.

Tests: compromise drills for server/device/dependency/update signer; failover,
backups and rollback; load and quota abuse; log/notification leakage; unsupported
client handling; complete platform/browser matrix with artifacts.

Completion: independent external review closes security blockers; real deployed
paths pass adversity/restart tests; named operators demonstrate response drills;
release manifest lists capabilities actually supported. Architecture approval
alone is never a production-readiness claim.

## Decision register — required before implementation

| Decision | Owner | Required result / acceptance condition |
| --- | --- | --- |
| Recovery identity authority | Product owner + identity/security maintainers | Approve fresh replacement scope with explicit contact reset, or separately specify a compatible authenticated old-scope authority; no unproven N+1 claim |
| Recovery archive profile | Security maintainers + independent reviewer | Select existing reviewed format/library, entropy/encoding/bounds and versions; publish corruption/replay/import vectors excluding live keys |
| Client support profile | Platform leads | Specify minimum OS/browser versions, API access controls, backup exclusions, local unlock fallback and signed update paths; pass conformance per platform |
| Group protocol profile | Protocol maintainers + independent reviewer | Select maintained MLS implementation/ciphersuite; define credentials, user/device binding, limits, membership actions and concurrent commit/fork reconciliation; publish vectors |
| Group-call media profile | Call/protocol maintainers + independent reviewer | Specify call-only membership, reviewed key schedule, sender attribution, frame/epoch/counter binding and removal barrier; demonstrate interoperable endpoint encryption |
| Privacy budgets | Privacy/product + platform leads | Fix padding/retention/proxy behavior and measurable latency, bandwidth, battery limits; disclose remaining metadata |
| Deployment and incidents | Operations + security owners | Name responders, approve exact retention/access rules, qualify durable adapters and TURN credentials, demonstrate rollback/compromise drills |

Roles are required responsibilities, not assertions that named teams already exist.
Assign owners before scheduling implementation. Recommendations in the architecture
make the choices reviewable; unanswered profile/authority decisions remain gates.

## Validation and final readiness

Unit tests cover strict schemas and every forbidden transition. Integration tests
exercise real sessions, vaults, atomic storage and routing. Adversarial tests inject
identity substitution, replay, malicious membership and inconsistent durable state.
Browser/native tests verify capture, lock/unlock, updates and protocol compatibility.
Deployment tests cover multiple instances, process kill, failover and network
partitions. Preserve existing Jest, TypeScript, lint/build, dependency-audit and
crypto-library checks; record unsupported environments rather than weakening tests.

NOT READY. Immediate next action: close and independently verify Phase 6B audit
findings, obtain the recovery-authority decision, and select the client/group/media
profiles in the register. No Phase 6C feature implementation should infer these
choices from broad interfaces or milestone titles.
