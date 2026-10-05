# K3NCRYPT product and security architecture

Owner intent recorded: 2026-10-05. Documentation branch: `docs/master-product-security-architecture`.
Exact review base: `connectivity/carrier-discovery-privacy-review` at
`6482861d3561ea41c6af0f98221d82a99221fd81`.
Refreshed `origin/main` inspected: `66b0b5ca1fce0a2dd10075a563450bbd346a3677`.

## 1. Authority and reading rules

This is the authoritative record of the owner's current **product intent,
security philosophy, priorities, architecture boundaries, roadmap, process and
terminology**. It records intentions alongside evidence; it does not approve
cryptographic primitives, wire changes, verification semantics, PeerAdmission,
capability negotiation, expiry, a carrier, or LAN/direct runtime enablement.
Each requires its own reviewed ADR/specification and security evidence.
Historical ADRs remain historical. No protocol or runtime behavior changes here.

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Source implements the named boundary at an explicitly identified revision; not an adoption or security approval claim. |
| BRANCH-ONLY | Present in a named review/feature lineage and absent from the inspected main baseline. Always retain this qualifier when describing implemented branch work. |
| VALIDATED | Named tests or experiments support only their stated scope and revision. |
| OPEN | A decision or evidence remains unresolved. |
| BLOCKED | A required prerequisite or approval is absent; state which one. |
| PLANNED | Product/design intention, not implemented behavior. |
| DECISION | Explicit owner/product boundary or separately identified reviewed decision; identify its authority. |

A passed test is not production validation; an emulator is not a physical
validation; existing source is not security approval. Never promote BRANCH-ONLY
work into an unqualified implementation or shipment claim.

Future engineers and AI sessions must look in this order:

1. This master product/security architecture document.
2. Current refreshed `origin/main`, recorded with its exact commit.
3. Active branch report and its exact base.
4. Authoritative current reviewed ADR/specification.
5. [Connectivity HANDOFF](connectivity/HANDOFF.md) and [specification map](connectivity/specification-map.md).
6. Tests and code.
7. Git ancestry.
8. Latest validation evidence, including revision, platform and scope.

This lookup order is a discovery process, not permission for product intent to
override protocol evidence. Preserve conflicts and exact commits; do not
silently select a convenient document. Request owner/security review when a
conflict affects trust, crypto, identity, persistence or wire behavior.

## 2. Product intent and security philosophy — DECISION

K3NCRYPT is a personal-use, open-source, security-first communications system
for the owner, their devices and a small number of trusted contacts. Android
and Web are the initial platforms. Security/privacy takes precedence over
visual attractiveness, convenience, analytics, engagement and unnecessary
cloud dependence. This is not a promise of 100% security.

Minimize attack surface; make trust boundaries explicit; fail closed for
security-sensitive state; show truthful UI; make evidence-based claims; and
contain lower-assurance subsystems. Security applies to protocols, persistence,
networking, files, calls, notifications, UI, website, fonts, dependencies,
errors, logs, builds and runtime resources.

Default Web/UI policy: local assets and fonts; no Google Fonts/runtime font
links, third-party trackers or analytics by default; no unnecessary remote
scripts/CSS/images; no cosmetic dependency that materially increases attack or
privacy surface. Apply strict security headers where technically applicable.
Do not expose secrets or sensitive values in UI/errors/logs. When beauty
materially conflicts with privacy/security, choose the safer result. These
are governing product requirements, not a claim that every surface has been
fully audited or brought into compliance.

## 3. Four architecture domains

### 3.1 Main K3NCRYPT — DECISION; existing system plus gated future paths

This domain owns normal encrypted conversations, normal device identities,
pinned/known identities, explicit verification, verified contacts, trusted and
lifecycle state, primary conversation storage, relay authorization and existing
E2EE. Reliable relay delivery remains its messaging foundation. Future secure
Nearby/LAN and direct Internet connectivity belong here.

Connectivity never verifies identity. Optional paths require reviewed
PeerAdmission, authenticated capabilities, freshness and privacy gates, and a
verified unchanged peer under their policy. No convenient path justifies a
security downgrade. Existing relay messaging may be possible for unverified
contacts: do not misrepresent optional-path verification requirements as an
already enforced universal relay prerequisite.

Lower-assurance modes must not automatically inherit or mutate this domain's
identity, verification, lifecycle, storage, credentials or trust-writer authority.
Transport ACK is not proof of authenticated peer persistence. Retry/dedupe,
receipt semantics and crash boundaries need their own evidence.

### 3.2 Local Session Mode — PLANNED separate domain

NEW product direction: two devices on the same router should communicate when
that router has no Internet. Goals include text, files, voice, video later and
possibly Bluetooth. Same Wi-Fi does not imply trust, and this is not a mode
that disables K3NCRYPT security. No Local Session implementation or finalized
crypto is established by this document.

Containment goals: compromise must not automatically grant main identity or
verified-contact authority, main Olm/session state, relay credentials, normal
conversation access, direct-Internet authority or the ability to mark a contact
verified. Design requires separate protocol/domain separation, session keys,
storage namespace, pairing/bootstrap and explicit lifecycle/end. No automatic
promotion to main, no trust mutation, and no main identity private-key use
without separate review. Make the local-session UI unmistakable; bound resources;
handle files safely; never automatically open or execute received content.

Explicit QR/session invitations, temporary identities/context and mutual
temporary authentication without permanent-verification side effects are
candidate pairing concepts only. Pairing, key derivation, authentication,
transcripts, replay control and isolation need a separate review before code.

Assume hostile local networks and untrusted discovery/router infrastructure.
Even without Internet, a compromised router can fake discovery, inject, replay,
drop/reorder, flood connections, send malformed input, impersonate endpoints
before authentication and observe metadata. Design should prevent these powers
from granting plaintext, authenticated impersonation, main-key derivation or
main verification mutation. Availability and metadata limits must be explicit.

Protocol key separation cannot promise complete containment after arbitrary
code execution inside the same application process. Future hardening may
consider a dedicated process, separate Android service/process, storage and
Keystore aliases, or a companion component/package. Process separation is a
future hardening evaluation, not an immediate implementation requirement.

### 3.3 Direct Internet — PLANNED main high-assurance domain

Across different networks, use authenticated rendezvous, reviewed admission and
capabilities, NAT traversal, direct peer paths where possible, TURN/relay fallback,
privacy controls and the same E2EE envelope/message semantics. Never inherit
Local Session concessions or silently weaken security. TURN/relay configuration,
metadata exposure and fallback semantics require review.

Actual virtual-LAN/VPN/site-to-site networking is separate future research.
Do not reinvent a VPN protocol inside messaging.

### 3.4 User-operated nodes — PLANNED routing roles

The owner's primary motivation is infrastructure cost reduction. The owner
reports using Render Free and wants to avoid expensive central hosting/bandwidth.
This is a deployment report, not a verified provider-price or savings estimate.
When security permits endpoint direct communication, avoid unnecessary central
bulk traffic.

Candidate roles: rendezvous helper, encrypted relay, store-and-forward and
user-owned availability helper. Routing/helper roles do not automatically grant
verification, lifecycle, account or identity authority. Existing backend scoped
lifecycle/authorization mechanisms do have real authority; a future helper's
routing role must remain distinct from those mechanisms.

Prefer the owner's devices, explicitly authorized devices and, if separately
reviewed, explicitly authorized trusted-contact devices. Do not automatically
turn clients into public anonymous relays or create an uncontrolled volunteer
network. `service/src/privateNetwork` foundations are not a shipped helper
network, VPN or LAN chat adapter.

## 4. Cost architecture and open-source research — PLANNED

Long-term central backend role: account/control, required rendezvous/signaling,
offline mailbox/storage, fallback and minimal coordination. Prefer same-LAN,
direct Internet or explicitly authorized personal helpers for bulk files/media
and large payloads, conditional on security. The backend is intended as a safety
net/control plane rather than necessarily the permanent bulk-data highway.
Current messaging is relay-only; these goals are neither a deployed architecture
nor a validated cost estimate. Review storage, availability, abuse, bandwidth,
metadata and operating costs before making savings claims.

Study Jami, Briar, WebRTC P2P systems, the WireGuard ecosystem,
Headscale/Tailscale-style control/data separation and other open-source systems
before reinvention. This is a future research list, not a statement about their
current security/maintenance, a dependency recommendation or protocol approval.

For each borrowed concept record origin and classify architecture inspiration,
code reuse, protocol reuse or dependency. Review exact version/source, license
compatibility, security assumptions and maintenance; require explicit review
before adaptation. Prefer established components when they meet requirements;
never copy security designs blindly. Preserve this fork's Apache-2.0 license
and required upstream attribution; review compatibility before importing code.

## 5. Current evidence snapshot at the exact review base

The table concerns `6482861d3561ea41c6af0f98221d82a99221fd81`, not deployment.
Main comparison concerns `66b0b5ca1fce0a2dd10075a563450bbd346a3677` only.

| Boundary | Status and scope |
| --- | --- |
| Messaging path | IMPLEMENTED: relay is sole production/default messaging path; no LAN/direct messaging runtime enabled. |
| Live M1 durable dedupe | IMPLEMENTED / BRANCH-ONLY: Web and Android detect durable duplicates before decrypt, with dual legacy/M1 handling. Main lacks this review lineage's delivery modules/boundaries. |
| Inbound acceptance | IMPLEMENTED / BRANCH-ONLY: Web crash-consistent inbound acceptance; Android Room transaction. Claims concern the implemented transaction boundary, not universal physical crash proof. |
| Outbound acceptance/retry | IMPLEMENTED / BRANCH-ONLY: Web sender state/history/exact ciphertext commit atomically; Android sender state commits atomically; retries preserve exact ciphertext. |
| senderOrigin | IMPLEMENTED / BRANCH-ONLY: local durable semantic metadata, not trusted time, peer authentication or freshness. |
| Validation evidence | VALIDATED in named prior reports: bounded TS/Kotlin and scoped Android instrumentation on their recorded revisions. No new runtime/device validation in this documentation branch; no physical secure LAN validation. |
| Expiry | OPEN: no numeric T or expiry enforcement; retention/common horizon, receipts and outbox completion remain unresolved. |
| PeerAdmission | OPEN / BLOCKED: no complete approved protocol or runtime enablement. C1 review does not approve it. |
| Authenticated capabilities | OPEN: A1 review-only encoders/vectors, not a production protocol or complete signed-transcript validation. |
| Carrier/discovery/privacy | OPEN: D13/D14; dedicated WebRTC DataChannel is leading carrier candidate; Android NSD is leading discovery candidate. Raw TCP rejected for production PeerAdmission. |
| M6 freshness | OPEN: main optional-path policy and owner choice unresolved; existing local epoch/commitment is not a global revocation oracle. |
| Android verification | OPEN / BRANCH-ONLY: explicit-verification/native-verifier adoption unresolved; `verification/readiness` at `11b45172c5ba59a1e7e5c831944bcfdbf2f8207b` is not adopted into this base. |
| Local Session, helper nodes, Bluetooth carrier | PLANNED: no shipped feature claim. |

Evidence chain: sender-origin `5111aff9cbed6668194d2ab522bd80dcf1b0f9b1`;
C1 `e7a4385f167cc168947755325d0de5ed22c3f0b9`;
A1 `a588d1bff66dd552fd71f20110ae358565a6bccc`; D13/D14 exact base above.
[Reconciliation map](connectivity/specification-map.md) preserves older exact
commits and scoped validation. The refreshed main has Android source; old
statements that Android is absent are historical, not current main status.

### Conflicts retained, not rewritten

- [Current Architecture](CURRENT_ARCHITECTURE.md) explicitly retains an original
  audit; its no-Android/no-persistence/remote-font passages are historical.
- [Architecture](ARCHITECTURE.md) contains earlier crypto/receive/attachment
  descriptions (including Vodozemac development-only wording) that cannot
  override the exact review source or newer evidence.
- HANDOFF retains `origin/main` at `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f`;
  its absent-M1/coordinator and older instrumentation statements belong to that
  snapshot, not this review base. Do not erase those failures or infer adoption.
- [Dependency security](DEPENDENCY_SECURITY.md) is a dated advisory snapshot,
  not a fresh audit or guarantee.

All observations above reference files at this document's exact review base.
Reconcile any behavior-affecting discrepancy by exact source/ancestry and a
separate review. This master does not retroactively repair historical approval.

## 6. Feature requirements and priority order — DECISION / PLANNED

Owner may explicitly reprioritize. Current order:

1. Security/correctness foundations.
2. Visible, observable security and delivery state.
3. Same-router Internet-free Local Session.
4. Secure main-domain Nearby/LAN.
5. Secure file sharing.
6. Direct Internet peer connectivity.
7. Video calling.
8. Privacy-preserving notifications.
9. User-operated/personal nodes.
10. Virtual-network/site-to-site research later.

### Bluetooth

PLANNED future local carrier candidate for discovery/bootstrap, low-bandwidth
messaging/control and Internet-free communication. Do not assume it suits large
files, high-bitrate video or all voice/media. Wi-Fi/LAN is the expected higher
bandwidth path. Physical proximity never confers trust. Permissions, pairing,
privacy and platform behavior need their own evidence.

### File sharing

Priority PLANNED product: large files are not normal chat messages. Evaluate a
dedicated transfer protocol/coordinator, chunks, integrity, resume, cancellation,
quotas, safe filenames, MIME validation, traversal prevention, explicit recipient
acceptance and local/direct/server-assisted paths. No automatic execution/opening;
conservative previews; no unsafe HTML/SVG rendering. Local Session files must
remain isolated from main storage and authority.

Existing attachment crypto/contracts/storage/delivery and reference components
are foundations, not a completed secure file-sharing product or approved new
HTTP/object-storage integration. See [attachment architecture](ATTACHMENT_PRODUCTION_ARCHITECTURE.md).
Transfer admission, authorization, retention, previews and failure semantics
still need separate review.

### Voice and video

Voice/video are priorities. Local Session offline voice is a goal; video follows.
Main calls retain high-assurance identity/trust requirements; media connectivity
never verifies identity. Separate signaling, media transport, identity/admission,
call state and Local Session/main-domain semantics. Existing Web/Android call
and media plumbing is not proof of a finished new offline or high-assurance
product. Historical phase reports validate only their named revisions/scopes.
See [Android call architecture](PHASE9_3_CALL_ARCHITECTURE.md) and
[call deployment guide](CALL_DEPLOYMENT_GUIDE.md).

### Notifications

Privacy-preserving push notification product is PLANNED, not implemented by
existing beep hooks/UI labels. Review lock-screen privacy, metadata, push-provider
dependence, opaque payloads, user preview preferences and background behavior.
Never move plaintext into infrastructure merely to simplify notifications.

### Visibility: an explicit product risk

More backend/security state exists than the UI exposes. Security-relevant
ambiguity is a UI defect. Progressively expose safe, truthful state; distinguish
proposed future states from currently available ones.

| Layer | Required visibility |
| --- | --- |
| Normal user | Verified/unverified/changed; actual connection path and relay/local/direct; queued/retrying/stored; fallback; privacy mode; clearly separate Local Session. |
| Advanced security | Admission, freshness, capability compatibility, discovery/advertising policy and safe blocker reasons. |
| Developer diagnostics | Safe reason codes, outbox/dedupe, retry/fallback, persistence health and path selection. |

Never expose keys, unnecessary raw fingerprints, raw ciphertext, tokens, raw
admission transcripts, ICE candidates, sensitive local addresses or secrets.
“Stored” must name the storage boundary; a transport ACK must not imply peer
persistence or recipient read. Privacy controls must act before exposure.

## 7. Main M6 and other open security decisions

Preserve [M6 freshness review](connectivity/peer-admission-freshness-review.md)
and [offline freshness ADR](connectivity/adr/0005-offline-freshness.md).
M6 governs main high-assurance optional paths. F3 strict blocking is a
recommendation, not an approved owner decision; F2 cached relaxation remains
unapproved. Local Session uses a separately reviewed security model: it neither
silently inherits all main freshness requirements nor provides a route around
them. Any future F2/F3 mapping into Local Session requires explicit review.

OPEN/BLOCKED before main optional-path production: Android explicit trust and
native signature verifier adoption; complete admission transcript and identity/
device/lifecycle binding; freshness/continuity authority; authenticated downgrade
and bootstrap compatibility; final-confirmation/completion barrier; unique
carrier association/stream binding; NSD/bootstrap and privacy/interface exposure;
resource budgets; receipts/outbox semantics; dedupe retention/common horizon and
expiry; physical validation and independent security review.

OPEN before Local Session code: temporary pairing/authentication and replay
model, namespace/key/authority separation, lifecycle, resource budgets, file
boundaries and truthful UI. Same-router availability does not settle these.

## 8. Roadmap A–J

Each row separately identifies source, evidence, future work and owner decision.
“BLOCKED” means prerequisites absent, not abandonment of the product direction.

| Stage | IMPLEMENTED / BRANCH-ONLY | VALIDATED scope | PLANNED / OPEN / BLOCKED | DECISION needed |
| --- | --- | --- | --- | --- |
| A Main security foundation | Relay/E2EE foundations; M1, atomic boundaries and senderOrigin BRANCH-ONLY | Named prior source/test/instrumentation reports only | OPEN freshness, verifier/admission/expiry/receipt gates; optional paths BLOCKED | Owner freshness choice and reviewed protocol/adoption order |
| B Visibility foundation | Some existing trust/delivery UI; complete contract not implemented | No complete three-layer UI validation | PLANNED state contract, safe diagnostics, local assets; OPEN wording/coverage | Approve truthful state and privacy contract |
| C Local Session | No implementation | No experiment or physical claim | PLANNED separate text/files/voice domain; OPEN pairing/isolation/budgets; experiment BLOCKED pending review | Approve bootstrap/security contract and bounded experiment |
| D Main-domain LAN | Review seams only; no enabled adapter | Historical dummy probes are not secure LAN validation | PLANNED dedicated DataChannel/NSD candidates; OPEN M6/A1/D13/D14; production BLOCKED | Close exact protocol/carrier/privacy gates |
| E File sharing | Attachment foundations only | Existing reports do not validate completed new product | PLANNED transfer coordinator and safe previews; OPEN integration/domain isolation | Approve transfer/auth/storage/retention contract |
| F Direct Internet | Existing call transport foundations, no direct messaging enablement | No new direct-messaging validation | PLANNED authenticated rendezvous/NAT/fallback; BLOCKED on main admission/privacy | Approve direct-path and fallback policy |
| G Video | Existing Web/Android media plumbing | Historical named reports only | PLANNED product completion and domain-specific calling; OPEN lifecycle/privacy | Approve media/identity/state boundaries |
| H Notifications | Beep/UI foundations, not private push product | No complete privacy-push validation | PLANNED opaque payload/privacy/background design; OPEN provider choice | Approve metadata and preview policy |
| I Personal nodes | Private-network foundations, not shipped helpers | No helper-network/cost validation | PLANNED authorized routing roles; OPEN authority/abuse/availability/cost | Approve role/authorization model |
| J Virtual network research | No shipped VPN/site-to-site product claim | No validation | PLANNED later research; OPEN licensing/threat/operational model | Owner decides whether research becomes a separate project |

## 9. Execution rules and owner workflow

Work from exact requested bases in isolated branches. Keep protocol reviews,
experiments and production enablement separate. Document prerequisites, evidence
and approval scope; never infer approval from source existence, model choice or
an old report title. Preserve historical ADRs, license/attribution and conflict
records. Before enabling optional paths, close their reviewed gates. New trust,
crypto, identity, persistence or wire changes need their own ADR/spec review.

OWNER WORKFLOW (owner preference, not an independently verified model ranking):

| Model label | Owner's intended work |
| --- | --- |
| Luna | Routine implementation, tests/builds, straightforward debugging and refactoring. |
| Sol Medium | Architecture, security boundaries, persistence migration, protocol reconciliation, branch ordering and important reviews. |
| Astra | Hardest protocol/security reviews, PeerAdmission transcript, authenticated downgrade/freshness reasoning and major crypto/network redesign. |

Model capability never substitutes for testing, independent review or evidence.
For documentation-only changes run lint, diff whitespace checks and local-link
audit; no heavy production suites unless code/fixtures change. Runtime work
must name and satisfy its own validation requirements.

## 10. Current review references and next branches

- [Carrier/discovery/privacy review](connectivity/carrier-discovery-privacy-review.md),
  [reconciliation](connectivity/carrier-discovery-privacy-reconciliation.md),
  [platform evidence](connectivity/carrier-platform-evidence.md) and
  [physical test plan](connectivity/carrier-physical-test-plan.md): D13/D14 OPEN.
- [PeerAdmission candidate](connectivity/peer-admission-v1.md) and
  [C1 review](connectivity/peer-admission-freshness-review.md): not protocol approval.
- [Authenticated capabilities](connectivity/authenticated-capability-review.md)
  and [A1 reconciliation](connectivity/authenticated-capability-reconciliation.md): review-only.
- [Dedupe/expiry policy](connectivity/dedupe-expiry-policy.md) and
  [LAN foundation](connectivity/lan-transport-foundation.md): exact-base boundaries and open gates.
- [Security policy](../SECURITY.md), [threat model](THREAT_MODEL.md),
  [dependency security](DEPENDENCY_SECURITY.md): consult scope/date, do not assume a fresh audit.

Recommended separate follow-ups, subject to owner choice:

A. Fastest first visible Local Session: `docs/local-session-security-bootstrap-review`;
then a separate isolated dummy experiment after pairing, isolation and finite
budgets are reviewed. No main keys/trust/storage and no secure-production claim.

B. Safest production main LAN: `connectivity/freshness-owner-decision`, or an
exact M6 closure review; then close admission/capability/carrier/privacy and
physical-validation gates before production.

C. Visibility UI: `docs/security-visibility-state-contract`; then a local-assets
UI branch implementing the reviewed safe/truthful state contract.

D. Cost/personal nodes: `docs/personal-node-cost-architecture-review`; begin with
read-only inspiration/license/cost/authority research, not an enabled relay network.
