# Local Session security fence and Android LAN experiment contract

Date: 2026-10-05. Review branch: `docs/local-session-security-bootstrap-review`.
Exact base: `6e71bc38f77a560f7066a244d4f6c8b5a55f5853`,
`docs/master-product-security-architecture`.
Refreshed `origin/main`: `66b0b5ca1fce0a2dd10075a563450bbd346a3677`.
Documentation-only source/platform review; no devices or carriers executed here.

## 1. Scope and decision

[Master architecture](../PROJECT_SECURITY_ARCHITECTURE.md) owns product intent
and domain boundaries. [HANDOFF](../connectivity/HANDOFF.md) and
[specification map](../connectivity/specification-map.md) retain exact historical
status and conflicts. Main-domain protocol decisions remain separate.

**DECISION for the bounded experiment: option A — foreground Android NSD plus a
small local TCP dummy transport, with synthetic experimental text only.**
Use a separate debug-only application module/package, not the normal application
runtime. This is an implementation-ready transport-only contract. It does not
approve an authenticated Local Session protocol, production raw TCP,
PeerAdmission or a main-domain optional path.

The next branch may implement real code and attempt the two-physical-Android,
same-router, Internet-off experiment. No hard design blocker requires another
broad documentation branch. Authenticated temporary pairing remains OPEN and
is explicitly excluded from this milestone. Device availability, platform
permissions, NSD behavior and AP isolation may block execution; report exact
observations, not emulator substitutes or fabricated physical success.

Use the master's status vocabulary: IMPLEMENTED source is exact-base evidence;
BRANCH-ONLY is not adoption; VALIDATED has a named scope; OPEN/BLOCKED identify
unresolved prerequisites; PLANNED is future behavior; DECISION here applies only
to this bounded experimental contract.

## 2. Android boundary audit at the base

| Source/owner | Current boundary | Consequence for Local Session |
| --- | --- | --- |
| [settings](../../android/settings.gradle.kts), [app build](../../android/app/build.gradle.kts) | `:app` composes core/crypto/network/storage/security/messaging/media/calls; Hilt and Compose. min26, compile/target35. | Existing app dependency graph imports main authority. New test module must not depend on these authority modules. |
| [RuntimeModule](../../android/app/src/main/kotlin/com/k3ncrypt/app/RuntimeModule.kt) | Singleton Hilt providers connect identity, native crypto, encrypted storage, backend API, device proof and relay to messaging. | Do not inject this module or main repositories into experiment code. |
| [Application](../../android/app/src/main/kotlin/com/k3ncrypt/app/K3ncryptApplication.kt), [MainActivity](../../android/app/src/main/kotlin/com/k3ncrypt/app/MainActivity.kt), [manifest](../../android/app/src/main/AndroidManifest.xml) | Hilt application; activity injects identity/messaging/API/relay/calls/vault. Launcher activity exported; no declared service or separate process. Vault authentication and resume relay registration occur here. | A new activity in this runtime would not supply a meaningful authority fence. Do not bypass vault protections to reach experiment UI. |
| [AndroidMessagingRepository](../../android/app/src/main/kotlin/com/k3ncrypt/app/AndroidMessagingRepository.kt) | Owns normal invitations, saved conversation selection/pinning, sessions, relay join/proofs, send/retry/receive and encrypted call signaling. | No reuse of repository, conversation model or callbacks. Calls are coupled to main conversation/relay authority. |
| [AndroidIdentityLifecycleRepository](../../android/app/src/main/kotlin/com/k3ncrypt/app/AndroidIdentityLifecycleRepository.kt) | Owns account handle/checkpoints, bootstrap/enrollment/restoration, lifecycle/proof operations. | Entire owner prohibited; temporary contexts must not register/enroll a device. |
| [CryptoPort](../../android/crypto/src/main/kotlin/com/k3ncrypt/crypto/CryptoPort.kt), [JNI Rust](../../android/native-crypto/src/lib.rs) | Opaque account/session handles; Vodozemac creates accounts, signs and encrypts/decrypts. JNI stores handles in process-global maps. `signControlEvent` has a 16KiB bound; no public signature-verification method in this port. | Primitive existence is not a reviewed Local Session authentication flow. First transport spike imports neither JNI nor CryptoPort. |
| [SecureDatabase](../../android/storage/src/main/kotlin/com/k3ncrypt/storage/SecureDatabase.kt), RuntimeModule | Room `k3ncrypt-secure.db`, `secure_records` keyed by namespace/recordId; generic DAO/record APIs can access broad state. | A namespace alone does not constrain a broad repository reference; no Room access in spike. |
| [CryptoStateStore](../../android/storage/src/main/kotlin/com/k3ncrypt/storage/CryptoStateStore.kt), [PickleKeyVault](../../android/storage/src/main/kotlin/com/k3ncrypt/storage/PickleKeyVault.kt), [LocalVaultGate](../../android/storage/src/main/kotlin/com/k3ncrypt/storage/LocalVaultGate.kt) | Main accounts/sessions/checkpoints, inbound/outbound history, outbox/dedupe/trust-related state; encrypted transactional commits. Pickle keys in encrypted records. | No normal storage, history/outbox, dedupe or trust namespace access. No migrations. |
| SecureDatabase / KeystoreAead | AES-GCM storage keys in AndroidKeyStore; legacy `k3ncrypt.android.v1.storage` and authentication-bound `k3ncrypt.android.v2.authenticated.storage`. | No existing alias use, key enumeration, vault unlock or key deletion. First spike creates no Keystore keys. |
| [network module](../../android/network/build.gradle.kts) | API, proof/lifecycle, SocketRelay, optional-envelope seams; no implemented NSD/discovery adapter. | Network module is not a safe shortcut: no backend or relay dependency in experiment. |
| [AndroidCallController](../../android/app/src/main/kotlin/com/k3ncrypt/app/AndroidCallController.kt) | Call-owned state/queues/restart; encrypted relay signaling through messaging and identity repositories. | Not an offline signaling owner or independent text-session controller. |
| [AndroidWebRtcEngine](../../android/calls/src/main/kotlin/com/k3ncrypt/calls/AndroidWebRtcEngine.kt), [calls build](../../android/calls/build.gradle.kts) | PC factory and media objects; UNIFIED_PLAN, continual ICE gathering, audio and optional video tracks; incoming DataChannel closed/disposed. Pinned `io.github.webrtc-sdk:android:150.7871.01`. Calls module depends on crypto/security/network. | Dedicated data-only owner needed later. Do not modify call engine or keep a call alive for text. |
| Android source/manifest search | No NSD/NsdManager, Bluetooth implementation, network service or `android:process` declaration found; only call engine DataChannel handler. | Discovery/Bluetooth/service isolation are not existing implemented products. Search finding is scoped to this base. |

The audit covers ownership and coupling, not a complete security audit or fresh
runtime verification. Existing delivery work remains BRANCH-ONLY relative to
main as recorded in the master. No main M6/A1/D13/D14/E1/receipt issue is closed.

## 3. Placement and access matrix

**DECISION:** next branch adds `android/local-session-experiment` as an Android
application module, application ID `com.k3ncrypt.localsession.experiment`, with
its own ordinary Application and launcher activity. Use existing AGP/Kotlin
versions and framework UI where practical. No Hilt, Room, JNI, WebRTC or project
module dependencies are necessary for option A. Include through an explicit
Gradle opt-in property such as `-PlocalSessionExperiment=true`; normal builds do
not include it. No distributable release variant; only debug experiment APK.

Different application ID, no shared UID, no IPC/file grants to the main app,
no exported services/providers/receivers, no main deep links and no imported
production Application provide a practical fence. Android assigns apps separate
UID/process sandboxes by default; this is a platform boundary, not protection
against a compromised OS. [Android application sandbox](https://source.android.com/docs/security/app-sandbox).

| Access | Classification | First experiment rule |
| --- | --- | --- |
| CSPRNG-generated ephemeral context IDs | ALLOWED | Random 128-bit per Start/Join; nonsecret correlation only, not identity/authentication. |
| Temporary pairing keys/secrets | CANDIDATE / OPEN | None generated or transmitted by first spike. Future reviewed ephemeral authentication only. |
| Local discovery/locator and carrier state | ALLOWED | Bounded memory, selected Wi-Fi scope, no log/persistence. |
| Separate Local Session storage | CANDIDATE | Memory-only first; no database/files/preferences for sessions/messages. |
| Temporary text and safe diagnostics | ALLOWED | Synthetic text, fixed limits, no persistence or export. |
| File-transfer and call state | CANDIDATE / PLANNED | No files or calls in spike. |
| Network capability/lifecycle status | ALLOWED read-only | Framework Wi-Fi/network/foreground state, no SSID/account/profile lookup. |
| Public main display name/contact label | FUTURE read-only candidate | Not permitted in spike; later a narrow user-consented DTO, never broad repository access. |
| Main private identity/account/session handles and keys | PROHIBITED | No CryptoPort/JNI/account owner access, even through helper methods. |
| Main verified-contact/trust/PeerAdmission/lifecycle authority | PROHIBITED | No read/write/inference or promotion, no revocation/verification side effect. |
| Relay/API/proof/control capability/tokens | PROHIBITED | No backend clients/config, HTTP/Socket.IO/Render signaling or fallback. |
| Main Room/history/outbox/dedupe/trust namespaces | PROHIBITED | No reads/writes/migrations; no normal envelope parser or conversation IDs. |
| Main Keystore aliases/pickle keys | PROHIBITED | No reuse/enumeration/deletion. |
| Shared storage, clipboard, backup/session restore, analytics | PROHIBITED in spike | No automatic import/export, remote assets or runtime resources. |

No permission to main state follows from residing in the same repository.
Static dependency/import inspection and the installed package boundary must be
checked in the next branch. Do not add an IPC bridge just to prove isolation.

## 4. Temporary identity and pairing review candidate

Preferred future identity: an ephemeral per-session key/context, never the
normal device private key. A per-install Local Session-only key is a later
candidate if explicit continuity requirements justify persistence; it is not
necessary for the first milestone. No local key can become a main identity.

Existing Vodozemac supports independent account creation and Olm sessions, and
existing platform crypto supports storage encryption. Neither observation
establishes a reviewed temporary mutual-authentication/bootstrap protocol.
The current Android port lacks the explicit signature verifier needed for the
reviewed main candidate; Olm encryption alone does not identify the intended
person. No new primitive, custom KDF/signature scheme, QR secret sent in plaintext
or improvised password handshake is authorized.

Future candidate flow (OPEN, not implementation authorization):

1. A explicitly starts, creates ephemeral authentication context and displays
   a session-specific high-entropy QR/invitation through a deliberate local UI.
2. B scans/enters it through an intentional out-of-band action, selects an
   untrusted provisional endpoint and connects.
3. A reviewed existing authentication mechanism binds both roles, context,
   version, transcript and actual channel; prove possession without exposing
   pairing secrets to an attacker-controlled endpoint.
4. Both confirm temporary pairing, with replay/completion/lifecycle rules and
   no permanent verification side effect. Invitation expires/consumes under
   explicit rules; no reconnect authority transfers to another connection.

Missing evidence: selection of an existing reviewed mechanism, its exact
credential/peer binding, mutual proof and confirmation, secret exposure policy,
replay/lifetime rules and implementation verifier/parity evidence. Consequently
**authenticated pairing is BLOCKED for this milestone**; transport feasibility
is not blocked. Do not present a fake authenticated success state.

First spike: B selects a discovery hint and presses “Connect to unverified test
endpoint”; A explicitly accepts a bounded incoming test connection. Both see
“Unauthenticated / unencrypted — synthetic test data only.” Public random
context IDs correlate attempts; matching them is not authentication. No pairing
secret or QR scanner is needed. “Paired,” “verified” and “secure session” must
not appear as achieved states. Fake endpoints/MITM/plaintext observation remain
possible and are disclosed. Reconnect always requires a new Start/Join, fresh
contexts and explicit acceptance; no automatic retry or resumption.

## 5. Memory, restart and cleanup

All contexts, hints, sockets, text, queues and diagnostics are memory-only.
No normal history/outbox/delivery/verification state. No savedInstanceState,
SavedStateHandle, rememberSaveable or automatic backup of experimental state.
UI recreation ends the attempt unless the next implementation explicitly proves
its lifecycle owner survives safely; default is end and restart manually.

On Stop/End, screen lock, background, network/address change, permission loss,
timeout, saturation or malformed input: invalidate generation first; disable
send; cancel jobs; close accepted and listening sockets; unregister advertising;
stop discovery/resolve and callbacks; clear queues/context/hints/text; return to
inactive or a safe failed/disconnected summary. Clear sensitive byte arrays
where practical; managed/native memory and OS buffers cannot guarantee erasure.

Process death/restart has no resumable state; relaunch starts inactive. No session
orphan files/database rows exist by design. A stale framework service hint may
persist briefly after death and cannot authorize a connection. Explicit teardown
must request unregister/stop and fence callbacks; platform withdrawal timing is
measured, not assumed. No cleanup touches main state. Timeout cleanup completes
locally within two seconds or records CLEANUP_TIMEOUT and leaves all controls
inactive; late platform callback completion cannot recreate work.

## 6. Experimental framing contract — not production wire approval

Only the standalone transport experiment uses namespace
`k3ncrypt/local-session/transport-experiment/1`. Do not register it in main
capabilities or dispatch it to normal message/call/envelope parsers.

Concrete next-spike framing (DECISION, throwaway test format):

- Each side writes the exact eight ASCII bytes `K3NLSX1` followed by LF (eight
  bytes total: seven visible characters plus LF) once per connection.
- Frames: four-byte unsigned big-endian payload length, then payload. Reject
  length outside 1..512 before allocating; exact reads, no newline/text reader
  buffering and no unbounded stream accumulation.
- HELLO type byte `1`, then host context (16 bytes) and client context (16 bytes),
  exact payload size 33. Only B sends HELLO after preamble; A checks current
  host context, but it is public and forgeable.
- ACCEPT type `2`, same contexts, exact size 33. A sends only after local user
  acceptance; B checks expected contexts. This acknowledges operator acceptance,
  not authenticated identity. No TEXT until ACCEPT was sent/received in the
  correct role/state.
- TEXT type `3`, unsigned U32BE per-direction sequence starting at 1, then
  1..256 printable ASCII bytes (`0x20`..`0x7e`), payload size 6..261. Require
  exactly next sequence and increment only on successful acceptance. This is
  a test ordering rule, not cryptographic anti-replay.
- CLOSE type `4`, exact size 1; local close need not wait for peer acknowledgement.
  EOF, malformed/unknown type, wrong state/version/magic/context/size or duplicate
  HELLO/ACCEPT closes the attempt with a safe code. No fallback, renegotiation,
  extensible fields, compression, fragmentation or parser guessing.

Context IDs have no conversation/account/routing meaning. No key material,
credential, real identity, file or normal encrypted envelope is accepted.
TEXT payloads are only test strings generated by buttons, e.g. `A test 1` /
`B test 1`; no unrestricted private-text input in this first milestone.
Do not embed arbitrary peer data into exception/log strings. No replay cache or
trust state is persisted; adversaries can still forge all these frames.

## 7. NSD, network scope and Bluetooth

Use foreground, explicitly user-enabled framework NSD/DNS-SD. “Start and
advertise” must explain observable LAN presence; “Discover” is a separate explicit
action. Discovery is an untrusted hint; do not connect to every result.

Experiment advertisement: service type `_k3nlsx._tcp.`, random instance name
`lsx-` plus 32 lowercase hex characters from a fresh 128-bit context; dynamic
listener port, no TXT attributes. This name/type is an experimental lab convention,
not an IANA registration or reserved production service. Account for Android's
reported collision-renamed instance; never derive trust from name or type.
Public host context can be derived from the original name prefix but is only a
correlation field. A collision suffix does not grant identity.

No username, device identity/fingerprint, verification state, conversation/account
ID, capability inventory or secret. Store locator only transiently; show “Test
endpoint 1,” etc., rather than raw service names or addresses. Host/port disclosure
and timing are unavoidable experimental metadata. NSD supports DNS-SD and dynamic
ports; registration is asynchronous and names can be changed by collision
handling. [Android NSD guide](https://developer.android.com/develop/connectivity/wifi/use-nsd).

First network profile: IPv4 only, selected active Wi-Fi Network with a usable
private RFC1918 address and on-link prefix; reject VPN, loopback, multicast,
unspecified, public/off-link and own-address destinations. Validate resolved
address against this profile before connect; bind listener to that Wi-Fi address
and outbound unconnected socket to the selected Network before connect. No
wildcard listener, DNS URL input, broad subnet scan, public endpoint, interface
fallback or process-wide bind. This is a narrow experimental eligibility rule,
not protection from a hostile router forwarding/intercepting on-link traffic.
IPv6-only/Wi-Fi ambiguity fails with UNSUPPORTED_NETWORK_PROFILE; no bypass.
Android Network can bind an unconnected socket to one Network.
[Network API](https://developer.android.com/reference/android/net/Network#bindSocket(java.net.Socket)).

Use the network-scoped discoverServices overload on API33+ with runtime checks.
On API26–32, framework discovery
may lack the desired network-scoping overload: require a single eligible lab
Wi-Fi interface, no other network transports, and filter resolved addresses;
record this limit instead of claiming strict framework multicast isolation.
Stop on any network/address change. Inspect exact API availability during
implementation; no new SDK/target upgrade simply to avoid a failure.
[NsdManager API](https://developer.android.com/reference/android/net/nsd/NsdManager).

Keep min26/compile-target35 for the spike; manifest only INTERNET and
ACCESS_NETWORK_STATE, no microphone/camera/storage/Bluetooth/location/FGS.
Do not disable network protections globally or copy the main debug HTTP allowlist.
Recheck OS/target permission behavior for each actual device. Current guidance
states target <=36 uses implicit local access through INTERNET; >=37 requires
ACCESS_LOCAL_NETWORK. Android16 opt-in may restrict native sockets even when
framework NSD works. Denial is failure, not permission bypass.
[Local-network permission](https://developer.android.com/privacy-and-security/local-network-permission).
No custom multicast implementation/MulticastLock unless a measured platform
need is separately scoped; do not blanket-add Wi-Fi scanning permissions.

Bluetooth is a PLANNED later Local Session carrier branch: discovery/bootstrap,
short text/control and possible Wi-Fi-unavailable fallback. It never confers
trust through proximity and does not block this Wi-Fi experiment. Large files,
video and voice suitability remain unmeasured. No Bluetooth code here/next spike.

## 8. Carrier comparison and deferred offline WebRTC plan

| Option | Evidence and scope | Choice |
| --- | --- | --- |
| A NSD + bounded socket | Framework NSD and Java sockets can be implemented without main repositories, JNI, media or signaling infrastructure; actual offline reachability unmeasured. | DECISION: first transport-only physical milestone. TCP remains rejected as production main PeerAdmission carrier. |
| B NSD + local signaling + dedicated PC/DC | Leading longer-term candidate, but requires a new data-only owner, control framing, offer/answer/candidate exchange, ICE/privacy/native lifecycle evidence. | PLANNED later carrier experiment; do not silently add as fallback in next spike. |
| C Existing call/relay/private-network carrier | Main calls use relay/normal encrypted signaling; no in-repository offline independent Local Session adapter found. | Unsuitable shortcut; do not rewrite calls or backend. |

A is least distorting because it tests the unresolved physical NSD/socket path
and UI/lifecycle fence without coupling to call or production admission owners.
A successful A run does not validate WebRTC. Preserve
[D13/D14](../connectivity/carrier-discovery-privacy-review.md),
[platform evidence](../connectivity/carrier-platform-evidence.md) and
[physical plan](../connectivity/carrier-physical-test-plan.md).

For a later B experiment, the concrete candidate offline setup is: A advertises
bounded provisional local control endpoint; B explicitly selects it; A creates a
new dedicated data-only PC with exactly one reliable ordered channel and no
media/ICE servers; B accepts exactly that experimental channel. Exchange one
offer and one answer over local control. Prefer non-trickle: wait for gathering
complete on each side, then transmit bounded descriptions including host
candidates. If gathering times out, fail; do not quietly use partial/trickle
fallback. ICE host candidates may suffice on reachable same-LAN devices; this
must be measured under AP isolation, IPv4/IPv6 and actual native behavior.
mDNS candidate hostname resolution may affect connectivity and is unproven in
this Android wrapper. No public STUN/TURN or Render signaling dependency.

Future B must set finite SDP/candidate/native buffering limits before code;
separate control/PC/DC generation ownership; fence async gather/description/
channel callbacks; close all handles on lifecycle changes. Empty iceServers does
not prove only Wi-Fi candidates or LAN-only connectivity. No raw SDP/ICE/cert
logging; no expected-peer authentication inferred from DTLS when the provisional
control endpoint is attacker-controlled. Authenticated Local Session needs its
own reviewed pairing/channel binding. No main A1/M6 shortcut is supplied here.
The WebRTC standard defines ICE gathering and ordered/reliable channel options,
not this Android adapter's verified behavior.
[WebRTC specification](https://www.w3.org/TR/webrtc/).

## 9. Conservative experiment limits — DECISION, non-production

All deadlines use a monotonic clock. Enforce application limits before new work
or allocation, not just after completion. Native/framework/kernel resource
ceilings cannot be fully guaranteed by these application counters.

| Resource | Exact experiment limit / response |
| --- | --- |
| Session lifetime | 10 minutes from Start/Join; no incoming activity extends it. |
| Advertising/discovery | Advertising 120s until accepted; discovery 60s; stop both when connected. Explicit manual restart, new generation/context. |
| Hint map | 8 entries; 30s TTL from first sighting (duplicates do not extend); name <=64 UTF-8 bytes, type <=32, ignore any TXT record rather than parsing it. |
| Discovery events | Process <=20 callbacks/s; sustained overflow for 2s ends attempt RESOURCE_LIMIT; framework allocation remains outside app control. |
| Resolution | One in flight, selected endpoint only, no queue; 5s deadline, maximum 3 explicit resolves/minute. Late callbacks ignored. |
| Provisional/carrier connections | One total pending or active; listener backlog requested 1, no worker per refused socket; stop listener after acceptance. |
| Connection attempts | <=6 accepted/rejected/dial attempts per minute per experiment; saturation closes listener/attempt, no automatic retries. |
| Connect / preamble-HELLO | Connect 5s; preamble and HELLO complete within 5s total after socket opens. |
| Local accept window | 30s after valid HELLO, no TEXT allowed; expired/refused attempt closes and clears. |
| Frame read/write | Once first header byte arrives, complete whole frame within 2s; cap receive allocation at 512 bytes. Writer also has 2s deadline implemented by cancellation plus socket close, not SO_TIMEOUT alone. |
| Idle | 60s with no accepted TEXT; no ping/keepalive or partial-byte trick extends it. |
| Messages | TEXT <=256 printable ASCII bytes; <=100 accepted texts per direction per session; >=100ms between locally sent texts and received texts, otherwise close RATE_LIMIT. |
| Queues/buffers | Outbound queue <=8 frames/4096 bytes, no unbounded coroutines; receive parsing one frame at a time, UI event queue <=16 entries. Queue full closes RESOURCE_LIMIT. |
| UI history | <=32 entries, evict oldest; strings never persist; combined experiment-owned retained payload/hint/diagnostic data <=64KiB. Not a total-process RAM claim. |
| Diagnostics | <=32 enum/count/timing entries; no payloads/addresses/secrets. |
| Teardown | Disable/invalidate immediately, local close/cancel/clear <=2s; async NSD completion measured, late callbacks fenced. |

A conservative limit is an experimental choice, not an optimal/production
parameter. Change it only with a documented measured reason within the same
isolation/synthetic-data fence; never resolve saturation by unbounded allocation.

## 10. Hostile-LAN handling and compromise bounds

Attackers can forge advertisements, race endpoints, observe/inject/replay/drop/
reorder, impersonate unverified endpoints and flood malformed traffic. In option
A they can read or alter synthetic plaintext and deny availability; explicit user
acceptance is consent, not authenticated peer identification.

Reject malformed/unknown frames and wrong state before dispatch; bound all queues,
connection work and timers; no auto-retry, trust mutation, parser fallback or
relay fallback. A live-network replay is not cryptographically prevented by test
sequences/context matching. Never claim otherwise. Fake service names/addresses
cannot grant main authority because no main authority interface exists in the
experiment. Remaining risks include socket/parser/framework vulnerabilities,
resource pressure, metadata exposure and device/OS compromise.

If later integrated into the same main process, protocol/key/storage separation
reduces logical coupling but arbitrary code execution can cross those boundaries.
A dedicated ordinary `android:process` service is still generally the same UID;
process separation alone does not isolate main files/Keystore permissions.
Separate aliases reduce accidental sharing, not same-UID code-execution power.
The service manifest distinguishes a separate process from an isolated process
without the app's permissions; evaluate actual restrictions before selecting it.
[Android service manifest](https://developer.android.com/guide/topics/manifest/service-element).

Future hardening: narrow service API, validated Binder DTOs/no handles or general
repository access, non-exported component, dedicated process plus deliberately
scoped permissions, evaluated isolated-service constraints, separate stores/keys,
or separate companion package/UID. The standalone spike keeps controller,
discovery, carrier, codec and UI interfaces independent so a future IPC boundary
can replace in-process calls. No main integration or Binder bridge in first spike.
No blanket claim of perfect containment even with the separate package.

## 11. Text and visibility contract

Visible first feature: LOCAL EXPERIMENTAL TEXT, transport-only. Display a persistent
banner: “Unauthenticated and unencrypted. Synthetic test data only. Temporary;
normal K3NCRYPT conversations are not used.” Use fixed synthetic send buttons.
No relay, normal E2EE parser/history/outbox, recipient-contact identity or durable
receipt. Show “received in test memory”; successful local write means “written
to test socket,” not delivered/read/persisted.

| Safe UI dimension | Required states/meaning |
| --- | --- |
| Experiment | inactive, advertising, discovering, peer found, connection acceptance pending, carrier connecting, connected, disconnected, failed |
| Pairing | `AUTH_NOT_IMPLEMENTED` / unpaired throughout. Future pairing pending/established states disabled, never inferred from ACCEPT. |
| Network | local Wi-Fi available/unavailable; Internet capability reported available/unavailable/unknown; lab WAN-off independently confirmed |
| Carrier | experimental TCP, connected/disconnected; no secure-path label |
| Isolation | temporary memory-only; normal K3NCRYPT conversation untouched by design, with test evidence reported separately |
| Relay | not linked/not used; no relay fallback |
| Developer | sanitized enums and counts/timing only |

Reason codes: USER_ENDED, NETWORK_UNAVAILABLE, UNSUPPORTED_NETWORK_PROFILE,
PERMISSION_DENIED, DISCOVERY_TIMEOUT, RESOLVE_TIMEOUT, CONNECT_TIMEOUT,
ACCEPT_TIMEOUT, FRAME_INVALID, FRAME_TIMEOUT, CONTEXT_MISMATCH, RATE_LIMIT,
RESOURCE_LIMIT, PEER_CLOSED, BACKGROUNDED, NETWORK_CHANGED, CLEANUP_TIMEOUT.
Map exceptions to codes; do not dump stack messages/peer frames or service records.

Framework Internet capability is a hint; absence of validation is not proof
that every egress route is absent. No external connectivity probe or backend
request is allowed merely to populate this label.
[ConnectivityManager](https://developer.android.com/reference/android/net/ConnectivityManager).
State generations fence all NSD, socket, coroutine and UI callbacks; stale callbacks
must not change current status or reopen a listener. Stop on background/lock.
No notification/FGS/background product in this milestone.

No keys, pairing secrets, fingerprints, raw SDP/ICE, sensitive addresses or raw
context IDs in display/logs. No address-debug exception is needed for option A;
if a future test build requires it, a new explicit local operator opt-in and
sanitized/noncommitted artifacts must be documented. Synthetic message bodies
are visible only in test UI, not application logs or committed captures.

## 12. Future files and calls — not next-spike scope

Files require recipient approval, quotas and chunk bounds, sanitized filenames,
no traversal, no automatic open/executable launch, conservative MIME, isolated
unsafe previews, integrity, cancellation and cleanup. Never auto-import into main
K3NCRYPT state. No file picker, storage permission, transfer receiver or preview
in first spike.

Future voice/video use separate session signaling, temporary Local Session
identity, local media transport and explicit call state with no normal trust
mutation. Existing call/WebRTC code can be reused only after reviewing ownership
and dependency boundaries. No microphone/camera/media/call behavior in next spike.
Bluetooth, main M6/A1/D13/D14/E1/receipts, direct Internet, nodes, notifications and
VPN remain untouched tracks.

## 13. Exact two-physical-device experiment

### Preconditions and evidence discipline

Two operator-authorized physical Android devices, A and B, on one lab router;
record models/OS/API, experiment commit/APK digest/package ID and Router/AP
isolation setting. No important/private text. Preserve main installs/data;
never uninstall/clear main or run destructive main instrumentation. Experiment
package installation is separate; no root or new main access permissions.

Disable router WAN/upstream and cellular/mobile data; keep Wi-Fi enabled. Disable
VPN, USB Ethernet/tethering and alternate egress; ADB USB is allowed only as a
debug link, with no port forwarding/reverse/tunnel or host-based signaling.
Record the operator-confirmed network topology and each device's safe network
state. No main login/backend/Render availability is prerequisite. If physical
devices are unavailable, attempt discovery of attached authorized devices,
report PHYSICAL_TEST_BLOCKED and exact missing requirement; do not substitute
emulator results as fulfillment. Do not leave real experimental code unwritten.

### Steps and pass criteria

1. Record main app UI conversation count and trust labels on each device without
   dumping keys/DB/history; stop main app during LAN run to avoid unrelated relay
   traffic. Keep its package/data unchanged. Capture build dependency/manifest
   evidence that the experiment cannot access it; absence of observed mutations
   alone is not a proof against arbitrary compromise.
2. Install experiment debug APK on A/B; launch without any main vault/account
   bootstrap. Both show inactive, unpaired, temporary and relay not linked.
3. A presses Start and advertise after presence/plaintext warning; creates fresh
   context and selected-Wi-Fi listener; UI advertising state visible.
4. B presses Discover; UI discovering then anonymous endpoint found. No
   auto-connect. If no result within limit, report actual timeout; no subnet scan
   or manual-address fallback counted as NSD success.
5. B explicitly selects endpoint and accepts transport-only warning. Connects,
   exchanges experimental preamble/HELLO. A sees acceptance pending and explicitly
   accepts. Both remain AUTH_NOT_IMPLEMENTED; ACCEPT is not pairing evidence.
6. Both show connected / experimental TCP / temporary / relay not used. Cold
   start must occur after Internet has been disabled, not reuse online setup.
7. A sends fixed `A test 1`; B sees it in experiment memory. B sends `B test 1`;
   A sees it. Repeat three texts each; record counts/order and elapsed times.
8. Confirm WAN/cellular/alternate egress remained disabled throughout. Evidence
   of no relay: experiment dependency/manifest/config audit, no backend code or
   endpoints, selected-Wi-Fi sockets and operator topology; add sanitized router
   connection counters if available. Do not claim global traffic proof from UI.
9. A presses End; both show disconnected/inactive, histories/queues/contexts clear,
   sockets close, advertising/discovery unregister. Late callbacks cannot reopen.
10. Restart both experiment processes; both start inactive with no text or session
    restoration. Repeat with roles reversed using new context/consent.
11. Check main UI counts/trust labels unchanged after run; record any unrelated
    differences rather than attributing them without evidence. Main app data and
    package were never cleared or mutated by test tooling.
12. Run bounded negative cases: reject incoming request; unknown/wrong-domain
    frame; overlength/partial frame; duplicate/out-of-order TEXT; queue/rate
    saturation; background/lock; Wi-Fi loss/change; process death. Confirm safe
    state, bounds and cleanup. Use a disposable synthetic harness for malformed
    traffic; no main protocol or trust interface.

Minimal positive PASS requires steps 2–10 on two physical devices with offline
cold start and both directions. Isolation/negative checks are separately reported
pass/fail/not run; missing evidence cannot be silently called complete. AP isolation
may produce a reachability failure, not proof of attack or insecure pairing.
No scans/hotspots/UPnP/VPN/permission bypass to defeat it. Emulator/unit tests are
supplementary and clearly labeled. No physical secure-LAN claim.

Report only aggregate states, limits exercised, timings/counts, commit/platform,
failures and exact scope. Do not commit packet captures, IPs, service/context IDs,
private data, log dumps or pairing material. Restricted captures, if genuinely
needed, require explicit operator authorization and local noncommitted handling.

## 14. Stop conditions and next implementation boundary

Stop and report if implementation requires main private identity, verified-contact
mutation, main storage write/read authority, new unreviewed crypto, global
protection disablement, relay protocol change, permanent NSD/Bluetooth trust,
broad scans or production raw-TCP trust claims. Also fail closed when selected
network eligibility/permission or finite resource ownership cannot be enforced.
Do not weaken the contract to get a green physical test.

**Next branch: `experiment/local-session-android-lan-spike`, from the final commit
of this review.** Required real code: opt-in standalone debug application module,
framework UI, memory-only controller/state machine, NSD adapter, selected-Wi-Fi
bounded socket owner, experimental codec and focused tests. Build/install the
separate APK and attempt the specified two-physical-device Internet-off run.
Allowed existing-file change is the opt-in settings inclusion plus narrow test/
experiment scripts/docs; no main app/runtime/crypto/storage/network/calls behavior
changes. No new external dependency is needed; preserve existing tool versions.

The next branch must check framing/state/lifecycle limits with focused unit tests,
run experiment Android lint/build, verify manifest/dependency fence and perform
physical steps if authorized devices are available. Do not run guarded main
instrumentation on personal devices. Add a concise experiment report with exact
revision and PASS/FAIL/BLOCKED outcomes; lack of devices is an execution blocker,
not permission to claim success or replace the implementation with more review.

Permitted claim after actual evidence: bounded NSD discovery and synthetic
bidirectional TCP text feasibility on the recorded two-device offline lab, plus
observed lifecycle and module/package separation. Prohibited claims: authenticated
pairing, E2EE/confidentiality, hostile-router resistance, production Local Session,
main PeerAdmission/freshness closure, approved raw TCP, secure files/calls,
WebRTC readiness, background availability, anonymity or universal containment.

## 15. Review validation

Only this focused document is changed. Master intent needed no clarification;
historical connectivity ADRs/reports are preserved. VALIDATED: `npm run lint`
passed; local link audit checked 24 targets with zero missing; staged
`git diff --cached --check` passed before commit. Dependencies were installed
from the existing lockfile with `npm ci --ignore-scripts --offline`; no dependency
change. No code/fixture, carrier/device,
heavy production suite, crypto vector or physical test is run in this review.
Official platform guidance was consulted on 2026-10-05; it is not runtime evidence.
