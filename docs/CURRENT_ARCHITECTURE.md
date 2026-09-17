# Current Architecture

> Phase 1 update: the original audit snapshot below is retained for provenance. The implemented architecture now routes the conversation facade through `LegacyInviteCryptoSession -> EncryptedEnvelope -> DefaultTransportManager -> SocketIoRelayTransport`. Authenticated acceptance precedes delivery acknowledgement, replay handling uses a bounded out-of-order window, identifiers use platform CSPRNGs, runtime fonts are local/system, and ICE configuration defaults to no external servers. See `ARCHITECTURE.md`, `NETWORK_PRIVACY.md`, and `PHASE1_COMPLETION.md` for the current state.

Audit baseline: upstream `muke1908/chat-e2ee` commit `4f809ad` (2026-09-17).

The supplied workspace was an empty, unborn Git repository with no remote. The named public upstream was fetched as the only recoverable baseline. Any unpublished fork-only changes were therefore unavailable for this audit.

## Repository map

```text
.
├── app.ts                         Express application and static client serving
├── index.ts                       Process entry point; starts HTTP and Socket.IO
├── backend/
│   ├── api/chatHash/              Room creation, status, and deletion
│   ├── api/messaging/             Current room-presence query
│   ├── db/                        MongoDB or process-memory room records
│   ├── external/                  Dormant imgbb/imgur upload clients
│   ├── middleware/                Express async error wrapper
│   └── socket.io/                 Connected-client map, relay, and rate limiter
├── client/
│   ├── index.html                 Vite entry document and remote Google Font
│   └── src/
│       ├── components/            Setup, chat, and call UI
│       ├── context/ChatContext.tsx Application state and SDK orchestration
│       ├── hooks/                 URL fragment, audio, and timer hooks
│       └── utils/                 Invite parsing and message helpers
├── service/
│   └── src/
│       ├── api/                   Browser fetch wrapper
│       ├── crypto/                Invite KDF and encryption strategies
│       ├── socket/                Socket.IO client adapter
│       ├── webrtc/                Audio call and signaling state
│       ├── sdk.ts                 Main application/conversation façade
│       └── public/types.ts        Consumer-facing types
├── e2e/                           Playwright two-browser tests
├── native/                        Obsolete Nativefier desktop wrapper scripts
└── .github/workflows/             Build, package, and Docker workflows
```

There is no Android, iOS, Capacitor, React Native, Tauri, Electron project, service worker, application database, attachment store, or persistent client identity implementation.

## Runtime components

### Client

The client is React 18 + TypeScript + Vite. `ChatContext.tsx` is the application layer. It creates one `ChatE2EE` SDK instance, creates or parses an invitation, generates a transient `userId`, joins a room, keeps plaintext messages in React memory, and drives WebRTC call state. A reload loses messages, identity, verification state, and session state.

Messages render through ordinary React text nodes; no `dangerouslySetInnerHTML`, `eval`, or `new Function` usage was found. No content-security policy is configured. The HTML automatically contacts Google Fonts.

### SDK/conversation layer

`service/src/sdk.ts` is currently a large façade containing conversation state, invite-derived crypto initialization, message serialization, replay tracking, Socket.IO construction, presence subscriptions, call control, and WebRTC signaling orchestration.

The SDK owns two independent encryption strategy instances: one for chat and one for signaling. This is useful domain separation, but it is not a ratcheted cryptographic session and has no durable state.

### Backend

Express exposes:

- `POST /api/chat-link`: create a random UUID room record;
- `GET /api/chat-link/status/:channel`: check room state;
- `DELETE /api/chat-link/:channel`: mark a room deleted;
- `GET /api/chat/get-users-in-channel?channel=...`: return current transient user IDs.

Socket.IO accepts `chat-join`, `chat-message`, `webrtc-signal`, and `received`. It keeps a process-memory map from room ID to user ID to socket ID and relays opaque envelopes to the other connected participant. Joining and REST control operations require a separate 256-bit bearer capability whose SHA-256 verifier is stored with the room. Token-bucket limits and strict envelope/size checks are present. There is no user account, offline queue, TTL, mailbox rotation, durable delivery record, or multi-instance coordination.

Room records use MongoDB when `MONGO_URI` exists, otherwise an in-process object. Records contain the room UUID, capability verifier, and `expired`/`deleted` flags. Messages are not stored by the current server.

## Invitation and key flow

1. The creator generates independent 32-byte invitation and room-control secrets.
2. The creator calls `POST /api/chat-link` with only the SHA-256 control verifier.
3. The server generates/stores a UUID room ID and verifier. It returns no raw key material.
4. The client puts all invitation values in `#room=...&secret=...&control=...`.
5. The whole invitation is copied out of band. URL fragments are not included in normal HTTP requests, but they remain visible to browser history, clipboard managers, screenshots, extensions, and anyone receiving the link.
6. Both clients derive two 256-bit values with HKDF-SHA-256 using a fixed protocol salt and distinct chat/signaling `info` labels.
7. Each derived value is imported directly as a non-extractable browser AES-256-GCM key.
8. Room ID, transient routing ID, and the independent control bearer are sent in `chat-join`; the message secret is not.

The isolated vodozemac prototype now has persistent identities, pre-key session tests, fingerprints, and identity-change detection, but production conversations still use the legacy invite session. Production still lacks an authenticated pre-key directory, verification UI, forward secrecy, and post-compromise recovery. The separate control capability is authorization for the disposable room.

## Message flow

1. The UI immediately appends the outgoing plaintext to React state.
2. The SDK creates `{ seq, timestamp, text, image }` and JSON-encodes it.
3. The chat strategy generates a random 96-bit IV and encrypts with AES-256-GCM. A constant strategy/version string is authenticated as AAD.
4. The client sends `{ envelope }` over Socket.IO.
5. The server binds sender and room to the joined socket, adds a `Date.now()` ID/timestamp, and relays the opaque envelope.
6. The receiver authenticates/decrypts, validates the protocol payload, and applies replay protection.
7. The SDK publishes accepted plaintext and only then authorizes the Socket.IO delivery acknowledgement.

Consequences:

- malformed, unauthentic, invalid, or replayed data is dropped without a successful acknowledgement;
- valid out-of-order messages inside the 1,024-position window are accepted;
- counters restart at one on a client restart or room rejoin;
- a static room key protects every message, so compromise reveals all captured room ciphertext and enables future decryption until the room changes;
- exact plaintext/ciphertext sizes are not padded;
- server delivery IDs are random UUIDs while timestamps remain visible routing metadata.

## WebRTC signaling and media flow

Call invites, accept/reject/cancel/end controls, SDP offers/answers, and ICE candidates are JSON-encoded and encrypted with the separate invite-derived signaling key. The server sees only envelope framing and traffic metadata.

`Peer` constructs `RTCPeerConnection` from explicit runtime configuration. The default ICE server list is empty; operators can provide STUN/TURN and choose `iceTransportPolicy: "relay"`. It requests microphone access only when a call is created and requests audio only. Media is protected by standards-mandated WebRTC DTLS-SRTP. Signaling confidentiality does not conceal peer IP information exchanged after decryption unless relay-only calling is configured appropriately.

## Storage inventory

| Data | Current location | Class | At-rest protection |
|---|---|---:|---|
| Invitation secret and AES keys | URL fragment + JavaScript/Web Crypto memory | SECRET | None in history/clipboard; keys are non-extractable in memory |
| Plaintext messages | React memory | SENSITIVE | None; lost on reload |
| SDP/ICE after decryption | JavaScript/WebRTC memory | SENSITIVE | None |
| Room/user/socket mapping | Relay process memory | SENSITIVE metadata | None |
| Room UUID and state | MongoDB or relay process memory | SENSITIVE metadata | Database/operator dependent |
| Logs and browser console | Client/server console | SENSITIVE metadata | None |
| Prototype identity keys, Olm state, contacts | Encrypted IndexedDB records | SECRET/SENSITIVE | Until explicit deletion; UI integration pending |
| Attachments, thumbnails, voice notes | Not implemented in active UI/path | SENSITIVE | Not applicable |

No secret writes to `localStorage`, `sessionStorage`, cookies, or cache storage are present. Phase 2 adds an encrypted IndexedDB adapter behind `SecureStorage`; public preferences use a separate plaintext IndexedDB database. The live production conversation path does not yet persist conversations automatically.

## Server-visible metadata

The relay can observe client IP and connection timing, Socket.IO/socket identifiers, room UUID, transient user UUID, online pairing and room occupancy, event type (chat versus call signaling), envelope size, send order/timing, delivery acknowledgments, room creation/status/deletion requests, and any MongoDB connection metadata. It cannot decrypt a correctly formed AES-GCM envelope without the invitation secret. It can drop, delay, reorder, duplicate, correlate, or selectively relay traffic.

## External network behavior

Runtime application requests are:

- configured relay origin: REST and Socket.IO;
- operator-configured STUN/TURN endpoints only, when calling is explicitly configured;
- configured MongoDB endpoint from the server when enabled.

The source also contains imgbb and imgur upload clients, but no active route imports or calls them. They remain a dangerous dormant path because they upload plaintext base64 image data to third parties if wired back in. Documentation pages embed remote badges/images; those are not production-app runtime requests.

## Native status and permissions

`native/` contains only a Nativefier desktop-web-wrapper recipe that downloads a remote website. It is obsolete and is not Android work. There is no `AndroidManifest.xml`, Gradle project, Android Keystore, Photo Picker, Storage Access Framework, notification configuration, backup rule, recents protection, screenshot policy, NSD, or mobile permission declaration.

Repository-wide searches found no biometric APIs/permissions, fingerprint/Face ID/Touch ID code, contact/SMS/call-log/media/location permissions, analytics SDK, crash reporter, advertising SDK, or tracker dependency.

## Build and test baseline

- Node `22.23.1`, npm `10.9.8`.
- `npm ci`: succeeds; npm reports 22 advisories (4 low, 6 moderate, 11 high, 1 critical).
- `npm test -- --runInBand --silent`: 16 suites and 170 tests pass.
- `npm test --workspace=service -- --runInBand --silent`: 12 suites and 152 tests pass.
- `npm run build`: succeeds.
- `npm run build-service-sdk`: succeeds.
- Playwright: 1 of 4 tests passes; 3 fail on the untouched baseline. Two time out because a disabled `#join-btn` is selected and one fails to extract a room ID from the copied invitation.
