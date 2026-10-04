# PeerAdmission v1 — reconciled requirements and encoding review candidate

Status: NOT APPROVED; no production runtime. Based on sender-origin
5111aff9cbed6668194d2ab522bd80dcf1b0f9b1 and the historical M5 requirements
at connectivity/lan-decision bf7123587b7a7b0ba8588e685d099dfa8c9aa0d2.
See [review package](peer-admission-freshness-review.md) and
[provenance/conflicts](specification-map.md).

## Security meaning and preconditions

Admission binds an already-known expected device, existing conversation and
live carrier under explicit verified/unchanged contact, active local and
required remote lifecycle, approved freshness, healthy session and privacy
policy. It cannot create a contact, verify it, accept a fingerprint, fetch a
pre-key bundle or replace the session. Unknown/ambiguous inputs fail closed.
Signed identity possession does not prove absence of an unseen revocation.

Both signatures must be checked against the already pinned complete
Curve25519/Ed25519 identity tuple, whose existing fingerprint must still match.
A transmitted deviceId, key, account, route or lifecycle epoch is only a claim
until its mapping is authenticated under a reviewed authority. Current Web
contact records do not supply a general cross-account remote device/lifecycle
mapping; current Android route/fingerprint presence is not explicit verification.
These gaps block runtime use.

## Candidate transcript fields and exact byte projection

The historical spec requires binary length prefixes but supplies neither a
complete field order nor a wire-flight schema. The following **REVIEW CANDIDATE**
uses the existing M1 U32BE/strict-UTF-8 convention to expose ambiguities with
unsigned vectors. It is not an approved protocol version or format migration.

Each signer has a different signing payload. T(initiator) and T(responder)
use the same body and differ in the signerRole field. Signing the same generic
blob twice would leave role separation implicit; the explicit field is a
candidate to review, not a new signature algorithm or key exchange.

| Order | Field | Encoding |
|---|---|---|
| 1 | Domain | LP(UTF8("k3ncrypt/peer-admission/v1")) |
| 2 | transcriptVersion | U32BE(1), draft only |
| 3 | signerRole | LP("initiator") or LP("responder"), independently fixed by local pending handshake role |
| 4 | conversationId | LP(exact canonical UTF-8 conversation identifier) |
| 5 | initiatorDeviceId | LP(exact expected device identifier) |
| 6 | initiatorIdentityReference | LP(exact pinned fingerprint reference of full key tuple) |
| 7 | responderDeviceId | LP(exact expected device identifier) |
| 8 | responderIdentityReference | LP(exact pinned fingerprint reference of full key tuple) |
| 9–10 | initiatorRole, responderRole | LP("initiator"), LP("responder"), fixed order |
| 11–12 | initiatorNonce, responderNonce | LP(raw challenge bytes); each >=16 cryptographically random bytes |
| 13–14 | initiatorOfferedControlVersions, responderOfferedControlVersions | U32BE(count) then U32BE(each exact positive version), strictly ascending, nonempty, no duplicates/ranges |
| 15 | selectedControlVersion | U32BE(exact selected version); selection checked separately |
| 16 | downgradeOutcome | LP(exact candidate enum); valid candidate is "highest-common"; negative vector "reject-lower-selection" is not admissible |
| 17 | transportBinding | LP(binding candidate bytes below) |

LP(x) = U32BE(byteLength(x)) || x; no native-endian integer, varint, signed
length, delimiter parsing, JSON canonicalization, BOM, trailing NUL, padding,
implicit field or extra trailing byte. All nested/list lengths count bytes/
entries as indicated; reject overflows/truncation before allocation. UTF-8
encodes Unicode scalar sequences; TS/Kotlin reject isolated UTF-16 surrogates
instead of inserting replacement characters. Never trim, case-fold, normalize
or silently repair identifiers. Validate their original canonical schemas first.
NFC is required where the existing DeviceEntry schema requires it.

Actual relay conversation/routing IDs use the UUID validator in
backend/security/controlCapability.ts; backend device bootstrap also constrains
deviceId to UUID-like ASCII. No non-ASCII conversation/device-ID success vector
is authorized. The utf8-encoding-only fixture exercises byte-length agreement
with non-ASCII input accepted by the generic DeviceEntry text boundary, but is
explicitly ineligible for current account/room admission. Unicode support in an
encoding primitive does not expand a protocol identifier schema.

Transport binding candidate bytes are:
LP("webrtc-dtls-fingerprint-pair-review") || LP("sha-256") ||
LP(initiatorCertificateFingerprintRaw32) ||
LP(responderCertificateFingerprintRaw32).
Fingerprint input is the locally validated certificate digest, not SDP text.
Hex in the fixture is lowercase serialization for review only; production
presentation parsing/algorithm agreement must be separately specified and
strictly checked. This candidate contains no IP, endpoint, name, invitation,
key exchange, exporter, signature or custom transcript hash.

**The projection is incomplete for final runtime:** it does not yet encode the
reviewed full A1 capability document/dependencies, lifecycle authority/evidence
context, or association/stream binding. They must be incorporated or locally
bound under an approved final state machine before a final wire format and
signed vectors can be approved. New fields require a new draft/vector revision,
not silent interpretation of these bytes.

Both existing signers accept arbitrary bytes with a 16 KiB bound; a proposed
complete payload must fit that bound without removing required security fields.
Sign exact bytes using existing Ed25519 Account.sign. Web uses raw 32-byte
Ed25519 keys/64-byte signatures through WebCrypto; Android verifier adoption
is a prerequisite, not performed here. No signed PeerAdmission fixture is
generated: final role/flight semantics and key-to-device authorization are
unapproved, and current Android cannot consume it through a production verifier.
Existing introduction signature fixtures remain a separate protocol.

## Roles, downgrade and handshake completion

Roles derive from local initiation state; peer messages cannot rewrite them.
Nonce/identity/offer/fingerprint fields are initiator-first on both platforms.
Verify intended peer and conversation against the owner, verify both complete
offers and exact selected outcome, and verify the signer role under the correct
already pinned key. A reflected initiator proof cannot satisfy a responder proof.
Same-device/self-conversation exceptions are not approved; reject ambiguous
identity/role mapping and concurrent role collision until explicitly specified.

Do not activate a connection after merely receiving a challenge or sending
one signature. Both authenticated proofs and the locally observed carrier must
match one live pending negotiation, and admission publication must be fenced
against changed security generations. A1/C1-W must define the exact hello/
challenge/proof/completion flights, discriminators, duplicate behavior and
whether/when confirmation is required. This document does not invent an
encrypted confirmation key or mark an incomplete flight design implementation-ready.

## Transport/channel binding

For the WebRTC candidate, authenticate both role-ordered DTLS fingerprints,
their algorithm, and the live connection/channel evidence. Each endpoint must
derive/check its local certificate and the remotely validated certificate on
the actual association carrying the admission, rather than signing untrusted
SDP values supplied by rendezvous. A substituted certificate/fingerprint fails.
DTLS authentication remains additional to existing Olm E2EE.

Current standards expose local RTCCertificate.getFingerprints(), remote
RTCDtlsTransport.getRemoteCertificates(), and the DataChannel association
through RTCPeerConnection.sctp.transport. DTLS connected means remote
fingerprint validation completed, not K3NCRYPT device verification.
See [W3C WebRTC certificate API](https://www.w3.org/TR/webrtc/#rtccertificate-interface),
[DTLS API](https://www.w3.org/TR/webrtc/#rtcdtlstransport-interface) and
[SCTP API](https://www.w3.org/TR/webrtc/#rtcsctptransport-interface),
consulted 2026-10-05. RFC 8122 describes fingerprint matching;
[RFC 8827](https://www.rfc-editor.org/rfc/rfc8827.html) requires identity
binding of fingerprints. These support the evidence direction, not approval
of this K3NCRYPT transcript.

Important unresolved distinction: a certificate fingerprint is not a unique
connection/stream ID. Certificates may be reused and multiple DataChannels may
share DTLS. The candidate pair alone must NOT be called exact live-channel
binding. D13/C1-C must review fresh connection-local challenge ownership,
certificate reuse, single-channel restriction versus explicit SCTP stream/
label/protocol binding, and replacement/renegotiation. The actual handle must
remain in the local admission object and proofs must never be portable to a
different handle. Browser/native exposure must be measured on supported versions;
there is no generic DTLS exporter operation in the inspected browser IDL, and
no exporter design is invented. Unavailable or ambiguous evidence blocks admission.

Plain TCP/raw socket: **UNSUPPORTED FOR PRODUCTION PEERADMISSION**. IP/port,
connection success, signed endpoint hints, application nonces alone, and a
peer-claimed binding are not a reviewed secure-channel substitute. A TLS or
other carrier proposal needs its own independently reviewed actual-channel
binding and platform evidence. No such binding was approved in inspected refs.
D13 remains owner/carrier review; DataChannel is a candidate, not a selection.
WebSocket URL/origin or existing voice WebRTC success likewise does not admit
an optional message carrier.

## Replay and restart

- Generate independent local CSPRNG nonces of at least 128 bits per attempt;
  never accept the peer's timestamp as freshness or recycle a nonce after
  reconnect. Web crypto.getRandomValues and Android SecureRandom are existing
  candidate sources; exact length above the minimum remains review/DoS budget.
- Match a received proof to an outstanding locally generated challenge, exact
  conversation, device/key pair, roles, complete offers/selection and carrier
  handle. A stale proof without that pending context is rejected.
- Cache pending and consumed nonce-pair/role contexts per local device,
  expected remote device, conversation and connection attempt; also prevent
  duplicate nonce reuse across concurrently pending contexts. Cache capacity
  is bounded globally and per peer/source, with saturation rejecting new work.
  Do not evict still-valid entries and accidentally reopen replay windows.
- Duplicate flights can be rejected or answered idempotently only under a
  reviewed state machine. They cannot publish a second binding, renew expiry
  or allocate another conversation/session. Reconnect gets fresh challenges
  and complete revalidation. Cross-role/conversation/device/carrier replay fails.
- Local monotonic time governs pending timeout/cache TTL and admission expiry;
  peer wall clock and message senderOrigin are unrelated. Cache retention must
  cover the maximum valid handshake/admission and delayed-flight period;
  concrete bounds are review parameters, not selected protocol constants.
- After app restart, destroy all admissions and pending challenges and use
  fresh CSPRNG challenges. An in-memory replay cache is gone; old proofs still
  require a nonexistent old pending context and cannot bootstrap a new one.
  Do not deserialize an admitted channel. App sleep, timer suspension, OS boot
  changes and storage restore require revalidation or close; monotonic readings
  cannot be compared across unrelated boot/time origins. Restored device keys/
  lifecycle can still be stale; new nonces do not cure rollback or M6.

## Pre-auth resource protection

No heavy conversation/session state, pre-key claim, trust write, durable route,
history row or outbox allocation for an arbitrary connection. Acquire global
and per-source/peer budget before frame reassembly or signature verification.
Untrusted IDs cannot force an unbounded contact lookup fanout.

| Control | Required behavior | REVIEW PARAMETER, not active runtime |
|---|---|---|
| Total frame/signature payload | Bound nested lengths, list counts, aggregate bytes and allocation before parse/verify | At most existing 16 KiB signing payload; framing overhead and tighter pre-auth cap TBD |
| Timeout | Deadline from local monotonic start, not extended by each byte or duplicate | Exact duration/platform sleep rule TBD |
| Unauthenticated concurrency | Global maximum plus per-source limit where meaningful; saturation rejects | Counts TBD after carrier measurements |
| Rate/CPU | Bound discovery events, parsing and verification per interval; token budget/cancellation | Rates/window TBD; never use forged advertised ID as sole rate key |
| Memory | Fixed total frame/cache/backpressure budget; no unbounded queues or fragmented allocation | Budget/entry retention TBD |
| Source accounting | IP on LAN may be shared/spoofed; ICE may mask source; combine global and connection budgets | No identity or persistent endpoint inventory |
| Cancellation/shutdown | Cancel pending parse/verify timers; release budgets exactly once; idempotent close | Tests must cover every async completion race |

No arbitrary numeric timeout, cache TTL, concurrency or rate is declared
protocol truth by this branch. These unresolved bounded constants are required
before runtime; existing key-signing limit is a ceiling, not a DoS benchmark.

## Failure privacy and teardown

Externally use one bounded generic admission failure/close where feasible for
unknown peer, unverified contact, wrong conversation, revocation, bad signature
and stale freshness. No detailed remote error oracle, echo, contact-existence
query, inventory listing or expensive dummy crypto. Bound response sizes and
timing classes; do not claim constant-time end-to-end network failure. Known
contacts may still infer online presence from transport behavior; D14 addresses
discovery/metadata exposure separately.

Local diagnostics may distinguish allowlisted codes (ineligible, unsupported,
malformed, authentication-failed, freshness-unavailable, timeout,
resource-limit, cancelled) without IDs. Never log keys, fingerprints,
invitations, raw transcript/signature, candidate IPs/addresses or private
endpoint data. Review vectors are synthetic data, not logging examples.

Close and invalidate the admission on identity/key change, verification loss or
pending review, local/required remote revocation, freshness expiry/conflict/
unknown, unhealthy or replaced session, conversation deletion, optional-path
disablement, privacy-policy change, local admission timeout, connection/channel
replacement and incompatible renegotiation. Fence outstanding async callbacks
with a generation token so they cannot restore eligibility after close.
Recheck eligibility before every outbound envelope and when dispatching inbound
ones into the existing owner; admission does not bypass normal validation,
M1/legacy dedupe or atomic acceptance. No route success changes verification.
Relay retains its existing authorization and exact-ciphertext retry behavior.
