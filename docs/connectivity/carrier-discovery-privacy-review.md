# D13/D14 carrier, discovery and privacy review

**REVIEW CANDIDATE — NOT APPROVED. D13 REMAINS OPEN. D14 REMAINS OPEN.**
Date: 2026-10-05. Starting branch connectivity/authenticated-capability-review at a588d1bff66dd552fd71f20110ae358565a6bccc.
Review branch: connectivity/carrier-discovery-privacy-review. No runtime, fixture, dependency, permission or UI change.

## Independent review entry point

This package narrows the first Android-to-Android LAN architecture; it does not authorize implementation. Read [source reconciliation](carrier-discovery-privacy-reconciliation.md), [platform evidence](carrier-platform-evidence.md), [physical test plan](carrier-physical-test-plan.md), [A1](authenticated-capability-review.md), [C1](peer-admission-freshness-review.md), [admission requirements](peer-admission-v1.md) and [M6](adr/0005-offline-freshness.md). Those documents are available in this tree; historical documents have immutable refs in the table and must not be merged to infer approval.

Exact base has live M1/legacy inbound dedupe before decrypt, atomic Web inbound/Android Room acceptance, crash-consistent sender state/exact outbox ciphertext and exact retries. senderOrigin is local durable-commit metadata. No numeric T, expiry, production LAN/direct path or physical LAN evidence exists. Relay is the only production/default path. Discovery, connectivity, device name/IP/port/MAC/service instance, certificate fingerprint and capability claims never verify contacts or authorize messages. Transport encryption is additive to existing Vodozemac application E2EE.

A1's three-flight transcript agreement remains a candidate with final completion/activation unresolved. C1 key/device/lifecycle authority mapping, M6 freshness, Android explicit trust/native verifier adoption and Web bounded verifier/platform validation remain prerequisites. New carrier wording cannot close them. Frozen C1/A1 vectors remain unchanged; A1's binding marker remains synthetic. No signed/new carrier vector is produced before final fields and protocol review settle.

## Threat model and boundaries

Assets: pinned identity tuple and explicit local verification, existing conversation/session health, lifecycle/freshness decisions, plaintext/history/outbox, durable M1, address and presence privacy, battery/memory/CPU, and availability of authorized relay messaging. Assume uncompromised endpoint/vault and expected pinned keys. A hostile network cannot be made trustworthy by discovery; a compromised verified endpoint can still lie/disclose data. Full backup rollback and unseen revocation remain separate unresolved security problems.

| Adversary/action | Risk | Required response |
|---|---|---|
| Passive LAN listener / network scanner | Service/app presence, addresses/ports, timing and correlation | Minimize advertisement; no identity/capability inventory; opt-in and finite foreground exposure; no anonymity claim |
| Malicious advertiser / forged records / same-name collision | Wrong endpoint, identity substitution, misrouting | Hint only; collision-safe local bookkeeping; known expected peer selected independently; final signed live binding required |
| Service-name spam / many fake endpoints / multicast floods | Cache/parse/resolve/connect/crypto exhaustion | Bounded entries, bytes, work and rates before allocation; no automatic connect-to-all |
| Endpoint churn / replayed advertisements / duplicate callbacks | Stale connection and retry storm | Generation and network scope, finite hint lifetime, idempotent updates, bounded backoff; no trust cache |
| Hostile AP / captive portal / AP isolation | Blocking, redirection, traffic analysis, false reachability | Generic unavailable state; no scanning, cleartext trust fallback or changed verification |
| Relay suppression/substitution/replay | Bad rendezvous/capability context | Existing authorization plus end-to-end signed final context; opaque relay is no authority |
| Second channel / reused certificate / reconnect race | Admission accidentally transferred to another channel/association | Dedicated PC and sole channel; fresh per-attempt certificate direction; exact local handles/generation; replacement tears down |
| Spoofed pre-auth request | Identity/version probing and resource consumption | No secret/identity inventory response; authenticate bootstrap or separately review disclosure; generic bounded failure |

Discovery is **UNTRUSTED ENDPOINT HINT ONLY**. It never creates a contact, conversation, verified state, session, account/device map, freshness or capability authority. Network access permission also grants no peer trust.

## First-carrier requirements

The first candidate must offer bidirectional reliable ordered binary message/control transport, with explicit maximum input/output frame and reassembly sizes; finite queue and backpressure; bounded pre-auth work; cancellation of every pending operation; connection-local state; independent restart/reconnect; deterministic idempotent shutdown; lifecycle/generation fencing; useful evidence of actual live transport identity for PeerAdmission; Android viability and a plausible browser reuse path. Deployment defaults off. No microphone/camera, active call, application plaintext or device signing-key export may be required by the messaging carrier.

Conversation Owner remains sole owner of Olm/session mutations, encryption/decryption, trust checks, exact saved outbox, M1/legacy pre-decrypt dedupe, durable acceptance and later reviewed receipt validation. Adapter receives bounded already-encrypted envelopes only after admission and full delivery gates. Carrier send/ack/DTLS success proves transport submission, never durable peer acceptance. Existing relay fallback/retry/ACK semantics are untouched. A failed or ambiguous optional attempt cannot clear outbox, re-encrypt, rewrite verification or relax freshness.

Current DeliveryPathAdapter and Android EncryptedEnvelopePath are seams, not full future lifecycle/backpressure/admission APIs; cancellation/close semantics and authenticated receiver context require separate review. Existing test-only adapters and service/privateNetwork are not a reviewed LAN carrier. No generic numeric call timeout, relay frame limit or spike constant is copied as production LAN policy.

## Candidate comparison

The following assessments combine exact-base source, platform references and architectural inference. None is live interoperability evidence.

| Candidate | Android / ordinary Web | LAN / future remote direct / NAT | Binding, key lifecycle, cost and exposure | Conclusion |
|---|---|---|---|---|
| WebRTC DataChannel | Existing Android WebRTC dependency; browser data API; actual messaging plumbing/binding parity absent | LAN possible with suitable signaling and permitted local candidates; future ICE reuse plausible, separately reviewed STUN/TURN needed; UDP/firewalls/AP isolation can block | DTLS cert evidence candidate; SCTP multi-stream means pair alone insufficient; transient certs must not become identity; complex ICE/signaling/native queues; exposes network metadata and costs battery/background resources | Preferred production CANDIDATE and next isolated carrier spike; D13 OPEN |
| Raw TCP | Native sockets viable; ordinary website lacks equivalent raw listener/client API | Reachable LAN sockets; no automatic traversal/firewall bypass; poor browser/common-direct reuse | No cryptographic channel binding; IP/port/ACK and signed endpoint hint insufficient; native framing/backpressure easy to underestimate; listening/DoS/address exposure | REJECTED for production PeerAdmission; dummy reachability baseline only |
| TLS over TCP | Native TLS APIs available in principle; website uses browser-controlled protocols/PKI, no generic peer SSLSocket/pinning interface | Reachable LAN; traversal still separate; web server/cert deployment adds complexity | Existing device Ed25519 could sign candidate cert bytes only AFTER separate construction review; issuer/self-signed/ephemeral/device-bound lifecycle, cert possession/channel association and pinning/rotation unresolved; extra identity machinery and key handling | Unsupported first production carrier; separate cert/key-binding review prerequisite |
| QUIC / HTTP/3 / WebTransport | No audited native QUIC server/carrier implementation/dependency in base; browser client-side transport is not a peer listener | LAN client/server could work with appropriate service; future traversal still needed; UDP restrictions remain | New server integration, cert validation/pinning/channel binding, stream/datagram rules and dependency/security surface; 0-RTT/replay would require review, cannot authorize envelopes | Deferred; not a dependency-free first carrier |
| Existing relay abstraction | IMPLEMENTED Web/Android; encrypted conversation signaling and mailbox | Internet/backend service required; not same-LAN offline direct | Reviewed current relay access controls do not provide peer optional channel-binding/capability authority; relay observes service metadata | Only current production/default path, preserved |

All candidates require finite unauthenticated connections, queues and shutdown behavior. Background viability is not guaranteed by native API availability. Raw TCP is an acceptable standalone experiment only with dummy payloads, explicit local permission, finite resources and no production imports; it cannot graduate solely on speed. If DataChannel fails binding/offline/privacy/resource evidence, record no production carrier and reconsider separately; never silently replace it with TCP.

Recommendation: one **dedicated messaging PeerConnection and one reliable ordered binary DataChannel**, independent of any call, per expected conversation/device/admission attempt. Prefer fresh transport certificate per attempt with no pooling/reuse, subject to platform and independent review. No media tracks. No sharing with calls, files or future media. No additional channel inherits admission. This is a candidate restriction to narrow multiplexing and certificate ambiguity, not proof that the APIs cryptographically identify one association.

## WebRTC facts versus proposed architecture

Standard facts: certificates can be supplied/reused; local getFingerprints and remote getRemoteCertificates are available in the specified APIs through the SCTP DTLS transport. DataChannel IDs become fixed once assigned, and SCTP can host multiple channels. An RTCDtlsTransport object can represent a replacement association. The API exposes no generic DTLS exporter or globally shared PeerConnection instance identifier. Therefore fingerprints, object identity and id/label/protocol alone cannot be treated as a unique cryptographic association identifier. [W3C WebRTC](https://www.w3.org/TR/webrtc/).

The data stack is SCTP over DTLS over ICE/UDP with reliable and partially reliable modes and multiple streams. Existing transport encryption does not attest K3NCRYPT verification. [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831).

Proposed restrictions below are this review's inference, requiring implementation evidence and independent security review. Browser-standard availability is not proof of every target browser exposing usable live evidence; Android's Java wrapper is different. See platform report for pinned API inspection and remaining validation.

### Exact evidence tuple proposed for final transcript review

No new wire serialization or crypto primitive is registered here. Extend/finalize A1's literal binding field only after approval with these candidate values:

| Value | Evidence owner/source | Security limit |
|---|---|---|
| Binding profile/schema and carrier kind | Agreed exact reviewed registry | No unrecognized downgrade or implicit alternate carrier |
| Role-ordered local/remote DTLS certificate fingerprints and explicit algorithm | Locally used transport certificate and actually observed remote certificate, after DTLS connected | SDP assertions alone not accepted; certificate may identify key, not association; reject algorithm mismatch/unknown |
| Existing A1 initiator/responder nonces and signed identity/conversation/role context | Fresh locally owned attempt state; both signatures over identical final T | Nonce pair scopes exchange, not a platform DTLS exporter; no copied nonce state across handles |
| SCTP channel ID, agreed framing subprotocol/label, ordered/reliability/negotiated settings | Actual sole open channel + retained immutable creation/negotiation settings | These are scoped within association; id/label can collide/reuse elsewhere; Android cannot read every property directly |
| Fresh certificate/no reuse and dedicated PC/channel profile constraints | Local construction and immutable ownership registry | Locally enforced property; remote nonreuse cannot simply be trusted from a signed claim |

Local admission record additionally retains exact PC/DTLS/SCTP/DC object/handle, security generation, network/policy revision and pending/confirmed state. These local handles are NEVER sent or signed as if they were common identifiers. Fresh transport certificate, attempt nonces, signed pair and channel restrictions are a candidate composite binding, not a proven exact-association token. Independent review must examine concurrent connections, identical remote certs, proxy/relay of handshakes and channel resets. If that assurance cannot be established with the target APIs, D13 has no acceptable production binding.

### Binding and ownership procedure candidate

1. Check feature, privacy, explicit verified unchanged expected identity, active lifecycle, healthy existing session and obtainable required freshness BEFORE starting optional network exposure. Expected peer/conversation comes from existing trusted local state, never advertised names/IDs.
2. Reserve bounded slot; create a dedicated PC, fresh locally scoped certificate and one channel only. No call object/controller reuse, candidate prewarming or global connection pool.
3. After permitted signaling and actual DTLS/SCTP/channel open, acquire local used and remote observed cert evidence from that connection. Reconstruct role order locally, compare with authenticated expected peer context; never copy unvalidated remote fingerprint text into local evidence.
4. Route every handshake nonce/flight through one retained channel/attempt context. If a flight uses another authenticated signaling carrier, that linkage needs explicit final transcript/channel ownership review; do not transplant a completed admission from relay or another PC.
5. Validate actual channel ID and retained creation properties; reject missing evidence, unexpected channels or changed state. Compute/sign/verify final A1/C1 transcript using pinned existing device Ed25519 identity and approved key/account mapping. Do not sign PEM private keys, endpoints or raw candidates.
6. Preserve three-flight acceptance and unresolved completion barrier; recheck M6/policy/generation before publication. Only full reviewed admission and delivery prerequisites may allow existing encrypted envelopes.
7. Bind dispatch to exact retained channel handle AND current generation on every send/receive. Discard state on close/replacement, renegotiation, ICE restart/network migration or uncertain association continuity; first implementation should close and rebuild rather than reuse admission.

One channel on a dedicated PC might make application ownership enforceable without independent channel crypto if the transcript/association proof is approved. It does not magically upgrade PC-level evidence into exact transport binding. A second channel, including same ID/label, must receive no application traffic; candidate response is close the entire messaging PC and invalidate admission. File channels later require their own reviewed scope, never inherit this exception. Simultaneous open, duplicates, callback cancellation and lost confirmation remain A1 review items.

Concrete gaps: no browser exporter; association replacement may reuse DTLS object; certificate reuse may span PCs; stream resets/reuse must be detected or force teardown; Android remote certificate-to-current-SCTP association mapping and actual stats completeness unexecuted; Android runtime channel properties only partly exposed; no approved binding serialization, cert lifecycle/privacy policy or final key/lifecycle mapping; no production completion barrier; no safe offline bootstrap. A local integer generation prevents callbacks reopening closed state but is not cryptographic evidence.

## Reuse of calls and signaling

Web Peer immediately requests media and owns a call PC; BrowserCallMediaConnection/ProductionCallNegotiator retain connections by callId and close on call end, with automatic call ICE restarts. AndroidWebRtcEngine creates audio/media objects, gathers continually and closes/disposes onDataChannel. AndroidCallController owns callId/lifetime. They cannot be directly reused as messaging lifetime owners. Factory/config/event/queue concepts could be factored later under reviewed independent messaging ownership; no source factoring here and no microphone/camera permission for messaging.

Existing AuthenticatedCallSignalTransport encrypts call signaling through the existing conversation and validates participants/context; backend webrtc-signal forwards opaque authorized envelopes to an online peer. This is useful architectural precedent, not approval to insert new message controls into call parsers. A1 old-client-safe discriminator/bootstrap remains OPEN; current protocolFeatures hints cannot authorize a new probe. The relay remains opaque and is not capability/identity authority. Call-signaling relay dependency means it does not solve Internet-off cold start.

A local NSD port/locator is not a WebRTC ICE endpoint or an SDP exchange. WebRTC requires compatible offer/answer/candidate exchange. The missing local rendezvous transport, safe old-client framing, intended peer recognition, pre-auth confidentiality and replay/limits must be reviewed independently. A raw local signaling listener may also expose conversation/identity/capability data; it is not authorized by declaring TCP 'only signaling'. A user-entered/QR endpoint is a diagnostic hint only. No HTTPS certificate validation bypass or arbitrary fetch/scanning is acceptable to bootstrap.

## Discovery options

| Mechanism | Permissions / reliability / exposure / Internet / browser limits | Review candidate |
|---|---|---|
| Android NSD/DNS-SD/mDNS | Framework-managed service discovery; exact OS/target rules in platform report. Shared LAN/multicast required; collisions/churn/spam and OEM/lifecycle behavior need measurement. Service names/TXT/host/port expose presence. No Internet inherently needed for local discovery, but does not provide signaling or identity. Ordinary website has no NSD browse API. | Preferred Android experiment, foreground user-initiated hint only; production registry/bootstrap remains OPEN |
| Custom multicast/broadcast | Historical dummy spike only; raw multicast may require Wi-Fi lock/permissions and power cost. Forgeable, floodable, unreliable under filtering; raw browser sockets unavailable in ordinary Web. | No first-production justification over framework NSD; dummy baseline only, no new beacon protocol |
| Manual local endpoint/QR | Explicit user action, no active network enumeration. Copied/replayed endpoint and camera permissions possible; QR locator is not verified identity. Offline native diagnosis possible. Browser bootstrap still constrained. | Developer/test-only fallback to separate discovery versus carrier failure; not a new invitation/contact flow |
| Authenticated relay-mediated hints | Existing access and encrypted conversation could carry a later approved ephemeral rendezvous hint; online required. Relay can withhold/change unauthenticated metadata. Capability authority still both peer signatures. | Online alternative after new-control rollout review; no offline dependency hidden |
| Bluetooth/Wi-Fi Aware/Nearby | Additional platform permissions, hardware/interop and privacy complexity; ordinary browser participation limited; no audited first-LAN implementation | Deferred separate review; not added as workaround |

AP isolation may permit service visibility but block unicast, or block multicast altogether. Discovery success and carrier success are separate. Never enumerate subnet addresses or connect-to-all advertised records. Resolve only bounded selected hints under policy; do not search contact inventory against every unknown advertiser. Broadcast/mDNS is not confidential; hiding IP in UI/logs does not hide it on network.

## Advertisement minimization and rotation

Candidate minimum: opaque random per-advertising-session instance name; registered service type needed for discovery; local host/port locator inherent to DNS-SD; possibly an opaque random rendezvous identifier only if a reviewed bootstrap requires it. Name/type/format/token length and entropy remain OPEN. No production service type or TXT schema is assigned. A service type itself identifies app/protocol family, so 'omit bootstrap version' does not mean no targeting metadata.

Prefer omitting version/TXT capability information initially. If a bootstrap format marker is necessary for safe parsing, owner/security must document why its targeting/leakage is acceptable; it may reject obvious incompatibility only, never grant support. Port addresses an approved rendezvous service, not direct application messaging. No stable values in TXT/service name/hostname; OS-derived hostnames and platform collision suffixes may still link a device and require physical observation.

Prohibited: username/contact/email, fingerprint/verification state, stable account/device identity, conversation/route IDs, long-term capability list, software/security posture, invitation/session/key material, private tokens, precise network/interface inventory. Never encode an identity-derived beacon, even hashed, as an improvised privacy scheme.

Generate random opaque IDs independently of identity; do not persist across restart. Rotate on each advertising session, app restart and network change; within-session rotation interval is REVIEW PARAMETER — OPEN and must balance correlation versus stale-resolution/resource/usability churn. Withdraw old registration/hints, fence callbacks and never extend admission because a beacon reappeared. MAC/address/hostname/timing linkage can remain despite token rotation. Random IDs do not let known peers recognize one another. A future authenticated privacy-preserving rendezvous mechanism could distribute targeted locators through existing secure conversation, but is not designed here and cannot rely on online relay for the promised cold offline case.

## Safe flow and pre-auth exposure

```
local global/device/contact policy + explicit trust/session prerequisites
 -> OS permission and approved resource budget
 -> permitted foreground discovery/advertising (optional)
 -> selected opaque endpoint hint, existing expected peer chosen independently
 -> reviewed bootstrap / bounded provisional dedicated carrier
 -> fresh PeerAdmission challenge + complete A1 offers, both signatures
 -> authoritative current freshness/lifecycle/policy checks + completion barrier
 -> admitted exact channel/generation
 -> encrypted envelopes only after full delivery checklist
```

Advertising is device-global and observable to LAN observers, even if only one contact opted in. Consent must state that fact; per-contact denial cannot erase already broadcast presence. Per-contact permission still blocks directed rendezvous/gathering/admission to that contact. If no eligible opted-in contact exists, recommended behavior is no advertising/browsing. Neither contact trust inventory nor identity-specific reasons are returned to an unknown endpoint.

Before admission: no application envelopes, trust/session mutations, contact or conversation creation; finite provisional work only. A1 unsigned F1 can trigger disclosure of responder offers in F2. Provisional DTLS encrypts traffic from passive listeners but authenticates a transport cert, not the expected K3NCRYPT peer; an active endpoint can read responses. Therefore complete offers/identity/conversation context must use a reviewed existing authenticated encrypted channel or separately reviewed initial authentication/confidentiality mechanism before disclosure. No new construction is invented. This remains an A1-W/D14 blocker; merely signing F2 does not hide its content from an attacker.

| Stage | Permitted exposure candidate | Forbidden/blocked |
|---|---|---|
| Relay-only / privacy denial | Current authorized relay traffic only | Optional browse, advertise, PC creation/prewarm, gathering, local listener/probe |
| Foreground explicitly permitted discovery | Minimal service/type/locator and unavoidable presence timing | Stable identities, capabilities, trust inventory |
| Provisional permitted carrier | Needed transport cert, addresses/ports/SDP only under approved bootstrap/privacy rules | App envelopes; assumption of verified peer; sensitive A1 disclosure before authenticated bootstrap |
| Authenticated admitted context | Exact bounded signed peer/capability context, transient permitted candidate evidence | Durable trust from carrier; raw transcript/candidate diagnostics |

Current browser configuration exposes only standard all/relay ICE policy; empty iceServers is NOT a general host-only/interface isolation policy. Host candidates can contain globally routed IPv6, VPN/other interfaces; filtering signaling after gathering does not prevent gathering or connectivity checks. A strict LAN-only production promise needs candidate/interface/destination policy and demonstrated target-platform behavior. Internet-off lab must physically eliminate WAN/cellular/other egress and record it. Do not silently turn an Internet-reachable candidate into 'Nearby'. No gathering merely to discover feature support.

## D14 privacy controls and defaults proposed

These controls are future requirements, not UI implementation or owner approval:

| Scope | Minimum first-LAN policy | Default/coupling |
|---|---|---|
| Global Nearby/LAN | Explicit opt-in and explanatory LAN presence/address disclosure | OFF during rollout; toggling OFF cancels all optional exposure immediately |
| Global discovery / advertising | Separate effective states and meaningful permission to advertise this device | Both OFF until explicit Nearby/discovery/advertising consent; enabling Nearby alone should not silently imply advertising consent |
| Hide my IP / relay-only privacy | Effective prohibition on all optional direct/LAN exposure, not just final path selection | No gather/browse/advertise/listen/probe while enabled; relay-only remains valid |
| Per contact | Allow optional Nearby path, independent relay-only override | OFF until explicit consent; override wins; explicit verification remains separate |
| Per device | Advertise this device (within global permissions) | OFF; no node privileges inferred from verified device |
| Direct Internet | Separate later opt-in, candidate/traversal/privacy profile | OFF/unimplemented; Nearby consent cannot enable Internet-direct |
| Background | Explicit future mode plus platform/security/battery approval | First candidate foreground-only; background/screen lock stops optional work |

Owner may combine controls in a understandable UI if effective discovery and advertising states remain explicit and separately consented. Ambiguous/missing policy/OS permission fails closed. Do not ask OS permission on install or mere conversation load; ask only after the relevant user action/rationale. A runtime permission grant must not auto-enable features. Revocation/Hide-IP/contact override takes precedence and fences async callbacks. Relay availability means under existing authorization/connectivity, not guaranteed Internet or mailbox access. No guarantee of anonymity or concealment from relay operator/AP.

## Platform requirements

Repository compile/target API 35, minSdk 26; Android production manifest has INTERNET, microphone/camera/biometric only, no NSD-specific permissions, local-network runtime permission or foreground service. Do not add any in this branch. Pinned WebRTC library 150.7871.01 is already present, but messaging/fingerprint parity is unexecuted.

Current official guidance distinguishes target SDK: Android 16 protection opt-in uses NEARBY_WIFI_DEVICES; Android 17 requires ACCESS_LOCAL_NETWORK for targets >=37, while <=36 uses implicit INTERNET grant. A system NSD picker is an alternative for selected-device access at the newer target, not proof of suitability for advertising/listening. Android 16 opt-in has framework NSD exceptions, so its pass cannot stand in for Android 17/native traffic tests. Existing target35 needs revalidation under planned target upgrades, not permission changes here. [Android local-network permission](https://developer.android.com/privacy-and-security/local-network-permission).

NSD performs framework discovery/registration and may rename collisions; no stable name mapping is assumed. Exact API availability/behavior from min26 through tested OS versions needs physical trials. [Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd). CHANGE_WIFI_MULTICAST_STATE is the manifest permission for Wi-Fi multicast mode, not a user identity permission. [Android permission reference](https://developer.android.com/reference/android/Manifest.permission#CHANGE_WIFI_MULTICAST_STATE). Raw custom multicast receiving may need a Wi-Fi MulticastLock; lock and permission ownership must be bounded, and framework NSD must not inherit a lock solely from spike code. [MulticastLock](https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock).

NEARBY_WIFI_DEVICES applies to listed Wi-Fi management/Aware/P2P/hotspot APIs; do not blanket-add location/Wi-Fi scanning permissions for NSD. No SSID/subnet scanning is proposed. [Wi-Fi permission guidance](https://developer.android.com/develop/connectivity/wifi/wifi-permissions).

Foreground-only first candidate shuts down when app leaves foreground/locks, without a discovery FGS or background entitlement. Background listening is a separate product/platform decision: foreground service types/start restrictions and notification requirements must be reviewed. Do not assume connectedDevice is the right type for a messaging use case; official guidance distinguishes remote messaging. [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types). Doze/battery/network suspension must be measured; a service is not unlimited execution permission. Android 12+ background FGS starts are restricted and require a documented exception if applicable. [FGS start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start). Android 13+ POST_NOTIFICATIONS is distinct from service start permission: an FGS still requires a notification even when that runtime permission is denied. [Notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission). Doze can suspend ordinary network access; no continuous background LAN availability is promised. [Doze/App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby).

Ordinary Web has no Android NSD browse or arbitrary raw TCP/UDP socket listener. Direct Sockets is an Isolated Web App facility, outside this site's deployment; do not silently adopt IWA/extension/helper dependencies. [Chrome Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets). DataChannel API availability is not offline discovery/rendezvous support. Browser must already be loadable under its deployment/cache policy, and secure context/browser privacy behavior needs versioned tests. The consulted Chrome LNA article lists feature gaps including WebRTC and planned expansion; it is not a cross-browser permission guarantee or assurance against future changes. [Chrome LNA](https://developer.chrome.com/blog/local-network-access). No browser prompt substitutes for application privacy gates. No microphone/camera request is needed for a data-only candidate.

## Network metadata handling

| Data | Transient memory | Signed admission / persistence | User display / logging |
|---|---|---|---|
| Private/public IPv4/IPv6, port, subnet/interface, network type, mDNS hostname, ICE candidates/SDP/ICE credentials | Only minimal connection/bootstrap scope after policy; wipe references on close; underlying platform may retain network metadata | No raw endpoint/candidate in proposed PeerAdmission; no durable cache/history/telemetry absent separately approved requirement | No raw values by default or in diagnostic logs; no exception-message/SDP/RTCStats dump |
| Cert fingerprints / cert data / signature / complete T | Only bounded verifier/connection scope; Android API returns privateKey field, never serialize/inspect/log it | Public fingerprint evidence only in reviewed signed transcript; no persistent admission authority; private cert keys remain transport-internal | No fingerprints/keys/signatures/transcript/PEM in UI/logs |
| Opaque discovery instance/rendezvous ID | Bounded short-lived hint map, scoped to network/session | No persistence across restart, no contact/identity index; token not an authority | No raw token/name/service record logs or display as contact identity |
| Safe state/reason and aggregate measurements | Bounded enum/count/time aggregates without raw peer identity/endpoint | May persist only reviewed aggregate test evidence or user preferences, not sensitive cache | Connection/policy/admission states and safe reason enums only |

PeerAdmission binds actual transport cert/channel context, not addresses. Hashing an address does not automatically make it safe to persist/log. Retry outbox retains exact existing ciphertext under its existing policy; no candidate metadata should be embedded into message storage. Packet captures needed by a later disposable-device test are restricted local artifacts with synthetic data, explicit operator authorization and sanitized aggregate report; they are not application logs and not committed. No remote analytics/fonts/assets/resources are introduced.

## Resource and lifecycle contract

All entries below are **REVIEW PARAMETER — OPEN** unless a later owner/security decision supplies exact value and platform evidence:

| Budget | Required behavior |
|---|---|
| Discovered entries, record/TXT/name bytes and parse/update rate | Cap before allocation; evict hints without evicting trust; duplicates do not extend indefinite lifetime |
| Resolve queue/rate, per-network and global provisional connections | No connect-to-all; reserve slots before native work; reject saturation generically |
| Handshake/verification work and concurrent pending attempts | Cheap syntax/context/policy checks first; bounded queues and cancellation |
| Frame/message/reassembly/native and app buffering | Application cap plus platform negotiated limit; full reliable mode; finite send queue/backpressure; send refusal leaves outbox intact |
| Retry/backoff/connection rate/idle and negotiation deadlines | Jittered bounded retry, no advertiser-driven spin; monotonic local timers/continuity review, no message T implied |
| Replay cache, hint TTL and advertisement rotation | Finite size/retention, expiry cannot authorize replay; no persistent admission cache |
| Memory/CPU/battery and shutdown deadline | Per-owner/global quotas; deterministic release of NSD registrations/locks/native handles; no late callback reopening |

Future adapter must never accumulate data while bufferedAmount exceeds reviewed high-water limit; resume only on verified live-generation low-water condition or bounded native equivalent. Native maxMessageSize/reassembly behavior must be measured. Frame segmentation, if required for envelopes, needs its own bounded framing/reassembly review; do not let transport fragments create unbounded buffers. Exceeding any budget disables optional attempt, never weakens signature/trust/delivery checks. Existing signer 16KiB ceiling is only a ceiling, not a complete carrier budget.

| Event | Candidate response |
|---|---|
| Wi-Fi loss / network switch / DHCP/address/interface/IPv4/IPv6 change | Stop advertising/browse, discard network-scoped hints, cancel carrier/admission and increment generation; rebuild only after policy/network prerequisites |
| Sleep/wake / background/foreground / lock/unlock | First foreground-only candidate closes on departure/lock; no authority restored on wake; fresh attempt on explicit allowed foreground state |
| Peer disappearance / connection failed or idle timeout | Optional unavailable; close/cancel; no revocation/unverification inference; retain outbox |
| ICE restart / cert/channel replacement / renegotiation | Close/recreate and require new admission rather than reuse uncertain association |
| Permission/privacy/feature/trust/lifecycle/session/freshness changes | Invalidate pending and confirmed state immediately; fence queued native/promise callbacks |
| App/process restart / restore | No advertisement ID/admission/cache resumption; fresh local challenge and all current gates |

Relay remains available whenever Internet and existing authorization allow it. Future ambiguous-send cross-path retry requires full M1/horizon/receipt/outbox rules before implementation; this review makes no fallback change. No admission survives a nonexistent/replaced connection. A network change is not a security compromise by itself.

## Internet-off and isolated-network behavior

| Stage | Internet-off feasibility | Security consequence |
|---|---|---|
| Already-known contact/session and local pinned identity | Existing local state may be available; readiness adoption still missing on Android base | Never recreate from discovery; route/fingerprint presence alone is insufficient |
| Native NSD | Local multicast can operate without WAN if network permits | Forgeable endpoint hint, not identity; actual cold behavior needs physical test |
| WebRTC carrier | Local ICE/DTLS/SCTP may work with complete local signaling, no public STUN/TURN | No current offline bootstrap; empty iceServers is not proof of LAN-only selection |
| Current call/relay signaling | Cannot complete new relay exchange with backend unreachable | Must not relabel cached online signaling as offline cold start |
| PeerAdmission/A1 | Protocol/verifiers/completion/binding not implemented/approved | Networking success never equals admitted application path |
| M6 | No approved source proves current remote revocation state during complete partition | Required missing/unknown freshness blocks optional admission; F3 recommendation is not owner approval; F2 not authorized |
| Application messages | Full delivery semantics remain open even if dummy carrier succeeds | No production message flow from feasibility evidence |

A physical throwaway test can prove network feasibility with dummy payloads while recording real optional authorization as blocked, without bypassing or faking freshness. A mock fresh=true is never production evidence. Future real offline messaging must explicitly settle whether/when approved authority evidence is sufficient; no bearer cached signature or senderOrigin timestamp solves it. If Internet absent before app start, relay locator refresh cannot be a hidden dependency. First browser LAN scope is online approved signaling only if eventually reviewed; offline browser participation stays unpromised.

AP/client isolation is an availability limitation. UI: 'Nearby unavailable on this network; using relay if available.' If no Internet, queued messages retain existing semantics; no false sent/delivered status. Do not implement subnet scans, gateway workarounds, automatic hotspots, UPnP/port forwarding, VPN bypasses or permission escalation to defeat isolation.

## Observability contract — future UI only

| Audience/state | Meaning / permitted presentation |
|---|---|
| Normal Relay / Nearby | Current actually used message path; Nearby only after admission+delivery eligibility, never from discovery/ICE alone |
| Nearby/direct disabled for privacy | Effective local policy; no optional exposure occurred |
| Waiting for secure peer admission | Provisional context exists, no app envelopes allowed |
| Verification changed / freshness unavailable | Local safe explanation, not remote detailed failure; does not alter verification based on path success/failure |
| Optional unavailable / network isolation suspected | Bounded availability message; do not diagnose hostile AP solely from timeout |
| Advanced | Discovery/advertising enabled or disabled; admission pending/confirmed/rejected; capability compatible/incompatible/unknown; privacy relay-only/Nearby allowed/direct allowed; relay availability separate from current path |
| Developer | Bounded DISCOVERY_DISABLED, PERMISSION_DENIED, RESOURCE_LIMIT, NETWORK_UNAVAILABLE, BINDING_UNAVAILABLE, ADMISSION_PENDING, ADMISSION_REJECTED, FRESHNESS_UNAVAILABLE; no peer/address/token identifiers |

These are state requirements, not added UI. Avoid delivery/persistence claims from channel state; transport labels do not imply explicit verification. No raw addresses/candidates/fingerprints/transcripts/signatures/keys/tokens. Expose global advertising status honestly even when a contact is relay-only; operator/AP metadata privacy is not promised.

## Future compatibility and open decisions

Future self-hosted rendezvous/encrypted relay/helper devices may provide routing only; node permission is separate from verified-device status, relay proof and account authority. No user node is implemented. Future file streams require separate bounded stream/admission/capability/expiry/resource profiles; they cannot create a second channel under this first sole-channel admission. Media/signaling may reuse infrastructure concepts with independent owners, never call or file traffic sharing by implicit authority. Larger transfers require chunk/reassembly/congestion/backpressure review. These future features must not force weaker first LAN binding.

| Decision / blocker | Who / exact closure evidence |
|---|---|
| D13 dedicated DataChannel candidate | Owner + carrier security reviewer after physical cold-offline/interface/backpressure/interop evidence |
| Exact cert/association/SCTP/channel binding | Independent reviewer + platform owners; Android observed remote cert stats mapping, browser replacement/reuse cases, sole-channel ownership |
| Offline rendezvous/intended peer recognition | Protocol/security/privacy owners; safe bootstrap, no stable broadcast identity, no hidden relay dependency |
| D14 foreground/advertising/discovery/Hide-IP/per-contact policy | Explicit owner choice and privacy review of actual exposure and OS prompts |
| Pre-auth A1 offer/identity confidentiality and final completion | A1/PeerAdmission security review; no disclosure justified merely by provisional DTLS |
| Advertisement schema/service type/rotation/entropy | Owner/security/platform approval; bounded collision/churn/linkability tests |
| Android target/permission/background and browser support matrix | Platform owners; actual supported device/browser tests, no unsupported-version promise |
| Resource numeric bounds | Security/resource owners; finite spike budgets before experiment and production budgets before adapter |
| M6 F1/F2/F3 and time/restore | Explicit owner/security closure; F2 not authorized; F3 only recommended |
| Android adoption/Web verifier and expected device/lifecycle mapping | Separate current-line adoption and supported-platform validation |
| E1/common horizon/receipt/outbox completion | Owner/protocol/delivery security closure; capability labels do not close these |

**D13 OPEN:** architecture narrowed to dedicated sole-channel WebRTC for evaluation, no production carrier approved. **D14 OPEN:** minimum controls/defaults/advertisement direction specified, owner approval and actual platform/exposure evidence absent. Neither is CLOSED or partially approved; findings are partial analysis only.

Before production implementation, close required review rows and independently approve final protocol and exact source adoption. Stop if target APIs cannot provide binding, local-only policy cannot be enforced, bootstrap requires confidential data disclosed to unauthenticated endpoints, unknown freshness is relaxed, verifier/trust state missing, resources unbounded or compatibility not demonstrated. No production LAN adapter starts here. The physical plan ranks prerequisites separately for dummy spike, production implementation and user enablement.


## Validation and changed-file scope

Documentation-only: eight files. New carrier/discovery/privacy master review,
immutable reconciliation, platform-evidence report and staged physical test plan;
link/status overlays in HANDOFF, specification-map, peer-admission-v1 and
A1 authenticated-capability-review. Existing historical text and unsigned fixture
bytes are preserved; no production/test source, UI, manifest, lockfile/dependency,
flags or cryptographic output changed.

npm run lint PASS; git diff --check PASS. Existing locked dependencies installed
with npm ci --ignore-scripts --offline; no dependency changes. Jest/Kotlin unit
tests NOT RUN: no fixture/test-only code changes and this request conditions them
on those changes. Android instrumentation NOT RUN: no production/instrumentation
change. No network experiment, NSD, ICE gathering, socket/DataChannel, browser
runtime or physical-device test ran. javap is read-only API inspection. Prior
A1 root/service/Kotlin passes remain prior evidence, not rerun results here.
