# Phase 8L-7 Pre-key Reconciliation Report

## Test-only inspection boundary

A guarded inspection hook was added at the browser WASM adapter boundary. It is disabled unless the diagnostic harness explicitly sets `__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__` to `true`. It returns only public account identity, public one-time-key material, and the public fallback key; it never returns account pickles, private keys, plaintext, or ciphertext.

The hook is not called by product code. It fails closed in normal application execution.

## Comparison status

The existing deterministic restart diagnostics prove that a restored account accepts a first pre-key message, including after replenishment. The production-like browser replay still rejects the retained valid pre-key envelope. The newly isolated hook is the required remaining observation point for a browser harness to derive stable key IDs and compare the server-selected bundle key with the restored active account.

## Evidence so far

- Mongo stores the opaque envelope with the intended routing identity and room.
- The envelope is an Olm pre-key message.
- Native Vodozemac restored-account and replenishment flows both accept equivalent messages.
- The browser adapter only converts URL-safe public-key representation; it does not mutate the message or recreate the restored account.

## Smallest safe next step

Run the Mongo-backed browser scenario with the guarded diagnostic harness enabled, derive identifiers from the returned public material, and compare them with the selected server bundle key. Do not change session acceptance until that comparison proves whether the selected key is absent, already consumed, or bound to a different identity.
