# Phase 9.2 — Android Identity and Encrypted Messaging Plan

## Goal and security invariants

Deliver the first connected Android identity and text-messaging flow using the Phase 8 browser/backend contracts and the Rust Vodozemac implementation. Kotlin owns platform adapters and application state; it does not implement identity keys, Olm, signatures, or message encryption.

Keep the existing device identity, lifecycle epochs, server-verifiable authorization proofs, resource binding, replay protection, encrypted mailbox, and fail-closed behavior. The backend remains the authority for lifecycle and proof status. Do not add capability-only fallbacks, silent identity/session recreation, plaintext server mailboxes, or positive acknowledgement before durable acceptance.

## 0. Foundation exit gates

Complete these before building message screens:

- Compose the current modules through Hilt and a single application-scoped identity/session repository.
- Add Room construction, migration policy, read/restore APIs, and repositories for encrypted account, session, inbox/outbox, deduplication, and trust metadata.
- Define stable account/device/conversation/session identifiers. Native numeric handles are process-local and must never be durable database keys.
- Define crash recovery so a received envelope cannot leave ratchet/session state advanced without a durable message and deduplication marker. Mailbox acceptance must follow recovery-safe persistence.
- Resolve the session-pickle bridge: keep serialized ratchet state protected and minimize its exposure across JNI/Kotlin.
- Add a real proof provider that signs a fresh DeviceProofRequest, obtains a short-lived backend proof, validates response shape/expiry locally, and attaches it to the requested operation. Backend verification remains authoritative.
- Confirm the signed bootstrap, enrollment, activation, revocation, proof, pre-key, and Socket.IO request/ack contracts against backend handlers. Add shared fixtures before implementing each client call.
- Run instrumented tests on an emulator for Keystore, Room, JNI load, and process recreation.

## Identity creation and restoration

1. On first launch, create the account through the Rust Vodozemac adapter. Read only public identity material for display, fingerprinting, and signed requests.
2. Obtain the local pickle-encryption key through the Android Keystore-backed vault service. Never place it in preferences, logs, API bodies, or durable plain Room fields.
3. Persist the encrypted Vodozemac account and local device metadata transactionally. Restore the same account before opening protected transports.
4. Create the first-device signed bootstrap request using the established backend contract. The server assigns the account reference and initial lifecycle record; client-selected trust state is never accepted.
5. For later devices, submit a target-device-signed enrollment event approved by an existing active device. Keep pending enrollment distinct from target activation. Activate with the target device's signed event and current epoch. Handle revocation and trust refresh as server lifecycle state, never as client claims.
6. Request fresh, short-lived proofs only when needed. Bind operation and resource scope, respect expiry, and discard after use according to the backend replay contract.

Acceptance checks:

- Restart restores exactly the prior Vodozemac account and device identity.
- Bootstrap replay, duplicate device IDs, altered signatures, unknown issuer, stale epoch, pending target, and revoked device fail closed.
- An enrolled target cannot use protected operations until signed activation and proof issuance succeed.
- Revocation blocks new proof issuance and protected operations after the server's durable state changes.

## Conversation and session lifecycle

Create a conversation repository keyed by the canonical conversation/routing identifiers used by the current service. Pin peer identity through the existing verification flow before accepting sensitive first-contact messaging. Never treat a server-prekey bundle as authenticated identity evidence by itself.

Load and persist Olm account/session state through the Rust adapter. Store a stable mapping from conversation/peer routing identity to session record; do not use a native handle value as a storage identifier. Publish/claim pre-keys and validate identity continuity using the existing browser/backend contracts. Do not generate a fallback session after failed verification.

## Message send and receive

Outgoing message:

1. Check current trust and conversation membership.
2. Acquire a fresh resource-bound relay:message proof for the conversation.
3. Build the exact versioned message frame in Kotlin domain code, then pass plaintext bytes to Rust Vodozemac for Olm encryption.
4. Submit only the encrypted envelope through the existing Socket.IO contract with routing identity and proof carrier.
5. Record pending/delivered/failed state without storing plaintext outside the intended local message store. Retry only the same logical delivery under the defined deduplication rules; obtain a fresh proof when needed.

Incoming message:

1. Authenticate relay join and device proof; complete join acknowledgement after admission and routing authorization.
2. Start mailbox replay only after connection setup releases its lock and crypto restoration is ready.
3. Validate envelope schema, conversation, sender identity continuity, device trust, and sender bundle before calling Vodozemac.
4. Decrypt and validate framing using Rust Vodozemac. Commit account/session state, message content, deduplication marker, and delivery state with crash recovery.
5. Emit received and return the positive Socket.IO acceptance only after the durable commit succeeds. Invalid, duplicate, wrong-identity, revoked-device, or persistence-failed delivery is never acknowledged as accepted.

Acceptance checks cover online and offline first messages, restart before replay, restart after acceptance, duplicate replay, malformed envelope, wrong sender identity, revoked device, expired proof, unavailable proof authority, persistence failure between every commit phase, and mailbox retention on rejection.

## Synchronization

Use the existing authenticated sync protocol and resource-bound proofs. Treat sync records as untrusted until envelope, identity, epoch, and replay validation succeeds. Persist imported account/session/message state with the same crash-recovery semantics as relay delivery. Keep conflict handling fail-closed and do not merge lifecycle state based on device-local claims.

Phase 9.2 should first establish a single-device Android message lifecycle. Add multi-device reconciliation only against the durable Phase 8 authority contracts and shared fixtures.

## Notifications

Default notification text must not include message body, sender address, attachment name, or call contents. A push notification may wake the app or show a generic “New message” notice; it is not authenticated message content. Fetch the encrypted envelope through the authorized relay/sync path, then validate and decrypt locally. Define token registration and revocation contracts with the backend before using a push provider.

## Testing strategy

- **Rust:** Vodozemac account/session restart tests, one-time pre-key consumption, invalid identity/message rejection, JNI ABI and symbol checks.
- **Kotlin unit:** shared identity fingerprint, canonical lifecycle/proof bytes, proof/resource request construction, envelope parsing, framing, deduplication, repository state transitions, retry behavior, and safe error mapping.
- **Room/Keystore instrumentation:** encrypted persistence, database migrations, failed transaction rollback, key invalidation, backup exclusion, process death between crypto/message/ack phases.
- **Backend contract tests:** bootstrap, enrollment, activation, revocation, proof issuance/replay, relay join, send, mailbox replay, received acknowledgement, and lifecycle freshness.
- **Cross-platform vectors:** browser↔Android and Rust↔Android identity fingerprints, signed control events, Olm pre-key and established-session messages, resource-bound proof requests, envelope framing, and replay outcomes. Keep vectors synthetic and public.
- **End-to-end:** real backend with Mongo, Android emulator plus browser peer, recipient offline/restart/reconnect, duplicate and invalid deliveries retained in mailbox, and revoked/stale devices denied.

## Delivery order

1. Close the foundation exit gates and establish repeatable device tests.
2. Implement first-device bootstrap and account restore.
3. Implement existing-device approval, target activation, revocation refresh, and fresh proof acquisition.
4. Implement contact identity verification and pre-key lifecycle.
5. Implement online encrypted text send/receive.
6. Implement durable outbox, mailbox replay, deduplication, and crash recovery.
7. Add private notifications only after authenticated wake/fetch contracts are verified.

Phase 9.2 is complete only when browser↔Android and Android↔Android text messages pass online and offline with durable restart recovery, exactly-once visible insertion, and fail-closed authorization.
