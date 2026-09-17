# Vodozemac integration boundary

Research date: 2026-09-17. This is a design record, not a production crypto claim.

## Upstream status

The current upstream crate is `vodozemac 0.11.0`, Apache-2.0, Rust edition 2024, with minimum Rust 1.89. It implements Olm (a Double Ratchet), Megolm, SAS, and modern encrypted pickles. The upstream manifest includes a `wasm_js` feature for browser randomness. Upstream reports an external Least Authority audit with no significant findings.

Primary sources:

- https://github.com/matrix-org/vodozemac
- https://docs.rs/vodozemac/latest/vodozemac/olm/
- https://docs.rs/vodozemac/latest/vodozemac/
- https://github.com/matrix-org/vodozemac/blob/main/Cargo.toml
- https://github.com/matrix-org/vodozemac-bindings

The old general-purpose `vodozemac-bindings` repository is marked unmaintained. K3ncrypt must not depend on an unreviewed third-party npm wrapper merely to shorten integration work.

## Proposed build approach

Create a separate Rust workspace package only after the TypeScript boundary is stable. Pin the crate version and Rust toolchain, enable `wasm_js`, expose a deliberately small `wasm-bindgen` API, produce deterministic release WASM, record checksums/SBOM, and test both browser and native Rust vectors. Do not enable the low-level API.

The JS wrapper should satisfy `CryptoSession`; no UI, transport, or relay code may reach vodozemac objects directly. The TypeScript boundary should pass bytes and versioned envelopes, never serialized secret internals.

## Account and session lifecycle

An Olm account owns an Ed25519 signing identity, a Curve25519 sender identity, one-time keys, and fallback keys. An outbound session needs the recipient's Curve25519 identity key and one-time key. The first outbound ciphertext is a pre-key message. The recipient creates the matching inbound session from that pre-key message plus the initiator identity key.

K3ncrypt therefore needs more than replacing `encrypt()`: it needs an authenticated identity and pre-key distribution design, key exhaustion/replenishment, identity-change handling, concurrent-session selection, and transactional persistence. The present room relay is not yet a trustworthy key server.

## Persistence and serialization

`Account::pickle()` and `Session::pickle()` yield serializable state. Modern pickle encoding is Serde-format independent; serialization alone is not encryption. Vodozemac supports encrypting pickles with a 32-byte pickle key. K3ncrypt must place only encrypted pickle bytes in `SecureStorage`, protect the independent database master/pickle key, version records, and atomically commit ratchet advancement before acknowledgement.

Browser work requires an encrypted database design and a user unlock KDF. Android can reuse the Rust core and store an app-generated database key under Android Keystore without biometrics, but native FFI/WASM parity and memory/zeroization limitations require review.

## Required prototype tests

Before production selection:

- official/interoperability vectors for outbound pre-key and inbound creation;
- bidirectional ratchet, delayed/out-of-order, duplicate, and lost-message behavior;
- account/session encrypted-pickle round trip;
- wrong/corrupt pickle rejection;
- transactional crash recovery without ratchet rollback;
- multiple sessions and identity changes;
- WASM randomness and CSP-compatible loading;
- bundle size/performance and memory lifecycle;
- Android/native and browser envelope compatibility;
- downgrade rejection and legacy/new-session migration isolation.

## Migration from the legacy adapter

1. Add an isolated Rust/WASM package and adapter named `VodozemacCryptoSession`.
2. Introduce a new envelope version and explicit capability negotiation authenticated by the new session.
3. Create messaging identities and a reviewed pre-key publication/authentication flow.
4. Implement encrypted transactional state storage.
5. Run two implementations in test fixtures; do not decrypt a vodozemac failure as legacy plaintext.
6. Allow only new conversations to select the new protocol initially.
7. Retire legacy invitations after a measured compatibility period.

Existing legacy conversations cannot be silently converted into authenticated ratchet sessions because the invite secret is not a verified identity. The UI must show identity verification separately.

