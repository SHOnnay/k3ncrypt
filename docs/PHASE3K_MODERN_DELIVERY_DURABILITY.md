# Phase 3K modern delivery durability acceptance scenario

This is the permanent production-profile regression procedure for modern
1-to-1 delivery. It requires the services in `docker-compose.phase3h.yml`, a
single relay process, and the named persistent Mongo volume. It must not be
run against the in-memory backend.

## Scenario

1. Start Mongo and one relay; wait for Mongo health and idempotent index setup.
2. In two real browser clients, have Bob create a modern identity and publish
   a bundle, then disconnect Bob.
3. Have Alice establish the modern conversation and send one message while
   Bob is offline.
4. Inspect Mongo directly. The mailbox record may contain only the opaque
   encrypted envelope, routing identifiers, dedupe/slot data, claim/expiry
   timestamps, and delivery metadata. It must not contain plaintext, private
   identity keys, session/account pickles, storage keys, or passphrases.
5. Stop and recreate only the relay. Bob reconnects, retrieves the envelope,
   decrypts and persists it locally, and ACKs it. Confirm one visible message,
   modern mode, and deletion of the mailbox record.
6. Restart Mongo without deleting `k3ncrypt-phase3h-mongo`, then restart the
   relay. Confirm indexes, pending ciphertext, and consumed OTK state persist
   and delivery can complete.

## Required concurrency and failure checks

Against the same real Mongo service, exercise duplicate and concurrent
mailbox submissions near the 64-message bound, simultaneous claims, lease
expiry/reclaim, duplicate ACK, simultaneous OTK claims, exhaustion, renewal,
and relay restart during a claim. Inject Mongo unavailability at startup,
submission, and ACK, plus relay crashes after mailbox write and before ACK.
Expected behavior is bounded/idempotent storage, one active claim, safe retry,
no duplicate OTK, no ratchet rollback, generic errors, and no secret-bearing
logs.

## Phase 3K evidence status (2026-09-19)

Compose Mongo and relay are healthy; the Mongo integration test and index
survival after container restart pass. The relay restart and browser restart
smoke flows pass in the controlled Chromium setup. Full Alice/Bob ciphertext
inspection across process crashes, real Mongo concurrency/failure injection,
and post-claim OTK stress remain deployment-gate work. The WebKit modern flow
still fails with a browser-storage/passphrase compatibility error, while the
Firefox smoke test stalls in this host environment. Modern must therefore
remain opt-in and existing conversation modes remain unchanged.
