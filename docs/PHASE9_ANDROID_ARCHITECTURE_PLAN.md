# Phase 9 Android Architecture Plan

## Status and scope

This document defines the Android roadmap from the frozen Phase 8 browser beta. It does not change the Phase 8 trust model, wire protocols, cryptographic algorithms, or backend authorization rules.

The existing TypeScript service SDK is the behavioral reference, but it cannot be embedded unchanged in a production Android client. It depends on browser APIs including WebCrypto, IndexedDB, `window.fetch`, browser Socket.IO, `MediaStream`, and `RTCPeerConnection`. Android should implement native adapters against the same versioned contracts and use the same Vodozemac Rust implementation through a narrow native boundary.

## Architecture decisions

### Technology stack

| Concern | Decision | Reason |
| --- | --- | --- |
| Language | Kotlin | First-class Android lifecycle, coroutine, security, and testing support. No cross-platform runtime is required for the initial Android client. |
| UI | Jetpack Compose, single-activity navigation | Native adaptive UI with explicit lifecycle ownership and testable state. |
| Presentation | Unidirectional state flow using `ViewModel`, immutable UI state, and `StateFlow` | Keeps security decisions outside composables and makes reconnect, permission, and call states deterministic. |
| Dependency injection | Hilt | Application-scoped identity/vault services and conversation/call-scoped runtime ownership without global mutable singletons. |
| HTTP | OkHttp with Retrofit or a thin typed API layer and Kotlin serialization | Certificate-validated REST transport, cancellation, timeouts, and strict response models. |
| Realtime | Socket.IO Java client over OkHttp-compatible TLS | The current backend uses Socket.IO events and acknowledgement semantics; a raw WebSocket client is not protocol-compatible. |
| Local structured storage | Room | Transactional storage for encrypted records, delivery state, deduplication, and sync checkpoints. |
| Database encryption | SQLCipher-backed Room with a randomly generated database key wrapped by Android Keystore | Protects local metadata and ciphertext records at rest. Record-level encryption remains for Vodozemac and sensitive vault records. |
| Secret protection | Android Keystore, hardware-backed/StrongBox when available | The Keystore wraps local vault and database keys. Private identity material is never sent to the server. |
| Background work | WorkManager for bounded retry/sync; a foreground service only for active calls and user-visible transfers | Matches Android execution limits and avoids an always-running background socket. |
| Media calls | Native WebRTC (`org.webrtc`) | Maps the established offer/answer/ICE boundary to Android without changing signaling or media cryptography. |
| Media playback | Media3 | Lifecycle-aware playback for voice messages and downloaded encrypted media. |

### Module boundaries

```text
Compose UI
   ↓ intents / immutable state
Application use cases
   ↓
Protocol domain ─── Device trust, conversations, proofs, calls, attachments
   ↓                         ↓
Native Vodozemac FFI     Android adapters
   ↓                         ├─ Room / encrypted files
Opaque account/session       ├─ Keystore / biometrics
handles                      ├─ HTTP / Socket.IO
                              ├─ WorkManager / notifications
                              └─ Camera / microphone / WebRTC
```

Recommended Gradle modules:

- `app`: Compose navigation, screens, and Android entry points.
- `domain`: platform-independent state machines and use cases.
- `protocol`: versioned DTOs, canonical encoders, envelope validation, and cross-platform fixtures.
- `crypto-vodozemac`: Rust/JNI or UniFFI boundary exposing opaque account/session handles.
- `data-local`: Room, encrypted file storage, transactional inbox/outbox, and migration code.
- `data-network`: REST, Socket.IO, proof carriers, and connectivity state.
- `feature-identity`, `feature-chat`, `feature-media`, `feature-calls`, `feature-settings`.

Dependencies point inward. UI and Android services may call domain interfaces; the domain layer must not import Android UI, database, transport, or WebRTC types.

## Existing system boundaries

The Android implementation must preserve these Phase 8 behaviors:

- Vodozemac account and Olm sessions remain the modern conversation cryptographic boundary. Account/session persistence completes before delivery acceptance.
- Control-event signatures use the existing Vodozemac Ed25519 identity. Private keys have no export API.
- Device proofs are short-lived, operation-scoped, resource-bound, and single-use.
- Relay join authenticates room control, routing ownership, device proof, lifecycle state, and conversation binding.
- Mailbox replay begins only after authenticated join and local crypto readiness. The relay deletes ciphertext only after explicit client acceptance.
- Attachment keys travel inside encrypted conversation messages. The backend stores encrypted chunks and encrypted metadata only.
- Call signaling uses the authenticated encrypted conversation channel. WebRTC provides DTLS-SRTP media protection.

Reference implementations include `service/src/crypto/modernConversation.ts`, `service/src/crypto/vodozemacRuntime.ts`, `service/src/devices/trustProtocol.ts`, `service/src/transports/socketIoRelayTransport.ts`, `service/src/media/workflow.ts`, and `service/src/calls/composition.ts`.

## Security architecture

### Android identity storage

The device creates its Vodozemac account locally. The Android crypto module exposes only the operations already present in the Rust boundary: create/load/save account, public identity, control-event signing, pre-key management, session creation, encrypt/decrypt, and encrypted session serialization.

The Vodozemac account and session pickles remain encrypted. A random 256-bit pickle key is generated with the platform CSPRNG and wrapped by a non-exportable Android Keystore key. Room stores only the encrypted pickle, wrapped key material, public fingerprints, version, and lifecycle metadata. Android Auto Backup must exclude the database key, encrypted identity records, session records, proof cache, and decrypted attachment cache so a copied app backup cannot silently clone a device identity.

The native boundary should be produced from the same Rust crate used by `crypto-wasm`, compiled for supported Android ABIs. JNI or UniFFI wrappers must retain opaque native handles and must not add private-key or raw-pickle-key accessors. Rust and Android buffers containing plaintext or key material should be short-lived and zeroized where the platform permits.

### Unlock and biometric policy

- First setup creates a Keystore wrapping key and encrypted local vault.
- Biometric unlock uses `BiometricPrompt` to authorize use of the wrapping key; biometric data is never available to K3NCRYPT.
- Device credential fallback is an explicit product policy. Enabling it changes the Keystore authentication flags, not the cryptographic identity.
- Background receive may store ciphertext while the vault is locked, but cannot decrypt messages, issue identity signatures, or show private previews.
- Biometric enrollment changes, lock-screen removal, Keystore invalidation, or hardware migration fail closed and enter recovery/re-enrollment UI. They must never create a replacement identity silently.

### Bootstrap, enrollment, and lifecycle

The Android flow mirrors the durable authority:

1. The first device creates its identity and signs a `BootstrapRequest`, then calls `POST /api/device-trust/bootstrap`.
2. A new secondary device creates an independent identity and displays an enrollment request/QR containing only public enrollment data.
3. An active trusted device obtains a `device-control` proof, signs the `EnrollmentEvent`, and calls `POST /api/device-trust/enrollment`.
4. The target verifies the account, target identity, expiry, nonce, and expected epoch before local confirmation.
5. The target signs its activation event and calls `POST /api/device-trust/activation`.
6. Revocation uses the signed lifecycle update and device-control proof at `POST /api/device-trust/update`.

Lifecycle state, epoch, commitment/high-water data, and processed event identifiers are committed atomically in Room. `revoked` is terminal outside the existing recovery-only path. A device blocked by missing or stale trust state cannot send, signal, upload, join private networks, or manage devices.

The current browser runtime exchanges trust refreshes through encrypted device-control messages. Android can use that existing path initially. Before wider beta, the project must decide whether mobile background recovery also needs an authenticated backend lifecycle-snapshot endpoint; no such read endpoint exists in the current device-trust router, so the client must not invent freshness from locally cached state or proof failures.

### Authorization proof handling

- Create and sign a fresh `DeviceProofRequest` immediately before each protected operation.
- Keep the returned `DeviceAuthorizationProof` in memory only.
- Validate operation, resource, nonce, epoch, and expiry in the response before attaching it.
- Never retry a consumed proof. A retry obtains and signs a new request with a new nonce.
- Bind messaging/signaling to `conversationId`, attachments to the conversation and operation, private-network admission to `networkId`, and bridges to `bridgeRouteId`.
- Serialize signed payloads with the exact Phase 8 field order and encoding. Kotlin and TypeScript must share golden canonical-byte and signature fixtures before interoperability is accepted.

## Messaging architecture

### Local data model

Room should maintain separate transactional records for:

- local account/device lifecycle and trust high-water state;
- contact identity pins and identity-change review state;
- conversations and routing identities;
- encrypted Vodozemac account/session state;
- messages, delivery state, and client-generated idempotency IDs;
- inbox replay/deduplication markers and outbox retries;
- encrypted attachment references and transfer state;
- sync checkpoints and imported record identifiers.

Message plaintext is decrypted only after unlock and retained according to the user’s local-storage policy. If message history is stored, it remains inside the encrypted database. Logs, crash reports, notification payloads, and WorkManager input must never contain plaintext, invitation secrets, control capabilities, proofs, routing proofs, private identifiers, or key material.

### Send flow

1. Validate current lifecycle/trust and contact identity state.
2. Persist an outbox record with a client idempotency ID.
3. Serialize and encrypt through the active Vodozemac session; atomically persist the advanced session state and encrypted outbox envelope.
4. Acquire a fresh `relay:message` proof bound to the conversation.
5. Send through Socket.IO and record the relay acknowledgement.
6. Retry with a new proof after reconnect while preserving the same encrypted envelope/idempotency identity.

### Receive and offline replay flow

1. Restore and unlock the Vodozemac account and conversation sessions.
2. Connect Socket.IO, acquire the conversation-bound proof, and complete `chat-join`.
3. Release initialization locks, then request `mailbox-replay`.
4. Validate the envelope, sender routing identity, pinned sender identity, lifecycle state, and replay status.
5. Establish/advance the Vodozemac session and decrypt.
6. In one local transaction, persist account/session changes, the message, and the inbox deduplication marker.
7. Update UI state, then send explicit acceptance. Failed validation or persistence returns rejection and leaves the server mailbox item retained.

The connection coordinator owns one state machine per account: `stopped`, `initializing`, `joining`, `replaying`, `online`, `backing-off`, and `blocked`. Network callbacks enqueue work into that coordinator; they do not mutate crypto or Room directly.

### Sync and reconnect

- Use Android connectivity callbacks only as hints; successful authenticated operations determine readiness.
- Use exponential backoff with jitter and bounded retry.
- WorkManager resumes encrypted outbox and attachment work when constraints allow.
- Preserve the Phase 8 sync epoch, commitment, authenticated transport, record validation, and atomic-import rules.
- Never merge conflicting trust or identity state by timestamp. Epoch/commitment checks decide acceptance.

### Push notifications

There is no production mobile push registration/delivery API in Phase 8. Phase 9.3 therefore requires a minimal push wake-up boundary before background messaging can be considered complete.

- FCM carries an opaque wake-up token and event class only; it carries no plaintext, message preview, attachment key, proof, invitation secret, or ciphertext required for decryption.
- The server may learn the push token, account/device reference, timing, and coarse event type. This metadata must be documented and minimized.
- On wake, the app restores trust/crypto readiness and performs authenticated mailbox replay.
- Notifications default to “K3NCRYPT — New message” or “K3NCRYPT — Incoming call.” Decrypted previews require an explicit local preference and an unlocked device.
- Push registration, rotation, revocation, and deletion require a current device proof and durable lifecycle checks.

## Media architecture

### Attachments and voice messages

- Use the existing AES-256-GCM chunk format, 12-byte nonces, attachment/chunk AAD, encrypted metadata, size limits, and attachment capability flow.
- Stream from Android content URIs into bounded chunks; do not copy whole large files into heap memory.
- Store temporary plaintext only in app-private cache, disable backup, and delete it on completion, cancellation, or failure. Prefer streaming encryption that avoids plaintext files entirely.
- Each create/write/read/delete HTTP operation obtains the matching short-lived proof and sends the existing conversation, participant, control-capability, routing-proof, request-id, proof, and nonce headers.
- Voice recording begins only from an explicit user action, owns microphone focus visibly, and releases the recorder on stop/cancel/background failure.

Phase 8 accepts voice messages only as `audio/webm;codecs=opus`. Android recorder/container support must be proven on the minimum supported API level. If native recording cannot produce that exact interoperable format, Phase 9.4 must add a reviewed, versioned media-format contract accepted by both browser and Android before enabling cross-platform voice messages; it must not mislabel AAC/OGG bytes as WebM Opus.

### Camera and media permissions

Use Activity Result permission contracts for microphone, camera, and notification permissions. Permission requests follow a user action and remain separate from device trust. Denial produces a usable voice-only/text path. Revocation or device removal stops active capture and releases camera/microphone resources.

### Calls and WebRTC

The Android call layer reuses the authenticated call session and signaling fields: call ID, conversation ID, verified participant identity, sequence, expiry, identity binding, payload digest, media mode, SDP, and ICE candidates.

- `org.webrtc.PeerConnection` implements SDP/ICE and DTLS-SRTP media.
- Existing encrypted signaling remains the only signaling transport; SDP and ICE are never sent through an unauthenticated side channel.
- STUN/TURN configuration is supplied by deployment configuration. TURN credentials should be short-lived and delivered through an authenticated configuration endpoint rather than compiled into the APK.
- `AudioManager` owns audio focus, mode, routing, Bluetooth, wired headset, and speaker selection.
- Camera2/WebRTC capturers own front/back camera switching and track lifecycle.
- An active call uses a user-visible foreground service and ongoing notification as required by Android. All tracks, capturers, audio focus, wake locks, listeners, and peer connections close on every terminal state.
- Background incoming calls require the push wake-up boundary. Android full-screen incoming-call UI and notification policy must follow platform restrictions and user settings.

The state machine remains `idle`, `inviting`, `ringing`, `accepted`, `connecting`, `connected`, `reconnecting`, and one terminal state (`ended`, `rejected`, `cancelled`, `expired`, or `failed`). Process death restores only durable call metadata for missed/ended UX; it does not resume stale media sessions.

## API compatibility

### Existing endpoints and transports to reuse

| Capability | Existing boundary |
| --- | --- |
| Account/device bootstrap | `POST /api/device-trust/bootstrap` |
| Secondary enrollment | `POST /api/device-trust/enrollment` |
| Activation | `POST /api/device-trust/activation` |
| Revocation/update | `POST /api/device-trust/update` |
| Short-lived proof | `POST /api/device-trust/proof` |
| Pre-key publish/fetch/claim | Existing `/api/chat-link` pre-key routes |
| Membership changes | `POST /api/network-membership/:operation` |
| Attachments | `/api/attachments/create`, chunk, complete, read, and delete routes |
| Messaging and signaling | Socket.IO `chat-join`, `mailbox-replay`, `chat-message`, and `webrtc-signal` events |
| Synchronization | Existing authenticated sync relay and sync record contracts |

### SDK work required

The TypeScript SDK remains the browser implementation. Android requires:

- language-neutral, versioned schemas for REST bodies, Socket.IO payloads, encrypted envelopes, lifecycle events, proof claims, call signals, sync frames, and attachment messages;
- canonical encoding specifications and golden vectors shared by Kotlin, TypeScript, Rust, and backend verification;
- a native Vodozemac build exposing the existing opaque operations without new key export;
- Kotlin ports of protocol state machines or a platform-neutral Rust core where behavior must be identical;
- explicit clock, randomness, storage, transport, and logging interfaces for deterministic tests;
- Android implementations of secure storage, Room persistence, REST, Socket.IO, WebRTC, capture, notifications, and background scheduling.

The following backend additions are required for a complete mobile product but are not present in Phase 8:

- authenticated FCM token registration/rotation/removal and opaque wake-up dispatch;
- an authenticated, privacy-minimal TURN credential/configuration endpoint if short-lived TURN credentials are used;
- a defined mobile lifecycle freshness/snapshot recovery path if encrypted peer-to-peer device-control refresh is insufficient while peers are offline.

These additions must use the existing device proof and lifecycle authority. They do not create a second identity or authorization system.

## Testing strategy

- Golden-vector tests compare canonical bytes, Ed25519 signatures, fingerprints, proof requests, envelopes, attachment AAD/ciphertext, and signal digests across TypeScript, Kotlin, Rust, and backend code.
- Native Rust tests cover account/session save/restore and first inbound pre-key messages across process restart.
- Room instrumentation tests cover atomic session-plus-message commits, rollback, migration, replay markers, and Keystore invalidation.
- MockWebServer tests cover strict REST schemas, proof expiry/retry, and fail-closed errors.
- Real backend/Socket.IO tests cover join, online delivery, offline replay, acceptance ordering, identity mismatch, revoked devices, and duplicate delivery.
- Android UI tests cover onboarding, biometric unlock, enrollment QR confirmation, permission denial, notification privacy, and process recreation.
- Two-device tests cover browser-to-Android and Android-to-Android messaging, attachments, lifecycle changes, sync, and calls across Wi-Fi/mobile network changes.

Security-sensitive compatibility tests are release gates. No adapter may normalize malformed input, silently regenerate identity/session state, reuse proofs, or acknowledge delivery before durable crypto/message persistence.

## Development phases

### Phase 9.1 — Android foundation

- Create the Kotlin/Compose modular project, Hilt graph, navigation, configuration, privacy-safe logging, and CI jobs.
- Implement Room/SQLCipher and Keystore-wrapped vault keys with backup exclusions.
- Define generated or hand-reviewed protocol DTOs and canonical cross-platform fixtures.
- Build the native Vodozemac Android artifact and pass account/session restart vectors.
- Establish minimum SDK, supported ABIs, dependency pinning, and reproducible release builds.

Exit criteria: a locked/unlocked local vault survives process restart; no identity key leaves the native boundary; protocol golden vectors pass.

### Phase 9.2 — Identity and enrollment

- Implement first-device bootstrap, secondary enrollment approval, target activation, device list, revocation, and trust refresh.
- Implement biometric UX and Keystore failure/recovery states.
- Implement fresh resource-bound proof acquisition with no persistent proof cache.
- Add browser-to-Android enrollment and revocation tests.

Exit criteria: a new Android device can enroll and activate, obtain a proof, and is blocked immediately after durable revocation.

### Phase 9.3 — Messaging

- Implement pre-key publication/claim, identity pinning, Vodozemac conversations, Socket.IO relay, inbox/outbox, mailbox replay, sync, and generic notifications.
- Add the authenticated push wake-up boundary.
- Verify online/offline first messages, restart, duplicate rejection, wrong identity, stale epoch, and failed persistence.

Exit criteria: browser↔Android and Android↔Android text delivery works online and offline with exactly-once UI insertion and persistence-before-acceptance.

### Phase 9.4 — Attachments

- Implement streaming attachment encryption/upload/download, image/video/file handling, voice recording/playback, cancellation, retry, and cleanup.
- Resolve and version the interoperable voice container/codec contract.
- Test proof/resource binding and revoked-device denial on every attachment operation.

Exit criteria: cross-platform encrypted media works without plaintext server storage or orphaned local plaintext.

### Phase 9.5 — Calls

- Port authenticated call lifecycle/signaling and connect native WebRTC.
- Implement voice/video UI, permission handling, audio focus, camera switching, foreground service, reconnect, TURN configuration, and cleanup.
- Validate browser↔Android and Android↔Android calls across network changes and TURN fallback.

Exit criteria: calls preserve verified signaling, deterministic terminal states, explicit capture, and complete resource cleanup.

### Phase 9.6 — Beta deployment

- Add signed release builds, Play Integrity policy if chosen, dependency/SBOM review, crash reporting with privacy controls, and staged distribution.
- Exercise database migrations, backup exclusions, server restore, push-token revocation, TURN operations, and incident procedures.
- Run device/API-level compatibility, battery, poor-network, background restriction, and accessibility testing.

Exit criteria: controlled Android beta with documented limitations, rollback procedures, privacy review, and cross-platform security regression results. This phase does not by itself establish production readiness.

## Decisions required before implementation

1. Minimum Android API level and supported hardware-backed Keystore policy.
2. JNI versus UniFFI packaging for the existing Rust Vodozemac boundary.
3. SQLCipher distribution and key-rotation policy.
4. Voice-message codec/container supported by both browser and Android.
5. FCM metadata policy and whether deployments may disable push entirely.
6. TURN credential service and self-hosted configuration contract.
7. Whether peer-delivered trust refresh is sufficient for mobile background operation or a proof-protected lifecycle snapshot endpoint is required.

These decisions refine adapters and deployment behavior. They must not alter the Phase 8 identity, lifecycle, proof, encryption, replay, or authorization models.
