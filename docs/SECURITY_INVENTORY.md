# K3ncrypt security inventory

This inventory records security-sensitive direct dependencies and their role.
Versions are from the checked-in lockfiles; transitive packages are reviewed
through the normal npm/Cargo lock and audit workflows.

| Package/crate | Version | Role | Runtime/build | License/security role |
| --- | --- | --- | --- | --- |
| `vodozemac` | `0.11.0` pinned | Olm ratchet and Account/Session primitives | WASM runtime | Apache-2.0; core message security |
| `wasm-bindgen` | `0.2.128` locked | Rust/WASM boundary | runtime/build | MIT/Apache-2.0; local same-origin artifact |
| `zeroize` | `1.9.0` locked | transient secret clearing | runtime | MIT/Apache-2.0; key/pickle hygiene |
| `serde` / `serde_json` | `1.0.229` / `1.0.151` locked | strict Rust serialization | runtime/build | Apache-2.0/MIT; wire/pickle schemas |
| `mongodb` | `6.9.x` lock-resolved | shared pre-key/offline mailbox persistence | server runtime | Apache-2.0; atomic claims and TTL indexes |
| `socket.io` / `socket.io-client` | `4.8.3` | opaque relay transport | server/browser runtime | MIT; routing only, no plaintext/key access |
| `express` | `4.22.3` | HTTP API boundary | server runtime | MIT; capability and validation endpoints |
| `argon2-browser` | lock-resolved | local vault passphrase KDF | browser runtime | MIT; local encrypted storage unlock |

No remote cryptographic module, analytics SDK, tracking library, or hosted
crypto service is used. `npm audit --audit-level=high` is part of the release
check. `cargo audit` was not installed in this environment.
