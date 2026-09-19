# K3ncrypt Vodozemac browser artifact

`k3ncrypt_vodozemac_bg.wasm` is the locally built, pinned Vodozemac 0.11.0
module. It is intentionally shipped as a repository artifact; the browser
must never download crypto code from a CDN or an application server.

The generated `wasm-bindgen` JavaScript glue is a release-build prerequisite.
Until that audited glue is generated with the pinned toolchain, the service
loader fails closed with `WASM_INIT_FAILED` and no conversation falls back to
the legacy protocol.
