# K3ncrypt Vodozemac browser artifact

`k3ncrypt_vodozemac.js`, its declaration files, and
`k3ncrypt_vodozemac_bg.wasm` are the pinned Vodozemac 0.11.0 module. They are
intentionally shipped as repository artifacts; the browser must never download
crypto code from a CDN or an external crypto host.

## Reproducible build

The committed files are the output of the container build in
`scripts/build-wasm.sh`. From a clean checkout with Docker running:

```sh
bash scripts/build-wasm.sh
```

It builds the committed `crypto-wasm/` sources (`git archive HEAD`) inside
`rust:1.89.0@sha256:57407b378b2b6e07b48a6135a20c87cc22ea6e249c0acf6cb1833ead3cf116e9`
with wasm-pack 0.15.0, wasm-bindgen-cli 0.2.128 (matching the
`wasm-bindgen 0.2.128` crate locked by `crypto-wasm/Cargo.lock`), the release
profile, and the wasm-opt pass wasm-pack runs. It writes to a temporary
directory and compares each file with this folder. A reproduced build prints
`same` for all four files:

```text
same     k3ncrypt_vodozemac_bg.wasm
same     k3ncrypt_vodozemac.js
same     k3ncrypt_vodozemac.d.ts
same     k3ncrypt_vodozemac_bg.wasm.d.ts
```

Checked on 2026-11-03 on an arm64 (Apple silicon) host: two independent runs
gave byte-identical output. An amd64 host has not been compared yet. The first
run needs network access to install the tools; it takes several minutes.

To replace the artifact after a change to `crypto-wasm/src` or its lock file,
commit the source change, run the script with an output directory, copy the
four files above into this folder, and set `sha256` in `manifest.json` to
`shasum -a 256 k3ncrypt_vodozemac_bg.wasm`.

Do not build the artifact with a host toolchain: the result embeds the
builder's home directory path and differs from the container build.

The SHA-256 manifest is release/build provenance only. It is not runtime
verified by the browser; normal module loading is used instead of a custom
digest loader.
