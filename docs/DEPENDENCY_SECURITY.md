# Dependency security

Audit date: 2026-09-17.

## Result

`npm audit` reports **0 known advisories** after targeted upgrades and overrides. `npm audit --omit=dev` also reports **0 production advisories**. This is a time-sensitive snapshot, not a guarantee.

## Remediation

- Removed dormant `form-data`, `node-fetch`, and `uuid` dependencies with the plaintext image-upload code.
- Replaced server identifiers with Node `crypto.randomUUID()`.
- Upgraded Express and Socket.IO.
- Pinned patched compatible Engine.IO, Engine.IO client, Socket.IO adapter/parser, and `ws` transitive versions.
- Ran non-breaking `npm audit fix` for development tooling.
- Upgraded Vite and its React plugin, then pinned patched `esbuild 0.28.2` in both workspaces.
- Removed obsolete `@types/socket.io`; Socket.IO ships its own types.
- Kept `cross-env` in development dependencies.

No `npm audit fix --force` was used.

## Phase 2 additions

| Dependency | Version | Purpose | License | Runtime/network behavior | Maintenance assessment |
| --- | --- | --- | --- | --- | --- |
| `hash-wasm` | 4.12.0 | Browser-compatible Argon2id KEK derivation | MIT | Bundles WASM as package data/base64 and makes no runtime network request; runs in browsers and Node | Established upstream (`Daninet/hash-wasm`), broad usage, active issue/release history; pinned by lockfile |
| `vodozemac` | 0.11.0 | Audited high-level Olm Account/session/ratchet primitive | Apache-2.0 | Compiled locally to Rust native/WASM; `wasm_js` obtains browser randomness and makes no application network requests | Matrix.org upstream; 0.11.0 released 2026-09-11; exact version pinned in Cargo.lock |
| `wasm-bindgen` | 0.2.128 (locked) | Narrow Rust/WASM ABI generation | Apache-2.0/MIT | Build/runtime glue only; no network requests | Rust/WASM ecosystem standard, lockfile-pinned |
| `serde` / `serde_json` | 1.0.229 / 1.0.151 (locked) | Strict modern Session pickle and boundary serialization | Apache-2.0/MIT | Native/WASM serialization only; no network requests | Widely maintained Rust ecosystem libraries |
| `zeroize` | 1.9.0 (locked) | Best-effort wiping of transient Rust pickle-key copies | Apache-2.0/MIT | Native/WASM memory operation only | RustCrypto-maintained ecosystem component |

No general-purpose third-party vodozemac JavaScript binding was added. `low-level-api`, legacy libolm compatibility, experimental session config, and insecure public-key encryption are disabled.

## Operational policy

CI should run both `npm audit --omit=dev` (release gate) and full `npm audit` (toolchain visibility), review lockfile diffs, and test upgrades before release. Overrides are temporary compatibility controls and should be removed when direct dependency ranges naturally select the fixed versions.
