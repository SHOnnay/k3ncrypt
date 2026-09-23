# K3NCRYPT Phase 9 Protocol Compatibility Specification

**Status:** Phase 9.0 compatibility baseline

**Reference implementation:** Phase 8 TypeScript service SDK, browser client, backend, and Rust/WASM crypto core

**Scope:** Browser, backend, Rust/WASM, and future Android interoperability

**Behavior change:** None. This document records the current implementation and identifies contracts that still require implementation discovery or versioned resolution.

## 1. Purpose and conformance language

This specification defines the wire, persistence, and validation contracts an Android client must follow to interoperate with the current K3NCRYPT implementation. It does not create another identity or authorization system. Phase 8 device trust, lifecycle, proof, resource-binding, replay, and end-to-end encryption boundaries remain authoritative.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe compatibility requirements. Where the implementation does not provide one stable contract, this document marks the area **DISCOVERY REQUIRED**. Android development must not guess or create a divergent format in those areas.

The current reference sources are:

- `crypto-wasm/src/lib.rs` for Vodozemac account, session, signature, and Olm-message handling.
- `service/src/crypto/vodozemacRuntime.ts`, `modernConversation.ts`, and `vodozemacCryptoSession.ts` for browser/service crypto framing and persistence.
- `service/src/devices/trustProtocol.ts` and `bootstrap.ts` for client trust messages.
- `backend/security/lifecycleEvent.ts`, `durableDeviceTrust.ts`, and `deviceTrust.ts` for backend lifecycle and proof verification.
- `backend/socket.io/listeners.ts` and `service/src/transports/socketIoRelayTransport.ts` for relay and mailbox behavior.
- `service/src/attachments/*`, `service/src/media/*`, and `backend/api/attachments/*` for encrypted attachment handling.
- `service/src/calls/*`, `service/src/webrtc/*`, and `service/src/sdk.ts` for call signaling and WebRTC integration.

## 2. Protocol-wide conventions

### 2.1 Versions and compatibility

All formats described here are version 1 unless an enclosing format explicitly uses version 2. Unknown versions, algorithms, strategies, operations, and enum values MUST be rejected. Fields MUST NOT be repurposed without a protocol version change.

Receivers SHOULD reject unexpected fields where the current validator does so. A new client MUST NOT assume that an extra field is ignored merely because one current handler happens not to validate it.

### 2.2 Text and bytes

- JSON text and all domain-separated hash/signature inputs use UTF-8.
- Binary values in JSON use unpadded RFC 4648 base64url unless this specification says otherwise.
- Vodozemac's serialized Olm ciphertext string is opaque. Clients MUST pass it through unchanged and MUST NOT reinterpret or normalize its alphabet.
- SHA-256 commitments and payload digests use lowercase hexadecimal unless a section defines a different display representation.
- Ed25519 public verification keys and Curve25519 identity keys are 32 raw bytes encoded as 43-character unpadded base64url strings.
- Ed25519 signatures are 64 raw bytes encoded as unpadded base64url.
- Values decoded from external input MUST be length-checked before cryptographic use.

### 2.3 Identifiers and time

- New identifiers SHOULD be canonical lowercase RFC 4122 UUID strings produced by a cryptographically secure UUID generator.
- Several existing backend validators accept broader 36-character hexadecimal/hyphen device identifiers. Android MUST NOT depend on that permissiveness.
- Timestamps are Unix epoch milliseconds represented as JSON numbers.
- Clients MUST emit integral timestamps within JavaScript's safe-integer range so that TypeScript, Kotlin, Rust, and MongoDB agree on the value.
- Expiry comparisons use server time. A request is expired when its expiry is not strictly greater than the server's current time.
- Unless a narrower rule is stated, signed lifecycle windows may not exceed five minutes and their creation timestamp may not be in the future.

### 2.4 Current canonical JSON rule

Phase 8 does not implement RFC 8785/JCS or another general canonical-JSON algorithm. Signed and hashed objects are constructed in a fixed property insertion order and serialized with compact JavaScript `JSON.stringify`, with no insignificant whitespace. This is a wire-level requirement for version 1.

Consequences for Android:

- Kotlin MUST construct each signed object in the exact field order listed in this specification.
- Absent optional properties MUST be omitted, not encoded as `null`.
- Arrays retain their original order unless a contract explicitly requires sorting.
- Strings are serialized as JSON strings using standard escaping. No Unicode normalization is performed.
- Numbers MUST be emitted without fractional components or exponent notation.
- A verifier reconstructing a signed object MUST use the same field order rather than signing an arbitrary map.

**DISCOVERY REQUIRED:** Version 1's insertion-order dependence is fragile across languages. A future version should adopt an explicitly versioned canonical serializer, but Android v1 must match the current TypeScript byte sequence. Golden vectors are mandatory before implementation is accepted.

## 3. Identity and cryptography contracts

### 3.1 Vodozemac account lifecycle

The Rust/WASM `K3ncryptAccount` is the identity and Olm-session authority. Android MUST use a compatible Vodozemac implementation or an adapter proven against the golden vectors. It MUST NOT implement a parallel cryptographic identity.

Account creation:

1. Create a Vodozemac account locally.
2. Generate 10 one-time keys.
3. Generate a fallback key.
4. Read public identity and pre-key data.
5. pickle the account with a locally held 32-byte pickle key.
6. Store only the encrypted pickle through the platform secure-storage boundary.

Account loading accepts an encrypted pickle of at most 1 MiB and a pickle key of exactly 32 bytes. A corrupt pickle, wrong key, or unsupported serialized state is a hard failure. Android MUST NOT silently create a replacement identity when loading fails.

Account mutations—including one-time-key generation, marking keys published, inbound pre-key processing, and other Vodozemac state changes—MUST be followed by durable encrypted account persistence before an operation is acknowledged as complete.

### 3.2 Public identity and persistence

The public identity object is serialized in this order:

```json
{"curve25519":"<base64url>","ed25519":"<base64url>"}
```

The account pickle is opaque cryptographic state. It MUST be encrypted at rest, MUST NOT be logged, and MUST NOT cross the device boundary. Session pickles are JSON bytes emitted by Vodozemac, accepted up to 4 MiB by the Rust boundary, and likewise MUST be encrypted before durable storage.

The browser persists inbound account and session state as one logical commit with the phases `prepared`, `account-written`, and `committed`. Android MUST provide equivalent crash consistency: it may use a database transaction or a recoverable commit marker, but it MUST persist the changed account and new session before accepting a relay message.

### 3.3 Fingerprint generation

The public identity fingerprint is:

1. Normalize each identity key from standard base64 or base64url to unpadded base64url.
2. Build UTF-8 bytes for:

   `k3ncrypt:vodozemac-identity:v1\0<curve25519>\0<ed25519>`

3. Compute SHA-256.
4. Encode the digest as unpadded base64url.
5. Uppercase it, split it into groups of four characters separated by spaces, and prefix `K3 `.

The resulting string is used as the browser identity reference and is security-sensitive. Implementations MUST compare it exactly after applying the defined key normalization.

### 3.4 Pre-key bundle

The exact version 1 bundle is:

```json
{
  "version": 1,
  "protocol": "vodozemac-olm-v1",
  "identity": {"curve25519":"<base64url>","ed25519":"<base64url>"},
  "oneTimeKeys": [{"id":"<key-id>","key":"<base64url>"}],
  "fallbackKey": {"id":"<key-id>","key":"<base64url>"}
}
```

`fallbackKey` is optional and must be omitted when unavailable. At most 100 one-time keys are accepted and the serialized bundle is limited to 32 KiB.

One-time-key IDs are:

`otk-` + first 22 characters of base64url(SHA-256(UTF-8(`k3ncrypt:otk:v1\0<key>`)))

Fallback-key IDs use domain `k3ncrypt:fallback:v1\0` and prefix `fallback-`.

Publishing pre-keys obtains a UUID routing address and a 32-byte unpadded-base64url renewal proof. Claiming a key names its `keyId` and atomically removes an available one-time key. Renewal requires the room control capability and the renewal proof, and it must retain the same identity keys. Bundles expire after seven days.

**DISCOVERY REQUIRED:** The selected ordering of returned one-time keys and the precise fallback-selection rule are not separately versioned. Android must use the same claim API and must not locally invent key-selection precedence until shared fixtures freeze this behavior.

### 3.5 Olm sessions and encrypted envelope

Outbound sessions use Vodozemac `SessionConfig::version_1`, the recipient Curve25519 identity key, and the claimed one-time or fallback key. Inbound creation requires an Olm pre-key message and the sender's Curve25519 identity key.

The Rust Olm wire message uses the compact field order:

```json
{"version":1,"message_type":0,"ciphertext":"<opaque-vodozemac-value>"}
```

`message_type` is `0` for pre-key and `1` for normal messages. Decoded ciphertext is limited to 64 KiB.

The service wraps this value as:

```json
{
  "version": 2,
  "strategy": "vodozemac-olm-v1",
  "data": {"version":1,"olmMessage":"<serialized-olm-message>"}
}
```

The outer validator requires exactly `version`, `strategy`, and `data`; the inner object requires exactly `version` and `olmMessage`. Unknown or extra fields are rejected.

Before Olm encryption, application payloads are framed as:

- byte 0: frame version `1`
- byte 1: channel `1` for messaging or `2` for signaling
- remaining bytes: application payload

Plaintext frames are limited to 64 KiB. A receiver MUST reject an unexpected frame version or channel. Duplicate or out-of-order ciphertext that Vodozemac rejects MUST remain rejected.

### 3.6 Control-event signatures

`signControlEvent` accepts 1 through 16 KiB of caller-provided bytes and returns an Ed25519 signature. The private key remains inside the Vodozemac account boundary. Every signed trust request uses the compact UTF-8 `JSON.stringify` bytes of the unsigned object in the exact order specified below. Private keys MUST never be exported to perform signing elsewhere.

## 4. Device trust protocol

### 4.1 Initial bootstrap request

Unsigned fields, in signature order:

1. `version`
2. `requestId`
3. `deviceId`
4. `deviceIdentityReference`
5. `verificationKey`
6. `fingerprint`
7. `createdAt`
8. `expiresAt`
9. `nonce`

`signature` is appended after signing. The client profile uses version 1, a UUID request ID and device ID, a UUID-derived nonce with hyphens removed, and a 30-second lifetime.

The backend verifies the self-signature with `verificationKey`, requires the fingerprint to equal `deviceIdentityReference`, rejects replay, globally reserves the device ID, and creates a server-assigned account reference of the form `account-<UUID>`. The first device is stored as active at trust epoch 1. The request cannot select its lifecycle state or epoch.

### 4.2 Enrollment event

Unsigned fields, in signature order:

1. `version`
2. `eventId`
3. `accountIdentityReference`
4. `issuerDeviceId`
5. `issuerIdentityReference`
6. `issuerEpoch`
7. `targetDeviceId`
8. `targetIdentityReference`
9. `targetVerificationKey`
10. `targetFingerprint`
11. `nonce`
12. `createdAt`
13. `expiresAt`

The active issuer signs the event and supplies a one-time `device-control` authorization proof bound to its account, identity, and epoch. The backend requires an existing active issuer in the same account, an unused event ID, a new globally unique target device ID, matching target fingerprint and identity reference, and a valid target verification key. Success creates a pending target at `issuerEpoch + 1`.

Capability-only or target-self-signed enrollment is invalid.

### 4.3 Activation event

Activation uses this unsigned field order:

1. `version`
2. `eventId`
3. `accountIdentityReference`
4. `issuerDeviceId`
5. `issuerIdentityReference`
6. `targetDeviceId`
7. `targetIdentityReference`
8. `operation`
9. `previousEpoch`
10. `nextEpoch`
11. `createdAt`
12. `expiresAt`

`operation` is `activate`. The pending target is both issuer and target, signs with its own identity, and must present its current epoch as `previousEpoch`; `nextEpoch` must equal `previousEpoch + 1`. Success makes the device active at the next epoch. The event ID is the durable replay identifier.

### 4.4 Revocation and epoch updates

Revocation uses the same signed lifecycle shape with operation `revoke`. An active, different device in the same account signs the event and supplies a valid `device-control` proof. Both issuer and target must be active, the issuer epoch must be current, and the signed transition must increment by exactly one. The target is atomically stored as revoked and its durable epoch advances.

Revoked devices cannot transition back to pending or active through this protocol. Reactivation belongs to a separately authorized recovery flow.

The verifier recognizes `epoch-update` as a vocabulary value, but the current durable update handler implements revocation only.

**DISCOVERY REQUIRED:** The audited browser enrollment and activation paths call their durable endpoints. A production browser caller that submits the signed durable revocation event was not found in the reviewed runtime path. Android revocation interoperability must not be declared complete until the browser/backend invocation and its fixtures are confirmed. The Android client must not substitute local-only revocation.

### 4.5 Device proof request

Unsigned fields, in signature order:

1. `version`
2. `requestId`
3. `accountIdentityReference`
4. `deviceId`
5. `deviceIdentityReference`
6. `operation`
7. `nonce`
8. `epoch`
9. optional `resource`
10. `createdAt`
11. `expiresAt`

The optional resource is omitted when absent. The client profile uses a UUID request ID, UUID-derived nonce without hyphens, and a 30-second lifetime. The device signs the compact unsigned JSON through `signControlEvent`.

The backend verifies that the durable device exists, is active, belongs to the account, has the exact identity reference and epoch, and owns the verification key that validates the signature. It consumes `requestId` durably and issues a short-lived proof.

Recognized operations are:

- `relay:join`
- `relay:message`
- `relay:signal`
- `attachment:create`
- `attachment:write`
- `attachment:read`
- `attachment:delete`
- `private-network:admit`
- `private-network:register-node`
- `private-network:bridge`
- `device-control`

### 4.6 Device authorization proof

The proof field order is:

1. `version`
2. `proofId`
3. `accountIdentityReference`
4. `deviceId`
5. `deviceIdentityReference`
6. `operation`
7. `trustEpoch`
8. `nonce`
9. optional `resource`
10. `issuedAt`
11. `expiresAt`
12. `signature`

The server signature is unpadded-base64url HMAC-SHA-256 over UTF-8 bytes of:

`k3ncrypt-device-proof-v1\0` + compact JSON of fields 1 through 11

The signing secret is a server-only production secret of at least 32 characters. Android validates the response's requested operation, nonce, and expiry, but does not possess the server secret. Protected backend consumers verify the HMAC, durable active lifecycle, identity, current epoch, expiry, exact expected resource, and one-time use of `proofId` plus device ID.

The transport carrier is:

```json
{"deviceAuthorizationProof":{...},"proofNonce":"<same value as proof.nonce>"}
```

`proofNonce` must exactly match the proof. Missing, expired, wrong-scope, stale-epoch, revoked-device, or replayed proofs fail closed. Proofs MUST NOT be permanently cached or reused.

### 4.7 Resource binding

Current resource fields are optional at the base type but mandatory for operations that enforce them:

- messaging and signaling: `conversationId`
- private network admission: `networkId` plus the current membership context required by the authority
- bridge use: network and route context as expected by the bridge verifier
- attachments: currently `conversationId`

**DISCOVERY REQUIRED:** Although the proof type can represent `attachmentId` and `bridgeRouteId`, the audited attachment backend currently verifies an attachment proof against `{conversationId}` and separately authorizes the attachment ID through its access record. Android MUST match that current behavior. Adding `attachmentId` to the expected resource is a versioned browser/backend change, not an Android-only decision.

## 5. Messaging and mailbox protocol

### 5.1 Relay admission

The modern relay uses Socket.IO. A chat join carries:

```json
{
  "userID":"<routing-uuid>",
  "channelID":"<conversation-uuid>",
  "controlCapability":"<opaque-capability>",
  "routingProof":"<routing-ownership-proof>",
  "deviceAuthorizationProof":{...},
  "proofNonce":"<proof-nonce>"
}
```

Production admission verifies the routing identity ownership, conversation authorization, durable device proof with operation `relay:join`, and the conversation resource binding. UUID-only identity claims are insufficient.

The join acknowledgement is `{ "status": "accepted" }` after admission succeeds. It does not wait for mailbox replay or message acceptance. Failure is returned as a safe `{ "error": "..." }` response.

### 5.2 Live send

The protected `chat-message` payload carries:

```json
{
  "envelope": {"version":2,"strategy":"vodozemac-olm-v1","data":{...}},
  "recipientRoutingId":"<optional-recipient-routing-id>",
  "deviceAuthorizationProof":{...},
  "proofNonce":"<proof-nonce>",
  "proofOperation":"relay:message"
}
```

The proof must be current, one-time, and bound to the conversation. The relay never needs plaintext. A successful acknowledgement contains a UUID message `id` and epoch-millisecond `timestamp`; an offline-store acknowledgement also reports `stored: true`.

### 5.3 Offline storage and replay

The relay stores only the encrypted envelope and routing metadata. The mailbox entry expires after seven days; a mailbox holds at most 64 items; a replay lease is 30 seconds; and the server waits up to 10 seconds for an item acceptance response.

After the client has restored identity and crypto state, completed authenticated join, and released its connection-transition lock, it explicitly emits `mailbox-replay`. Replay is not part of the join acknowledgement.

For each delivery the relay sends:

```json
{"id":"<uuid>","timestamp":0,"sender":"<routing-id>","envelope":{...}}
```

The client callback returns `{ "accepted": true }` only after all of the following succeed:

1. envelope validation;
2. sender bundle retrieval and pinned-identity validation;
3. durable device-trust validation;
4. Vodozemac session creation or decryption;
5. account/session persistence;
6. frame validation;
7. application message insertion or safe duplicate recognition.

Only an accepted item is deleted. A validation, decryption, framing, or persistence failure returns `accepted: false` and retains the mailbox item for a later attempt.

The separate `received` event carries `{ "id": "<uuid>" }` and is emitted after acceptance for the live delivery path.

### 5.4 Deduplication

The server mailbox deduplication key is lowercase-hex SHA-256 of compact JSON in this property order:

```json
{"channel":"...","mailbox":"...","sender":"...","envelope":{...}}
```

Retries MUST preserve the exact encrypted envelope. The modern client also hashes compact JSON of the envelope and stores a bounded seen-envelope set. An already committed duplicate is acknowledged without inserting a second UI message.

Mailbox replay ordering is not a published ordering guarantee in the current Mongo claim path. Android MUST tolerate independent ratchet-valid deliveries and MUST NOT infer chronological order from replay arrival alone.

### 5.5 Modern versus legacy messaging

The repository retains an older invitation/session facade alongside the modern Vodozemac conversation path. Android Phase 9 targets the modern `vodozemac-olm-v1` envelope, authenticated routing, durable proof, and mailbox contracts described here. Legacy AES/session formats are not a basis for new Android compatibility.

## 6. Attachment and media protocol

### 6.1 Limits and cryptography

- Maximum attachment size: 50 MiB.
- Plaintext chunk size: 256 KiB.
- Maximum chunk count: 256.
- Attachment lifetime: seven days.
- Content encryption: AES-256-GCM with a random 32-byte key.
- Each chunk uses an independent random 12-byte nonce.

For zero-based chunk index `i` and total chunk count `n`, AAD is UTF-8:

`k3ncrypt-attachment-v1:<attachmentId>:<i>:<n>`

The stored ciphertext includes the GCM authentication tag. Metadata uses the same attachment key, a distinct random 12-byte nonce, and AAD:

`k3ncrypt-attachment-metadata-v1:<attachmentId>`

The compact plaintext metadata object has field order:

```json
{"size":0,"chunkCount":0,"createdAt":0,"expiresAt":0}
```

### 6.2 Attachment reference and transport

The encrypted attachment reference contains:

```json
{
  "id":"<uuid>",
  "size":0,
  "chunkCount":0,
  "createdAt":0,
  "expiresAt":0,
  "encryptedMetadata":{"nonce":"<base64url>","ciphertext":"<base64url>"}
}
```

Create requests encode nonce and ciphertext byte values as JSON arrays. Chunk upload sends raw encrypted bytes as `application/octet-stream` with chunk index, total count, and nonce headers. Download responses encode each chunk's nonce and ciphertext as base64url.

Attachment API requests also carry conversation, participant, control capability, routing ownership, request ID, durable device proof, and proof nonce headers. Create/write/read/delete require the corresponding proof operation and the current conversation resource binding. Attachment access records bind an attachment to its conversation and owner; possession of an attachment ID alone grants no access.

### 6.3 Media message payload

The attachment key and opaque attachment capability are sent only inside the end-to-end encrypted conversation payload. The payload begins with ASCII prefix `k3ncrypt-media-v1:` followed by compact JSON constructed in this order:

1. `version`
2. `kind`
3. `mimeType`
4. `size`
5. optional `durationMs`
6. `attachmentId`
7. `encryptedMetadata` with numeric nonce and ciphertext arrays
8. `attachmentKey` numeric byte array
9. `attachmentCapability`

Valid media kinds are `image`, `video`, `file`, and `voice`. Current MIME admission is:

- image: `image/png`, `image/jpeg`, `image/webp`, or `image/gif`, with a 20 MiB media limit;
- video: `video/webm`, `video/mp4`, or `video/ogg`, with a 50 MiB media limit;
- voice: exactly `audio/webm;codecs=opus`, with a 50 MiB media limit;
- file: a non-empty MIME type other than one beginning with `application/x-msdownload`, with a 50 MiB media limit.

Optional values are omitted rather than encoded as `null`. Servers must never receive the attachment key outside the encrypted message.

Cancellation or failure MUST discard plaintext buffers and uncommitted key material. Android must use platform-private temporary storage, if any, and erase it after success, failure, or cancellation.

## 7. Call signaling protocol

### 7.1 Shared security boundary

Call signaling is carried as channel 2 inside the existing Vodozemac encrypted conversation session. Relay submission requires a one-time `relay:signal` proof bound to the conversation. WebRTC media uses browser/platform WebRTC DTLS-SRTP. K3NCRYPT does not add custom media cryptography or store plaintext media.

An authenticated call session pins its conversation, participants, verified identities, creation time, expiry, and replay state. Unauthorized participants, changed identities, expired sessions, malformed signals, and repeated sequence numbers are rejected.

### 7.2 Modern authenticated call signal

The current authenticated signal has:

```json
{
  "callId":"<uuid>",
  "conversationId":"<uuid>",
  "sender":{"participantId":"...","identityId":"...","verification":"verified"},
  "event":"<event>",
  "kind":"control|offer|answer|ice-candidate",
  "payload":{},
  "sequence":0,
  "timestamp":0,
  "expiresAt":0,
  "identityBinding":"<lowercase-hex-sha256>",
  "payloadDigest":"<lowercase-hex-sha256>"
}
```

The payload digest input is compact JSON in this order:

1. `callId`
2. `conversationId`
3. `sender`
4. `event`
5. `kind` (default `control`)
6. `payload` (default `null`)
7. `sequence`
8. `timestamp`
9. `expiresAt`
10. `identityBinding`

`payloadDigest` is lowercase-hex SHA-256 of those UTF-8 JSON bytes.

The identity binding sorts participants by `identityId`, renders each as `<participantId>:<identityId>`, joins entries with `|`, and hashes UTF-8:

`k3ncrypt:call-binding:v1\0<conversationId>\0<joined-participants>`

The replay key is `<callId>:<sender.participantId>:<sequence>`. A sender timestamp more than 30 seconds in the future is invalid; the signal and call session must both remain unexpired.

### 7.3 Legacy browser WebRTC signal facade

The browser SDK also contains an established facade whose control signals use `call-invite`, `call-accept`, `call-reject`, `call-cancel`, `call-end`, or `call-timeout` with `callId`, `seq`, `timestamp`, optional reason, and optional media kind `audio` or `video`. SDP offers/answers and ICE candidates are represented as:

```json
{"type":"offer|answer","sdp":"...","callId":"...","seq":0,"timestamp":0}
```

```json
{"type":"candidate","candidate":{},"callId":"...","seq":0,"timestamp":0}
```

Sequence numbers must increase for each call and stale or duplicate signals are rejected.

**DISCOVERY REQUIRED — Android blocker:** The repository currently contains both this facade and the modern `CallSignal` contract. The modern invite path does not freeze the voice/video media mode in the same explicit field used by the facade, and its SDP/ICE `payload` schema is not strictly validated as a standalone wire schema. Before Android call implementation, the browser's production path must be identified and one versioned set of fixtures must freeze:

- invite/accept media mode (`voice`/`video` versus `audio`/`video`);
- SDP offer and answer payload shape;
- ICE candidate payload shape;
- sequence and expiry behavior across reconnects;
- whether signaling is live-only (the current Socket.IO implementation does not provide an offline call mailbox).

Android MUST NOT invent a third representation.

### 7.4 ICE, permissions, and cleanup

ICE servers come from deployment configuration. TURN URLs and credentials must not be hardcoded. Relay-only behavior is a deployment policy. Microphone and camera capture require explicit user action and Android runtime permission. Tracks, audio focus, camera resources, peer connection, pending timers, and replay/session state must be released on rejection, cancellation, failure, timeout, or end.

## 8. Cross-platform golden vectors

Golden vectors MUST be versioned, reviewed artifacts consumed unchanged by TypeScript, Kotlin, Rust, and backend test suites. Expected values MUST be stored in the fixture, not recomputed by the same code under test. Suggested location: `protocol-fixtures/v1/`.

Each fixture includes `fixtureVersion`, a short purpose, exact input bytes or JSON text, expected output, and negative mutations. All private material must be synthetic test-only material and clearly labeled as unusable in production.

Required fixtures:

| Fixture | Required contents |
|---|---|
| `encoding.json` | UTF-8, base64url-without-padding, lowercase hex, UUID, and millisecond timestamp cases, including rejection cases. |
| `identity-fingerprints.json` | Fixed Curve25519 and Ed25519 public keys, normalized keys, exact domain-separated hash bytes, digest, and display fingerprint. |
| `control-event-signatures.json` | Synthetic fixed Ed25519 identity, exact unsigned JSON strings for bootstrap, enrollment, activation, revocation, membership, and proof request; expected signatures; altered-field and reordered-field negatives. |
| `device-proof-requests.json` | Exact signed request bytes with and without resource context, expiry/epoch/replay negatives, and expected verifier result. |
| `server-authorization-proofs.json` | Synthetic server HMAC secret, unsigned proof JSON, expected HMAC, proof carrier, resource mismatch, operation mismatch, and replay cases. |
| `olm-sessions.json` | Synthetic encrypted account/session pickles and pickle key, public bundle, claimed key ID, pre-key and normal Olm wire messages, frame channel, expected decrypted test bytes, restart continuation, and wrong-identity negatives. |
| `encrypted-envelopes.json` | Exact version 2 envelopes, serialized digest inputs, valid pre-key/normal cases, extra-field, version, strategy, framing, and duplicate cases. |
| `attachments.json` | Fixed key, nonces, attachment ID, chunks, exact AAD bytes, ciphertext/tag values, metadata ciphertext, reference, and tamper cases. |
| `call-signals.json` | Participant list, identity binding, exact digest input, invite/accept, SDP, ICE, sequence/replay and expiry cases after the call-contract discovery is resolved. |
| `network-membership.json` | Exact membership event JSON/signature, account/network/resource bindings, epoch changes, add/remove/update cases, and cross-account negatives. |

Vodozemac vectors that depend on random account/session generation SHOULD use checked-in synthetic encrypted pickles or a Rust test fixture generator with a committed immutable output. Tests MUST load the same artifact across languages; they must not generate separate random accounts and compare only their own results.

The compatibility gate requires:

1. byte-for-byte canonical unsigned JSON equality;
2. signature verification in all four environments;
3. matching fingerprint, hash, and AAD bytes;
4. cross-runtime encrypt/decrypt and restart interoperability;
5. identical acceptance/rejection for negative vectors;
6. no fixture containing real user secrets or production credentials.

## 9. Safe error contract

The current APIs intentionally collapse many authorization failures into safe HTTP or Socket.IO responses. Cross-platform clients should use the following internal categories without exposing cryptographic details:

| Category | Meaning | Retry guidance |
|---|---|---|
| `AUTHENTICATION_FAILURE` | Caller, routing identity, or session could not be authenticated. | Reauthenticate; do not blind-retry. |
| `INVALID_PROOF` | Missing, malformed, wrong-operation, wrong-resource, stale-epoch, or replayed proof. | Acquire a new correctly scoped proof after refreshing trust. |
| `EXPIRED_PROOF` | Proof or signed request is outside its validity window. | Correct clock if needed and request a new proof. |
| `IDENTITY_MISMATCH` | Pinned identity, sender identity, target fingerprint, or account/device binding differs. | Stop and require explicit trust resolution. |
| `REVOKED_DEVICE` | Durable lifecycle or membership state denies the device. | Do not retry; show a device-trust status. |
| `INVALID_ENVELOPE` | Envelope, Olm message, frame, signature, digest, or schema is invalid. | Reject and retain mailbox data where applicable. |
| `PERSISTENCE_FAILURE` | Account, session, replay, lifecycle, or application state did not commit. | Keep encrypted input unacknowledged and allow controlled retry. |

A wire endpoint may return only a generic 400/403/409/503 or safe `{error}` string. A client MUST NOT infer a more specific category unless a versioned response or its own trusted local state proves it. In particular, a generic 403 must not be displayed as definitive revocation.

Error telemetry may contain the category, operation stage, duration, and a non-sensitive correlation ID. It MUST NOT contain private keys, account/session pickles, plaintext, ciphertext, attachment keys, capabilities, proof signatures, production secrets, full identity material, or sensitive message metadata.

Existing Vodozemac wrapper codes such as `WASM_INIT_FAILED`, `CORRUPTED_ACCOUNT`, `CORRUPTED_SESSION`, `UNSUPPORTED_PROTOCOL`, `INVALID_CIPHERTEXT`, `MISSING_SESSION`, `IDENTITY_MISMATCH`, and `INVALID_LIFECYCLE` map into these safe categories at the product boundary. Detailed causes stay local and redacted.

## 10. Testing strategy

### 10.1 Rust crypto tests

Rust owns primitive-boundary tests for account creation/loading, strict pickle-key length, account/session size limits, control-event signatures, identity-key encoding, pre-key and normal Olm wire parsing, inbound/outbound session interoperability, restart state, tamper rejection, and synthetic golden-vector production verification.

### 10.2 TypeScript compatibility tests

TypeScript tests consume the immutable fixtures and verify exact canonical strings, key normalization, fingerprints, envelope schema, frame bytes, lifecycle/proof request construction, attachment AAD/ciphertext, call digests, mailbox acceptance ordering, persistence-before-acknowledgement, and replay rejection. Browser tests must cover IndexedDB/vault restart behavior with the production WASM artifact.

### 10.3 Kotlin compatibility tests

Before Android UI work, a pure Kotlin/JVM compatibility module must consume every non-browser fixture. It verifies exact UTF-8 bytes, JSON property order, omission of optional fields, base64url and hex encodings, Ed25519 signatures, HMAC proof parsing without access to the server secret, timestamps, UUIDs, AES-GCM attachment vectors, and call digest construction. Android instrumented tests then verify Keystore-wrapped account storage, crash-consistent account/session commits, process-death restore, and WebRTC/media lifecycle.

Kotlin tests MUST compare serialized bytes directly. Parsing and reserializing with an unordered map is not a valid compatibility test.

### 10.4 Backend verification tests

Backend tests verify every fixture against the production validators and durable Mongo authorities. They cover bootstrap uniqueness, enrollment/activation/revocation state transitions, proof issuance and consumption, resource/operation/epoch/account binding, nonce and event replay across restart, attachment access, routing ownership, network membership removal, and fail-closed authority unavailability.

### 10.5 Cross-platform integration tests

The release gate includes, at minimum:

1. Browser creates identity; Android verifies fingerprint and enrolls through a browser trusted device.
2. Android creates identity; browser verifies fingerprint and enrolls it.
3. Browser-to-Android and Android-to-browser first pre-key messages.
4. Bidirectional normal Olm messages across process restart and offline mailbox replay.
5. Duplicate, altered, wrong-identity, revoked-device, stale-epoch, and replayed-proof rejection.
6. Browser upload/Android download and Android upload/browser download for multi-chunk attachments, including tamper rejection.
7. Proof acquisition and protected relay, attachment, device-control, and private-network operations from Android.
8. Network member removal terminating existing authorization.
9. Voice/video invite, SDP, ICE, expiry, replay, and teardown interoperability after the call contract is resolved.
10. Backend restart with lifecycle, nonce, mailbox, and membership persistence intact.

Tests requiring MongoDB use the real persistence adapters. Browser interoperability uses Chromium/Playwright; Android process-death and secure-storage behavior uses emulator or device instrumentation. Neither mock-only crypto nor mock-only durable authorities satisfy this gate.

## 11. Discovery register before Android feature implementation

The following items are not sufficiently frozen by the current implementation and require focused discovery or a versioned compatibility decision:

1. **Canonical JSON:** No general cross-language canonicalization standard exists; version 1 relies on property order. Golden vectors must be committed before Kotlin signing is used.
2. **Durable revocation invocation:** Confirm and fixture the production browser path that submits signed revocation to the durable authority.
3. **Enrollment validation profile:** Some backend enrollment fields are less strictly shape-validated than the browser emitter. Freeze the stricter client profile and rejection fixtures without relying on permissive parsing.
4. **Lifecycle nonce vocabulary:** Enrollment has both `eventId` and `nonce`; activation/revocation use `eventId` as the replay key and have no separate nonce. Android must reflect this exact distinction.
5. **Pre-key selection:** Freeze list ordering and fallback selection with an integration fixture.
6. **Attachment resource scope:** Current proof resource is conversation-bound while attachment ID authorization is enforced separately. Do not independently add attachment-ID proof binding on Android.
7. **Call signaling:** Resolve the modern authenticated `CallSignal` versus SDK WebRTC facade, including media-mode, SDP, and ICE payload schemas.
8. **Participant sort semantics:** The call binding uses JavaScript `localeCompare`; constrain identifiers or provide vectors proving Kotlin ordering equivalence.
9. **Mailbox order:** No strict replay order is currently specified. Confirm whether ordering is intentionally unordered before Android UI sequencing relies on it.
10. **Legacy formats:** Identify and explicitly exclude or version any remaining legacy invitation, message, or call code that can still reach production composition.

None of these items permits a security fallback. When a contract is unknown, Android must fail closed or defer the feature until the reference behavior is frozen.

## 12. Android implementation gate

Android protocol implementation may begin when:

- version 1 fixture files exist and pass in Rust, TypeScript, and backend tests;
- the Kotlin compatibility module passes the same fixtures byte for byte;
- durable revocation and call-signaling discovery items have an explicit result;
- browser/Android identity, first-message, restart, attachment, proof, and replay integration tests are defined;
- no Android adapter exports private identity keys, stores plaintext messages or attachment keys outside protected local storage, or acknowledges encrypted input before validated durable persistence.

This specification records the Phase 8 reference behavior. It does not claim that all contracts are ideal or complete, and it does not change any production behavior.
