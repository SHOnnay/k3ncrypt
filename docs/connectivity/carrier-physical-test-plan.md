# Later physical carrier feasibility and production-security test plan

**PLAN ONLY — NOT EXECUTED OR AUTHORIZED AS RUNTIME BY THIS BRANCH.**
Date 2026-10-05; base a588d1bff66dd552fd71f20110ae358565a6bccc.
This document defines the next evidence, not production LAN, PeerAdmission,
capability, permission or verification code. [Architecture review](carrier-discovery-privacy-review.md)
and [platform evidence](carrier-platform-evidence.md) define assurance limits.

## A: first throwaway physical feasibility spike

A later explicitly scoped task must create an isolated debug-only application/harness
with dummy traffic only, no imports from production messaging/identity/trust/store,
no real accounts/contacts/keys/invitations/Olm envelopes, no production DB or
verification writes, no claims of application admission/acceptance/peer persistence.
Use existing audited dependency versions; new dependencies need separate review.
Any comparison TCP harness remains unauthenticated dummy reachability only.
Experimental WebRTC DTLS certs are ephemeral transport keys, not K3NCRYPT device keys.

Before running: record explicit operator agreement to the controlled LAN exposure,
expected advertised metadata, chosen setup/rendezvous method, foreground/background
test scope, packet-capture handling and teardown. Select finite experimental values
for discovery entries/rates/bytes, resolves, frames/queues, connection concurrency,
verification/mock work, deadlines, retry/backoff/cache/idle/shutdown, memory and
advertisement rotation. These are a signed-off test configuration, NOT production
policy or T; this review leaves all numeric resource values OPEN. No unbounded
historical spike setting (including its cached executor) is grandfathered in.

Hardware minimum: two PHYSICAL Android devices on the same controlled Wi-Fi,
record exact model/OS/API/build/ABI and target SDK, using disposable test profiles.
Add a third physical Android device and desktop/current supported browsers for the
broader matrix required by historical HANDOFF/lan-decision plan. Two-device results
close only their named scope, never every supported platform. Emulators are optional
supplementary tests, not physical evidence. Do not change Android instrumentation
guards or use real app identities to make dummy tests look authenticated.

Prepare ordinary Wi-Fi, guest/client-isolated AP and hotspot; note captive portal,
multicast filtering and IPv4/IPv6 availability. Internet removal means router WAN
blocked/disconnected plus cellular, VPN, tethering and alternate uplinks disabled
on every test participant; Wi-Fi association remains. Confirm independent Internet
probe fails without publishing endpoints. Merely switching off mobile data is not
proof the AP has no WAN. Use fresh process state and no cached relay/SDP exchange
for cold-offline tests. Browser cached application loading is a separate condition.

Signaling subtests must label their exact mechanism:

- S1: manual local transfer of complete synthetic offer/answer/candidates between operators (diagnoses carrier independently of discovery/automated bootstrap). No contact verification claim or production QR format.
- S2: separately scoped bounded local dummy signaling harness plus NSD locator (diagnoses combined cold-offline discovery/rendezvous/carrier). No production bootstrap/security approval from its success.
- S3: online relay-like test signaling, if included, labeled ONLINE ONLY. It cannot satisfy cold-offline criterion.

Do not call manual S1 success a working NSD-to-DataChannel architecture. Do not
call NSD discovery a successful SDP exchange. If S2 not yet specified/approved
for the throwaway harness, mark the combined criterion NOT TESTED and D13 OPEN.
No broad IP/subnet scans, automatic hotspot/UPnP/firewall bypass or public STUN/TURN
in offline subtests. Empty iceServers still needs egress/interface/selected-path
checks; it is not a production host-only guarantee.

## Reproducible feasibility matrix

Planned repetitions: 20 independent establishment trials per supported device pair,
network condition and direction for baseline Internet/Internet-off cold starts;
5 complete cycles per lifecycle/privacy transition below, both roles swapped.
These counts are evidence-plan choices, not runtime constants or production pass
thresholds. Report actual counts if changed, why, and incomplete coverage. Performance,
power/reliability thresholds require owner approval; never invent a green SLA.

| ID | Exact procedure | Record / required observation |
|---|---|---|
| P01 online baseline | Both apps foreground, same ordinary Wi-Fi with WAN; opt-in expose minimal test discovery; establish dedicated PC/one reliable ordered channel, no media; bounded dummy binary frames both directions | Discovery, signaling, ICE, DTLS, SCTP/open separately; trial counts/aggregate durations/errors, delivery count within dummy harness only |
| P02 Internet removed after association | Remove WAN/alternate uplinks while Wi-Fi remains; existing dummy connection then CLOSE both peers and establish fresh S1/S2 attempts | Distinguish surviving connection from fresh connection; no relay/public STUN/TURN access; report separately |
| P03 Internet absent before app start | Stop both processes, clear transient hint/SDP state, WAN already unavailable, start each in alternate order and discover/exchange signaling | NSD and local rendezvous cold start independently measured; S1-only cannot pass S2; failure leaves D13 open |
| P04 app/peer restart | Restart A then B then both; repeat without WAN | Old hints/cert/handle/nonce state not reused; fresh resources and no leaked old listeners |
| P05 lock/unlock and sleep/wake | Screen lock each then both, idle/sleep, unlock; operator-approved measurement mode separated from recommended foreground-only mode | Recommended mode stops browse/advertise/connections; restart needs fresh attempt; measure registration withdrawal delay and CPU/power without promising background |
| P06 foreground/background | Home app, return, OS process kill, permission revoke during resolve/gather/open | No late callback restores exposure; advertisement/listener/queue released; denied state has no probing/gathering |
| P07 Wi-Fi off/on | Turn Wi-Fi off on each side, then same network rejoin | Old PC/DC/generation retired; no automatic trust retention; fresh connection only after policy |
| P08 network/interface/DHCP change | Switch ordinary AP to hotspot and back; force approved lease/address change; test alternate interfaces/VPN disabled baseline | Hint scope cleared; no admission inheritance; selected path classified without storing raw addresses |
| P09 IPv4/IPv6 | IPv4-only and dual-stack; IPv6-only if actually supported; record global vs link-local availability categories | Establish/fail per family; host candidate does not imply private/LAN; no Internet route misclassified Nearby |
| P10 AP isolation | Enable client isolation; test multicast visible/unicast blocked and multicast blocked where AP supports | Unavailable is expected; no scanning, unsafe retry/fallback or false security diagnosis |
| P11 fake advertisements | On controlled third harness, emit bounded forged names/TXT, same-name collisions, endpoint churn/replayed records and invalid fields | No identity/contact/capability authority; no automatic connect-to-all; limits enforced; generic errors |
| P12 duplicate/disappearance | Duplicate events, withdraw service, stop peer abruptly, replay stale hint | Bounded dedup/eviction/deadline behavior, no retry storm; old hints cannot reopen state |
| P13 flow control and large frames | Within selected finite experimental limits, fill native/application queue, reject over-limit frames, cancel during send | Queue bound/backpressure/send-refusal/shutdown behavior; no unlimited reassembly or ACK as durable acceptance |
| P14 cert/binding API evidence | Read local used cert and connected transport remote cert/stat linkage from SAME dedicated PC; compare locally with retained expected synthetic transport evidence | Availability/type/mapping/crosscheck PASS/FAIL only in published report; missing remote evidence means binding criterion FAIL |
| P15 reuse/replacement/second channel | Controlled experiment reuses cert across two PCs, resets/replaces channel/association, opens second channel, triggers ICE restart/renegotiation and delayed callbacks | Show which APIs distinguish events; recommended architecture rejects reuse/extra channels and invalidates on uncertainty; no claim fingerprints alone identify association |
| P16 privacy off | Before startup, during browse/resolve/gather/handshake and connected state: turn Nearby/discovery/advertising/contact opt-in off and Hide-IP/relay-only on | No optional egress/listening/gathering when prohibited; callbacks fenced; OS app permission cannot auto-enable |
| P17 Internet restored | Restore WAN after offline failure/isolation; observe separate dummy online route and existing production relay in separate controlled test if authorized later | Relay restoration is reachability observation only; no integrated LAN-to-relay outbox completion tested in dummy harness |
| P18 no sensitive logs | Inspect app logs, exception paths, RTCStats/native verbose log configuration, UI/screenshots/report output | No keys/PEM/identities/fingerprints/transcripts/SDP/candidates/endpoints/tokens; redact/delete accidental captures before sharing |
| P19 battery/background | Compare foreground idle OFF versus discovery-only versus advertiser versus connected dummy channel under recorded finite sessions; thermal/memory/CPU/power categories | Repeatable scoped aggregates; no unrestricted lock/FGS; owner power budget still OPEN |
| P20 browser/desktop | Record exact supported versions, secure context/permissions, data-only no-media prompt, local/remote cert APIs, empty servers and actual path, signaling method; repeat online/offline only when loadable | Browser discovery remains unsupported unless evidenced; manual bootstrap results qualified; desktop native discovery separate |

Record result schema: harness commit/dependency hash, operator/test date, synthetic
run alias, model/API/browser version, target SDK, network category/isolation/IP-family,
WAN proof category, signaling method, trial/cycle counts, per-stage success/failure,
reason enum, min/median/p95 where sample supports it, resource/teardown and consent
observations, PASS/FAIL/NOT TESTED, evidence limits. No raw network names/addresses,
service IDs/cert fingerprints/candidate payloads or device/account identifiers.
Physical captures, if authorized and needed, stay access-restricted, local and
synthetic; publish aggregate exposure classifications only, never commit captures.

Network-feasibility PASS requires actual fresh connected carrier and bounded dummy
round trips under the named conditions. It NEVER means PeerAdmission authenticated,
freshness available, messages durable or protocol approved. Each missing device,
network/IP case, bootstrap or certificate API criterion remains explicit.

## B/C: later production security validation, separate task

Do not add application messaging or trust code to a dummy experiment. A later
approved production implementation/security plan must use adopted verifier/trust
and finalized A1/C1/M6/E1/receipt rules. It must test:

- Wrong/unverified/changed/revoked expected devices; wrong conversation/key/account/lifecycle mapping; signature mutation, unavailable verifier, reflection/replay/role swap; no trust/conversation/session writes on rejection.
- Complete-offer stripping, changed selection/profile/dependencies/unknowns, old/new clients and old/new relays, authenticated confidential bootstrap, simultaneous open, lost/duplicate confirmation and activation barrier.
- Actual PC/DTLS/SCTP/DC binding under reused cert, channel reuse/reset, extra channel, connection replacement and delayed callbacks; no envelope delivered to wrong handle/generation.
- Missing/stale/conflicting freshness and authority unreachable before start/reconnect, known revocation; no F2 relaxation without approval, no freshness fabrication, no restart/restore authority retention.
- E1 approved clock/restore/expiry/horizon behavior; live M1/legacy pre-decrypt duplicates, atomic acceptance and exact saved sender retries; no expiry imposed on legacy messages.
- Definite/ambiguous optional send failure, relay fallback overlap, process crash boundaries and authenticated receipt/outbox completion; exactly one durable acceptance and no false persistence status.
- Actual OS denied/revoked permission, privacy gates before ANY exposure, native/browser unsupported evidence, resource saturation/Doze and release/debug logging safeguards.

## Ranked remaining gates and stage requirements

Rank expresses recommended closure priority/dependencies, not authorization to run
steps concurrently or approval. M6 should establish whether the desired offline
product behavior is permissible before costly production work.

| Rank / gate | A: isolated dummy physical spike | B: first production LAN implementation | C: enabling LAN for users |
|---|---|---|---|
| 1 M6 freshness owner decision | Not needed to measure dummy reachability; report real admission BLOCKED, never mock assurance | Mandatory approved authority/eligibility/continuity rules and current-line evidence | Mandatory executed outage/revocation/restore tests and clear consent/policy |
| 2 Resource-bound parameter closure | Mandatory finite EXPERIMENT budgets and exposure approval before run; production numbers may remain OPEN | Mandatory approved production parser/connection/crypto/cache/queue/deadline values | Mandatory stress/power/teardown evidence under approved budgets |
| 3 Physical carrier feasibility spike | This is A; scoped separate task and controlled hardware required | Mandatory D13 cold-offline/bootstrap/binding/platform evidence with limitations closed for supported scope | Mandatory full release device/browser/network matrix; at least wider historical three-device+desktop evidence before broad claims |
| 4 Android explicit verification/native verifier adoption | Not needed; no production identities/trust in dummy harness | Mandatory for Android production; safe current-line adoption, sole trust writer, native verifier/current expected mapping/session health | Mandatory relevant unit/JNI/Room/device evidence and release review |
| 5 Web verifier/admission adapter validation | Only data-only API feasibility if Web included; no K3NCRYPT verifier claim | Mandatory protocol/parity review; executed Web verifier before shipping Web adapter; Android-only scope must explicitly exclude Web delivery | Mandatory supported-browser evidence before enabling Web LAN; do not block honest Android-only product on unclaimed Web runtime, but shared protocol cross-platform review remains required |
| 6 A1/PeerAdmission completion barrier/final review | Not needed for dummy transport; cannot label dummy channel admitted | Mandatory final fields/key mapping/bootstrap/confidentiality/binding/roles/flights/completion and independent review | Mandatory interoperability/adversarial/lifecycle tests and approved source/rollout |
| 7 E1 expiry/clock/restore/common dedupe horizon | Not needed: no real envelopes, age or persistence semantics | Mandatory approved contract/legacy migration/retention/restore before application delivery implementation | Mandatory implemented/validated semantics and rollback/legacy tests |
| 8 Authenticated receipt/outbox completion | Not needed: dummy ACK never receipt or application acceptance | Mandatory reviewed protocol/completion path for optional checklist; no implicit bypass | Mandatory executed crash/ambiguous retry/receipt/replay/outbox tests |

D14 explicit owner consent/defaults/advertising/discovery/privacy and OS permission
plan, D13 binding approval and safe bootstrap are additional mandatory B/C gates;
A needs scoped operator consent, resource limits and no production imports, not
approval of a real security protocol it does not implement. Historical language
'gates 1–6 before LAN feasibility' concerned production-integrated work; this
plan's proposed A is standalone dummy measurement, not a waiver for integrated
experiments. User must authorize the later spike task explicitly. This branch
runs no networking. If a spike exercises real PeerAdmission/Olm/device keys or
production dispatch it becomes security integration and must satisfy B first.

Before enabling users: complete B plus release security/permission/UI state review,
platform evidence, flags/kill switch/rollback, old-client matrix and approved
physical/privacy/resource validation. First release remains default OFF with no
silent background advertising. No production rollout or merge from this package.

## Decision outcomes and next boundary

Physical results may narrow D13 but cannot approve crypto. Missing bound remote
certificate evidence, cold-offline bootstrap, enforceable privacy/local-only policy
or finite resources is a STOP condition. Keep production relay-only and mark D13
OPEN; do not replace DataChannel with raw TCP to get a green result.

Recommend next review: **M6 freshness owner-decision closure**, from this branch's
final commit, with F1/F2/F3 options and exact offline/authority/restore requirements.
Do not implement freshness, LAN, cached-offline mode or trust adoption in that review.
A separate scoped finite-resource dummy physical spike may follow once explicitly
requested; it does not wait for all real-message protocol gates and cannot waive them.
