# Vodozemac integration boundary

Updated: 2026-09-19. Phase 3E status: modern conversations are explicitly opt-in.

## Implementation

`crypto-wasm/` pins Apache-2.0 `vodozemac = 0.11.0`, Rust edition 2024/MSRV 1.89, and compiles as both `rlib` and `cdylib` for `wasm32-unknown-unknown`. It disables default features and enables only `precomputed-tables` plus `wasm_js`; `low-level-api`, `libolm-compat`, `experimental-session-config`, and `insecure-pk-encryption` are not enabled.

The `wasm-bindgen` API is K3ncrypt-specific: opaque Account and Session handles expose creation/load, public identity keys, one-time/fallback generation, supported Olm session establishment, encryption/decryption, and persistence. There is no private identity-key getter.

Boundary secret copies:

- a 32-byte HKDF-separated pickle key crosses JS→WASM for encrypted Account save/load and each JS copy is overwritten after the callback;
- encrypted Account pickle text crosses WASM→JS and is then encrypted again by `SecureStorage`;
- `SessionPickle` has no modern direct encryption helper, so transient Serde bytes cross WASM→JS and must immediately enter `SecureStorage`;
- decrypted message bytes necessarily cross WASM→the application layer while unlocked.

## Protocol adapter

`VodozemacCryptoSession` is an explicit second implementation of `CryptoSession`. It requires an already established opaque Session handle and expected session ID. Its envelope is unambiguously `{version:2,strategy:"vodozemac-olm-v1",data:{version:1,olmMessage}}`; legacy ciphertext remains version 1 with its own strategy. There is no heuristic fallback between them.

The adapter cryptographically frames plaintext with an internal version and logical channel byte before Olm encryption, so message/signaling ciphertext cannot be swapped. Strict schemas, size limits, supported-version checks, and unknown-field rejection run before the Rust parser.

`createChatInstance()` still constructs `LegacyInviteCryptoSession`. The explicit modern application path uses `ModernConversation` and Vodozemac; existing conversations are not migrated or silently switched.

## Proven behavior

Native vodozemac tests use the supported high-level flow: Bob publishes a one-time/fallback key; Alice creates an outbound v1 session; Alice's first ciphertext is a pre-key message; Bob creates an inbound session while authenticating Alice's Curve25519 identity; replies become normal Olm messages.

The tests prove:

- bidirectional Alice/Bob pre-key and normal messages;
- modern encrypted Account pickle round-trip with a 32-byte key;
- modern Session pickle round-trip, destruction of all original instances, stable public identities, and continued post-restart decryption;
- legitimate receive order 1, 3, 2 through vodozemac's ratchet;
- tampered ciphertext, malformed/unsupported messages, wrong message type/identity flow, corrupt Account pickle, and corrupt Session pickle fail closed;
- the crate compiles as optimized browser WASM.

Transport delivery IDs remain a separate duplicate-processing boundary. The legacy 1,024-sequence replay window is not applied inside the Olm ratchet; vodozemac owns ratchet/message-key ordering semantics.

## Phase 3A client boundary

`VodozemacRuntime` is the only lifecycle owner for the modern client path. It
accepts a local generated-bindings loader and opaque account/session factories;
it never returns a private key, pickle, or low-level WASM object to UI code.

The lifecycle is explicit:

`uninitialized -> crypto-ready -> identity-restored -> session-establishing -> active -> persisted -> closed`.

Initialization failure enters `error` and cannot silently fall back to the
legacy invite protocol. Encrypt/decrypt are rejected unless the state is
`active`. Account and session persistence continue through `SecureStorage`,
including the existing Vodozemac pickle-key boundary.

The client package is generated into `crypto-wasm/pkg/` by the pinned
`wasm-bindgen-cli 0.2.128` tool and includes the JS glue, TypeScript
declarations, and WASM binary. Vite bundles the glue and emits the local WASM
asset under `client/dist/assets/`. Application startup initializes this local
module; no identity or session is selected for the existing legacy path. A
missing or corrupt artifact rejects initialization and never triggers a
protocol downgrade. No CDN, remote downloader, or external crypto host is
used.

## Public boundary

The service exports `VodozemacRuntime`, `VodozemacBoundaryError`, and the
`loadLocalVodozemacBindings` contract. The runtime supports create/restore
identity, persist identity, establish/restore a session from approved opaque
inputs, encrypt/decrypt, persist session, and close. Error codes are stable and
non-sensitive: they do not include ciphertext, plaintext, keys, or pickles.

## Phase 3B–3D production foundation

The modern path has a versioned public bundle containing only public identity
material, one-time keys, and an optional fallback key. The bundle is strictly
validated for protocol/version, exact fields, key encoding, size, count, and
duplicate IDs before publication. It is published through an opaque,
capability-authorized address. A conditional backend claim removes exactly one
one-time key, including when requests race; the server never receives private
identity state, pickles, plaintext, or display names.

Publication and claiming are explicit service calls. A client fetches and
validates a pinned bundle, claims one key, and establishes an outbound session
through the reviewed vodozemac API. The recipient accepts the pre-key message
through the matching inbound API. No invented X3DH, signature, ratchet, or key
derivation is added. Session establishment authenticates the Curve25519
identity; Ed25519/Curve25519 values are exposed for fingerprint display, not as
an ad-hoc signed-bundle format.

The local identity can explicitly replenish the published pool to a bounded
target (up to 100 keys) and then republish a fresh bundle. There is no automatic
server-side key generation or private-key handling.

`ContactIdentityRegistry` provides first-seen trust-on-first-use (TOFU).
Unchanged identities remain associated; changed identities become
`changed-pending-review`, invalidate any previous `verified` state, and require
explicit review and verification. No key change is silently accepted.

Runtime encrypt/decrypt operations are serialized. Ratchet state is persisted
before success is returned; persistence failure zeroes plaintext, destroys the
session, and enters quarantine. `VodozemacSessionRepository` provides bounded
multi-session encrypted storage with eight IDs per contact and oldest-session
eviction. The modern protocol is explicit and pinned: legacy remains the
default, and initialization/artifact failures never downgrade by guessing from
ciphertext. Relay metadata remains opaque capability/address, envelope bytes,
delivery ID, and timing.

### Account/session crash consistency

Inbound pre-key handling can mutate both the account (one-time-key consumption)
and a new session. Because the current `SecureStorage` port does not expose a
single transaction spanning those records, the runtime writes an encrypted
metadata-only commit marker (`prepared`, `account-written`, `committed`) around
the two encrypted writes. The marker contains only a version, conversation ID,
session ID, and phase—never a pickle, key, plaintext, or message. Startup
recovery is deterministic: an incomplete marker deletes the associated session
record and clears the marker, while a committed marker preserves both records
and only clears the marker. Account mutations are never rolled back, so a
consumed one-time key is never reused after a crash. A malformed marker fails
closed with a corruption error.

If persistence fails after a ratchet mutation, ciphertext is not released as a
successful send and decrypted plaintext is zeroed before the error is surfaced;
the session is quarantined. Receivers must withhold delivery acknowledgement.
Senders may retry through the existing duplicate-safe delivery boundary, but
the application does not attempt unsafe ratchet rollback. Full delivery queue
semantics remain outside this phase.

Pre-key records use process-local memory in development when Mongo is not
configured, or MongoDB documents otherwise. The in-memory claim is atomic only
within one backend process. Mongo uses a conditional `findOneAndUpdate` pull.
Phase 3E expiry, cleanup, and production-store requirements are described below.

TOFU pins the first observed identity and detects later changes; it does not
prevent a first-contact man-in-the-middle. A changed identity invalidates prior
verification and requires explicit review. Modern envelopes are discriminator
and version checked, and a modern failure never falls back to legacy.

## Remaining production blockers

- production deployment review of authenticated pre-key distribution and replenishment over the capability relay;
- CSP/browser runtime hardening and browser supply-chain verification (the
  WASM artifact checksum is tracked as release provenance, not runtime-checked);
- crash/rollback tests for the account-plus-session journal boundary;
- server-side offline delivery, multi-device semantics, and product-level session selection UX;
- identity-change recovery and authenticated first-contact verification beyond manual fingerprint comparison;
- browser interoperability vectors, broader fuzzing, mobile/native parity, and performance/bundle review;
- an explicit new-conversation negotiation design and separately reviewed legacy migration plan.

Primary references: vodozemac upstream repository and 0.11 docs at https://github.com/matrix-org/vodozemac and https://docs.rs/vodozemac/0.11.0/vodozemac/olm/.

## Phase 3E: explicit modern conversations

The application now offers a separate **Create a private contact** action. A
modern invitation carries a room ID, independent room-control capability, and
opaque public-bundle address in the URL fragment. It carries no legacy message
secret. Existing legacy invitations still enter the legacy SDK unchanged. A
modern conversation record is encrypted in `SecureStorage` with mode, session
ID, local address, and remote address; reopening restores that mode and session.
Ciphertext format and relay messages never select or downgrade the protocol.
There is no automatic migration for existing legacy rooms. A later default
switch requires a reviewed migration UX, state transfer policy, compatibility
testing, and explicit user consent for each existing conversation.

`ModernConversation` is the application-facing adapter. It uses the same
`DefaultTransportManager` and `SocketIoRelayTransport` as legacy chat, including
the existing receive/ACK callback. Each participant publishes a public bundle,
joins the room using that opaque address as its routing ID, and stores no
private material on the server. The initiator validates and pins the remote
bundle, atomically claims one OTK, establishes an outbound Vodozemac session,
and persists it before sending. The recipient resolves the sender's public
bundle from the sender routing address; inbound Vodozemac pre-key processing
authenticates the sender's Curve25519 key before plaintext is accepted. The
first message's internal channel/version frame is checked before delivery.
Later messages use the persisted Olm session. The receiver returns acceptance
to the relay only after ratchet persistence and encrypted duplicate metadata
have been written.

The verification view displays the local and contact public fingerprints. A
contact starts unverified regardless of any presented status. Marking verified
requires the user to check an explicit manual-comparison confirmation; that
choice persists in the local encrypted vault. An identity change invalidates
prior verification, creates a review-required state, and blocks new acceptance.
The UI offers no QR code: a canonical QR bootstrap format and authentication
story have not been reviewed. TOFU cannot detect a first-contact MITM.

Modern delivery has a bounded encrypted local outbox (32 envelopes). Encryption
and ratchet persistence finish before an envelope enters that outbox. `pending`
means it has not been relayed; `sent` means the relay supplied a delivery ID;
`accepted` means the receiver's ACK removed it. Missing ACK causes a retry of
the **same persisted ciphertext**, never a new ratchet encryption. The
receiver stores a bounded (1,024) encrypted digest list of accepted envelopes;
duplicate ciphertext is acknowledged without decrypting or redisplaying it.
If the recipient is offline, the sender retains the envelope and retries when
the peer joins or while the sender is online. There is no server offline queue,
so the sender must stay online or reopen the app for pending messages to move.
If a storage write fails, ACK is withheld. Delivery receipts cannot prove the
recipient read the message; the peer can choose not to acknowledge.

The session repository retains eight sessions per contact. It records one
active outbound session, never evicts that session, and moves successfully
loaded inbound sessions to the recent end before evicting the least recently
used non-active session. The current product path restores one active session
per conversation; multiple-device and delayed-message session selection are
not exposed in the UI.

Public bundles expire after seven days. The in-memory backend removes expired
bundles on pre-key requests. MongoDB creates a TTL index on `expiresAt`, while
read and claim paths also reject expired records even before the TTL sweeper
runs. Each publication is at most 32 KiB and 100 OTKs; request rate limiting
still applies. Development/test may use one process's volatile in-memory store.
Production pre-key publication returns 503 when MongoDB is unavailable, so a
multi-instance deployment cannot silently use process-local OTK claims. A
shared MongoDB is required for multi-instance pre-key claims. The existing
Socket.IO room map is also process-local, so shared MongoDB alone does not
make cross-instance delivery work. Modern multi-instance deployment remains
not ready until relay routing is separately reviewed. Restarting
an in-memory backend loses public bundles and room records; MongoDB retains
them until expiry. Reopening an expired invitation fails closed and requires a
fresh conversation rather than republishing possibly claimed keys.
Publication has an encrypted local marker. The client writes it before the
network request, records the returned address, then marks the account keys as
published. If the request outcome is unknown and no address was saved, the
identity refuses automatic republication; this avoids serving the same OTKs
under another address after a lost response. Recovery of that availability
case requires a separately reviewed key-rotation flow.

Phase 3E still leaves product work before modern can become the default:
cross-device support, a reviewed identity-change recovery flow, server-side
offline delivery, long-lived bundle renewal, durable delivery receipts,
multi-tab coordination, and production deployment/operational review.

## Phase 3F: offline delivery and messaging readiness

Modern message envelopes may now be retained by the relay when the recipient
is offline. The mailbox key is the recipient's opaque routing address scoped to
the room capability; it is not a username or cryptographic identity. Each
record contains only a generated delivery ID, sender and recipient routing
addresses, room scope, timestamps/expiry, a dedupe digest, a bounded internal
slot, and the opaque encrypted envelope. The relay never receives plaintext, ratchet state, keys, or
private identity material. It still learns room membership, routing addresses,
message timing, envelope size, and delivery/retry correlation.

Offline records are bounded to 32 KiB per envelope, 64 envelopes per mailbox,
and a seven-day TTL. MongoDB uses TTL and unique dedupe indexes; in-memory mode
is explicitly volatile development/test behavior. Retrieval is bounded to 64
records per join and uses a short atomic claim lease. The recipient ACKs only
after modern decryption, duplicate-state persistence, and ratchet persistence;
the ACK means application acceptance, never that a human read the message.
Unknown or duplicate ACKs are harmless. Missing ACKs cause the sender to retry
the same persisted ciphertext, while the mailbox dedupe key prevents duplicate
storage. Expired records are removed and are not served.

Mongo startup creates idempotent indexes for pre-key expiry and
`(channel,address)`, and for offline expiry, unique `dedupeKey`, unique
`(channel,mailbox,slot)` quota allocation, and mailbox claim fields.

The current Socket.IO room map remains process-local. MongoDB makes pre-key and
offline-record claims durable and conditional across instances, but live socket
routing still requires sticky/single-instance routing or a separately reviewed
Socket.IO adapter. This is not claimed as complete cluster delivery.

Modern crypto mutations use the browser Web Locks API when available, scoped to
the conversation. Browsers without Web Locks continue in a documented limited
mode and should not open the same identity in multiple active tabs.

If a pinned contact changes identity, prior verification is invalidated and the
session is blocked. The user may explicitly accept the pending identity; this
discards the old session and requires a fresh pre-key/session establishment.
The new identity remains unverified. There is no automatic trust carryover.

Active published bundles renew in place before use when their one-time-key pool
falls below ten keys. Renewal preserves the long-term identity, replenishes up
to twenty keys, and resets the seven-day server expiry. Renewal failures leave
the local identity/session intact and are retried on a later open.

Lost-message policy is intentionally at-least-once at the network layer and
exactly-once for user-visible plaintext through the encrypted digest cache:
local persistence failure prevents submission; relay response/ACK loss retries
the same envelope; receiver persistence failure withholds ACK; relay TTL expiry
leaves the sender's pending item to fail/retry without ratchet rollback; and a
recipient crash before ACK permits a later redelivery that is safely deduped.

## Phase 3G production gate

Production configuration validation requires MongoDB persistence, an explicit
chat-link domain, debug logging disabled, and a reviewed Socket.IO adapter
before `K3NCRYPT_INSTANCE_COUNT` may exceed one. Until that adapter is actually
implemented, production startup rejects multi-instance configuration; the
process-local live room map is not treated as cluster-safe. Development and
test may continue with explicit volatile storage.

The centralized conversation policy is `legacy-default` by default. It also
recognizes `modern-explicit` and `modern-default` as deliberate policy values,
but no policy value changes an existing conversation: the encrypted persisted
conversation mode remains authoritative and relay responses cannot alter it.

Threat model summary:

- Protected: message contents from the relay/network observer, locked local
  crypto material, ratchet state, offline ciphertext contents, pinned identity
  changes after detection, and protocol downgrade attempts.
- Not fully hidden: relay timing, IP/network metadata, mailbox activity,
  message sizes, and first-contact identity authenticity before manual
  verification.
- Out of scope: a compromised unlocked endpoint, browser, operating system, or
  malicious code executing in the application origin.

The relay is not a zero-knowledge metadata service. It learns routing scope,
opaque mailbox activity, message size/timing, and delivery correlation. The
current multi-instance limitation is live Socket.IO routing; Mongo-backed
mailbox and pre-key operations use conditional database operations and TTL
indexes. A real Mongo process-restart harness is not available in this
repository environment, so the Playwright restart test covers application
restart and the Mongo integration remains a deployment verification item.

## Supported initial production profile

The supported Phase 3H topology is one relay/backend process, one persistent
MongoDB deployment, browser clients, and no horizontal Socket.IO scaling. A
reproducible local environment is defined in `docker-compose.phase3h.yml`:

```sh
docker compose -f docker-compose.phase3h.yml up --build
```

Recreate only the `relay` service to exercise application-process restart while
retaining the named Mongo volume. The current development host has Docker CLI
but no running Docker daemon, so this process-restart procedure could not be
executed here. MongoDB remains the production authority for pre-key and offline
mailbox state; volatile in-memory mode is test/development only.

## Phase 3I deployment validation (2026-09-19)

The Phase 3I gate was run from the development checkout. Docker CLI and
Compose are installed, but the Docker daemon was not running, so the Mongo
service could not be started. Consequently the Mongo integration suite stayed
skipped and no real relay/Mongo restart, index, quota, claim/ACK, OTK
concurrency, storage-inspection, or Mongo failure-injection evidence was
available. Browser runs therefore used the explicitly development-only
volatile store.

The configured Chromium Playwright suite passed all 8 tests. Firefox and
WebKit binaries were installed from the official Playwright distribution;
WebKit passed 7/8 tests, with the modern restart flow failing because the chat
container remained hidden after reopening. Firefox could not complete even the
Vodozemac smoke test in this host environment and was interrupted after the
browser worker failed to make progress. These results do not establish the
cross-browser production gate.

The full Jest suite passed 260 tests with 1 Mongo integration test skipped.
The service TypeScript check and client production build passed. The root
TypeScript check still reports existing workspace/module-resolution errors;
Rust tooling (`cargo` and `wasm-pack`) is unavailable on this host, so Rust,
WASM, and cargo-audit validation were not run.

**Phase 3I readiness decision: NO.** Modern conversations must not be made
the default until a Docker-backed Mongo run, relay/Mongo restart evidence,
storage and concurrency checks, and a passing supported-browser matrix are
available. Existing legacy conversations remain unchanged. The future switch,
once those blockers are cleared, is limited to changing the new-conversation
policy from `legacy-default` to `modern-default`; persisted conversation modes
remain authoritative.
