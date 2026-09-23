# Phase 8L-6 Browser Crypto Adapter Report

## Adapter trace

The browser adapter creates exactly one opaque WASM account object per account factory call. Account restoration passes the vault-decrypted pickle and derived pickle key directly to `K3ncryptAccount.loadAccount`; it does not create a replacement identity.

At inbound establishment, the adapter converts only URL-safe Curve25519 public-key characters (`-` to `+`, `_` to `/`) before passing the sender identity into the WASM binding. The encrypted pre-key wire message is passed unchanged. This matches the Rust boundary, which parses that JSON wire message and then verifies it with Vodozemac.

## Comparison evidence

- The retained browser mailbox envelope is protocol version 1, Olm `message_type: 0`, which is the required pre-key type.
- The deterministic WASM diagnostic accepts the same class of restored-account pre-key flow.
- The restart replenishment diagnostic also accepts a pre-key message created before restart and later key replenishment.
- The adapter does not encode, decode, or mutate the encrypted message.

## Exact failing comparison

No public-state divergence is currently observable at the browser adapter boundary. The existing public adapter surface does not expose stable identifiers for the restored account's one-time-key set, and therefore cannot yet compare the server-selected key identifier with the restored browser account without adding a narrow test-only observation API.

## Root-cause status

There is no evidence that URL-safe key conversion, account-object recreation, or wire-message conversion causes the failure. The remaining unobserved comparison is the published server one-time-key identifier against the restored browser account's public key set at the exact inbound call.

## Recommended minimal diagnostic

Add a test-only adapter inspection method that derives the existing public bundle and returns only its fingerprint and derived one-time-key identifiers. Invoke it immediately before `establishInboundSession` in the browser regression harness. Do not expose it to application flows, and do not alter session acceptance.

## Security posture

No encryption, trust, validation, or session-acceptance behavior was modified.
