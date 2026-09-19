# Vodozemac integration boundary

Updated: 2026-09-19. Phase 3A status: boundary implemented; protocol remains opt-in.

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

`createChatInstance()` still constructs `LegacyInviteCryptoSession`. The vodozemac adapter is available only through direct test/development construction. Production conversations are not migrated or silently switched.

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

## Remaining production blockers

- reviewed authenticated pre-key distribution and replenishment over the capability relay;
- CSP/browser runtime hardening and browser supply-chain verification (the
  WASM artifact checksum is tracked as release provenance, not runtime-checked);
- transactional ratchet-state commit before network acknowledgement and crash/rollback tests;
- concurrent/multiple-session selection, lost-message policy, and multi-device semantics;
- verification UX and authenticated identity binding;
- browser interoperability vectors, broader fuzzing, mobile/native parity, and performance/bundle review;
- an explicit new-conversation negotiation design and separately reviewed legacy migration plan.

Primary references: vodozemac upstream repository and 0.11 docs at https://github.com/matrix-org/vodozemac and https://docs.rs/vodozemac/0.11.0/vodozemac/olm/.
