# Phase 8L-19 Inbound Runtime Hang Report

## Diagnostic instrumentation

The guarded browser diagnostic now records the final non-sensitive internal stage of `establishInboundSession`:

1. `input-ready`
2. `wasm-called`
3. `wasm-returned`
4. `session-created`
5. `session-serialized`
6. `returned`

The markers do not include keys, pickles, plaintext, or ciphertext. They are unavailable unless the browser test flag is enabled.

## Pending verification

Run the Mongo-backed Chromium offline replay scenario and inspect the test-only snapshot. The final stage determines whether the remaining defect is in the WASM account call, JavaScript wrapper/session construction, or durable commit path. No cryptographic behavior was changed in this diagnostic step.
