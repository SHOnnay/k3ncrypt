# K3ncrypt Vodozemac browser artifact

`k3ncrypt_vodozemac.js`, its declaration file, and
`k3ncrypt_vodozemac_bg.wasm` are the locally generated, pinned Vodozemac 0.11.0
module. They are intentionally shipped as repository artifacts; the browser
must never download crypto code from a CDN or an external crypto host.

The glue is generated with `wasm-bindgen-cli 0.2.128`, matching the
`wasm-bindgen 0.2.128` crate locked by `crypto-wasm/Cargo.lock`. To reproduce:

```sh
cargo install wasm-bindgen-cli --version 0.2.128 --locked --root crypto-wasm/.tools
cargo build --manifest-path crypto-wasm/Cargo.toml --target wasm32-unknown-unknown --release
crypto-wasm/.tools/bin/wasm-bindgen \
  crypto-wasm/target/wasm32-unknown-unknown/release/k3ncrypt_vodozemac.wasm \
  --target web --typescript --out-dir crypto-wasm/pkg --out-name k3ncrypt_vodozemac
```

The SHA-256 manifest is release/build provenance only. It is not runtime
verified by the browser; normal module loading is used instead of a custom
digest loader.
