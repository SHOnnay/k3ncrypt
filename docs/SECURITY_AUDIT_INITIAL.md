# Initial Security and Privacy Audit

> Remediation status (2026-09-17): H-01, H-02, H-03, H-04, H-06, H-07, M-01, M-02, L-01, and the reported browser-test regressions were addressed in Phase 1. Full and production-only npm audits now report zero known advisories. A-01, A-02, A-03, H-05, M-03 through M-09, L-02, and the broader native/CI work remain open. Details are in `PHASE1_COMPLETION.md` and `DEPENDENCY_SECURITY.md`.

Audit date: 2026-09-17. Baseline and provenance are recorded in `CURRENT_ARCHITECTURE.md`.

## Executive finding

The current project is a disposable, two-browser shared-secret chat, not yet a durable privacy-first messenger. It has improved over a typical demo: the invite secret is generated client-side, messages and signaling use separate AES-GCM keys, the relay is payload-opaque, malformed ciphertext has no plaintext fallback, and the socket relay applies size/rate limits. Those properties should be preserved behind compatibility adapters.

It nevertheless lacks the security properties required by the product brief: cryptographic user identity, authenticated pairing, a reviewed ratchet, forward secrecy, post-compromise recovery, encrypted durable storage, safe recovery, safety numbers, attachment encryption, private notifications, Android hardening, offline queues, and transport independence.

## Findings

### Critical architecture gaps

**A-01 — No messaging identity or authenticated peer binding.** The transient user UUID is only a relay routing label. Anyone possessing the invitation can join before the legitimate peer. There is no identity key, safety number, verification state, or identity-change warning.

**A-02 — Static shared room keys, no ratchet.** HKDF produces one chat key and one signaling key for the room. There is no forward secrecy or post-compromise recovery. This mechanism must remain explicitly `legacy` and must not be extended into a custom ratchet.

**A-03 — No secure durable storage.** There is no database master key, Argon2id unlock flow, encrypted database, secure identity/ratchet persistence, app lock, auto-lock, recovery package, or failed-attempt delay. Reloading destroys state; URL/history/clipboard may retain the invite secret.

**A-04 — SDK couples crypto, application state, relay, and calls.** `service/src/sdk.ts` directly constructs Socket.IO, derives secrets, owns cipher instances and replay state, and drives WebRTC. A transport switch cannot happen independently of the cryptographic session.

### High findings

**H-01 — Delivery is acknowledged before authentication.** `SocketInstance` invokes an async raw-message handler without awaiting it, then calls `markDelivered` immediately. Tampered or wrong-key envelopes can be acknowledged as delivered even though they are later dropped.

**H-02 — Legitimate out-of-order messages are treated as replays.** `ReplayGuard` remembers only the greatest sequence number and rejects every lower sequence. This violates the required out-of-order behavior and will lose valid messages during network reordering. Counters also reset after restart because they are not persisted.

**H-03 — Client UUIDs are generated with `Math.random`.** `service/src/utils/uuid.ts` is used for relay user IDs and call IDs. These identifiers are not cryptographically unpredictable. Server room IDs use the `uuid` package and are materially stronger.

**H-04 — Automatic third-party traffic.** The client loads Google Fonts at startup. Audio calls use public Google STUN by default. This discloses IP/timing metadata and violates the no-runtime-third-party-font requirement. Strict local-only mode is impossible in the current build.

**H-05 — Public CORS and unauthenticated room APIs.** Express and Socket.IO allow every origin. Anyone who learns a room UUID can query presence/state, attempt a join, or delete the room. The shared secret is not used to authorize destructive server operations.

**H-06 — Known production dependency advisories.** `npm audit --omit=dev` reports nine vulnerabilities: 1 low, 4 moderate, and 4 high. High paths include Engine.IO/`ws` resource exhaustion, Socket.IO parser memory exhaustion, and direct `form-data` CRLF injection. The direct `uuid` version also has a moderate advisory. Update decisions require compatibility testing; no blind `npm audit fix --force` was run.

**H-07 — Dormant plaintext image upload integrations.** `backend/external/imgbb.ts` and `imgur.ts` submit base64 plaintext media to third parties. They are currently unreachable, but retaining them makes accidental reintroduction easy and conflicts with the attachment privacy design.

### Medium findings

**M-01 — Excess metadata and logs.** Default SDK logging is enabled. `setChannel` and `joinChat` log room and transient user IDs. Server error paths log channel IDs. Production logging is not centrally gated or redacted.

**M-02 — Predictable public message IDs.** The server uses `Date.now()` for both ID and timestamp. IDs collide under same-millisecond sends and reveal precise timing. They are not random protocol identifiers.

**M-03 — Relay can replay/reorder/drop and has no durable replay defense.** Client-only sequence state is volatile. The server has no opaque message ID validation, TTL, acknowledgment state, or offline queue.

**M-04 — No CSP or explicit security headers.** React escapes current text rendering, but the frontend has no strict CSP. Express lacks a systematic header policy. Remote font directives would currently require broad external allowances.

**M-05 — Global mutable SDK configuration.** `setConfig` shallow-merges global state, while loggers cache the setting at construction. Multiple SDK instances can affect one another and nested settings can be lost.

**M-06 — Error handling leaks operational details in development and is noisy in production paths.** Missing Mongo configuration logs an exception and falls back silently to unreliable memory storage. No structured redaction policy exists.

**M-07 — Room records do not expire.** The `expired` field is created but no TTL or expiration process was found. Deleted records remain as metadata.

**M-08 — No message padding.** Ciphertext length reveals close approximations of plaintext and signaling sizes.

**M-09 — Call privacy controls are absent.** No private TURN configuration, TURN-only mode, or user-facing direct-IP warning exists. WebRTC media is standards-encrypted, but peer/network metadata remains exposed.

### Low and correctness findings

**L-01 — License metadata conflicts.** The repository `LICENSE` is Apache-2.0, but root and service package manifests declare ISC; the client declares no license. Release artifacts therefore communicate inconsistent licensing.

**L-02 — Disabled plaintext encryption strategy is public API.** It is explicit and not a fallback, which is good, but a production configuration mistake can still select it. Production builds need a guard or separate test-only entry point.

**L-03 — No lint script despite ESLint dependencies.** CI runs install, build, and tests, but no lint/security/secret/SBOM workflow. Actions are inconsistently pinned: Docker actions are commit-pinned, while build/publish workflows use moving major tags.

**L-04 — E2E baseline is unreliable.** Three Playwright scenarios fail. This weakens confidence in compatibility-preserving refactors.

**L-05 — Claimed wording is too strong.** UI text says “zero knowledge” and documentation makes broad claims that do not account for traffic metadata, malicious relay behavior, copied invitations, browser compromise, or STUN exposure.

## Privacy weaknesses

- Stable room UUIDs allow relay-side correlation for the room lifetime.
- Transient user UUIDs, IP addresses, timing, event type, size, presence, and delivery metadata are visible to the relay.
- The invitation secret can persist in address bars, browser history/sync, clipboard history, screenshots, crash snapshots, and extensions.
- Google Fonts is contacted on every initial page load; Google STUN is contacted for calls.
- No notification privacy, recent-app protection, screenshot policy, cloud-backup policy, or link-preview policy is implemented because no mobile client exists.
- No encrypted attachment/cache/temp-file design exists.
- Broad CORS allows arbitrary websites to interact with the service endpoints from browsers.

## Dependency and license inventory

Production direct dependencies and installed versions:

| Dependency | Purpose | Installed | License |
|---|---|---:|---|
| `cors` | Express CORS middleware | 2.8.5 | MIT |
| `cross-env` | script environment portability (misclassified as production) | 7.0.3 | MIT |
| `dotenv` | server configuration | 16.4.5 | BSD-2-Clause |
| `express` | REST/static server | 4.22.1 | MIT |
| `form-data` | dormant image-upload client | 4.0.5 | MIT |
| `mongodb` | optional room-record database | 6.9.0 | Apache-2.0 |
| `node-fetch` | dormant image-upload client | 2.7.0 | MIT |
| `socket.io` | relay transport | 4.8.0 | MIT |
| `uuid` | server room IDs | 10.0.0 | MIT |
| `socket.io-client` | browser relay client | 4.8.3 | MIT |
| `react` / `react-dom` | UI | 18.3.1 | MIT |

Security-relevant build/test dependencies include TypeScript (Apache-2.0), Playwright (Apache-2.0), Vite/esbuild (MIT), Jest (MIT), and ESLint (MIT). The dependency tree totals 787 packages after workspace installation, including optional packages. `esbuild` executes native code. Browser tooling and package installation can make network requests; runtime React and Socket.IO code make only the requests mapped in `CURRENT_ARCHITECTURE.md`.

Full audit on 2026-09-17: 22 total advisories (4 low, 6 moderate, 11 high, 1 critical). The critical `shell-quote` path is development-only through `concurrently`. Production-only audit: 9 total (1 low, 4 moderate, 4 high, 0 critical). Advisory results are time-sensitive and must be regenerated in CI.

## Biometric, permissions, analytics, and tracking audit

No matches were found for Android `BiometricPrompt`, `BiometricManager`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, fingerprint, Face ID, or Touch ID. No Android manifest exists, so there are no Android permissions to audit yet.

No Firebase, Crashlytics, analytics, telemetry, Sentry, advertising, behavioral tracking, contact upload, phone/email/social-login, or public-user-directory implementation was found. Remote Google Font and STUN traffic are privacy-relevant third-party network dependencies even though they are not analytics SDKs.

## Threat snapshot

The current system can partially resist a passive network observer reading message/signaling plaintext when TLS and AES-GCM operate correctly. It can also detect ciphertext/AAD modification at the receiving client.

It cannot protect against a compromised endpoint/browser/OS, malicious extensions, a stolen unlocked device, invitation theft, a malicious contact, traffic analysis, denial/deletion by a relay that knows a room ID, peer IP disclosure during direct calls, dependency compromise, or historical decryption after the static room secret is compromised. A malicious relay can drop, delay, duplicate, reorder, and correlate all traffic. There is no recovery from identity compromise because there is no identity yet.

## Exact files to change first

1. `service/src/sdk.ts`: reduce façade ownership and inject crypto/transport boundaries.
2. `service/src/crypto/*`: label current design as legacy and adapt it behind `CryptoSession`; do not extend it into a ratchet.
3. `service/src/socket/socket.ts`: implement the transport contract and acknowledge only after authenticated acceptance.
4. `service/src/utils/uuid.ts`: replace `Math.random` IDs with a CSPRNG-backed implementation.
5. `client/src/context/ChatContext.tsx`: separate conversation state from transient routing identity and later from persistent messaging identity.
6. `client/index.html` and local CSS/assets: remove runtime Google Fonts.
7. `service/src/webrtc/peer.ts`: inject ICE/privacy policy instead of hard-coding Google STUN.
8. `backend/socket.io/listeners.ts`: random IDs, authorization design, metadata-minimized logging, strict validation, and durable opaque queue boundary.
9. `app.ts`: origin policy and security headers.
10. `backend/external/*`, `form-data`, and `node-fetch`: remove dormant plaintext upload path after compatibility review.
11. `package*.json` and lockfiles: resolve advisories and license metadata deliberately.
12. `.github/workflows/*`: `npm ci`, lint, production audit, CodeQL/secret scan/SBOM, and pinned actions.

## Proposed directory evolution

```text
service/src/
├── application/              conversation/use-case orchestration
├── core/
│   ├── crypto/               CryptoSession and envelope contracts
│   ├── identity/             IdentityManager contract (no server account)
│   ├── storage/              SecureStorage and AttachmentStore contracts
│   └── transport/            Transport and TransportManager contracts
├── legacy/
│   └── invite-session/       compatibility HKDF + AES-GCM adapter
├── transports/
│   └── socket-io/            present relay adapter
└── webrtc/                   media engine; signaling supplied by application layer

client/src/
├── application/              React-facing use cases and state
├── screens/                  UI composition
└── platform/                 web/native capability adapters

backend/
├── relay/                    opaque mailbox/queue service
├── persistence/              TTL queue and routing records
└── http/                     small REST/health surface
```

Keep migrations incremental. Do not move files merely for aesthetics; introduce a boundary, test it, then move its implementation.

## Migration risks

- Accidentally changing the legacy envelope or invite derivation breaks all existing two-party sessions.
- Treating room/user IDs as identities would bake relay metadata into the identity model.
- Persisting current static AES keys or counters as if they were ratchet state would create unsafe migration debt.
- A transport abstraction that still exposes Socket.IO events upward is cosmetic and will not enable LAN/failover.
- A storage abstraction implemented with plaintext browser storage would give false confidence.
- Multiple active transports can duplicate/reorder envelopes; replay design must tolerate reordering and survive restart.
- Migrating to a ratchet changes session establishment, serialization, backup, multi-device, and lost-message behavior; it must be prototyped separately with library-owned state.
- Identity recovery must not restore stale ratchet state by default.
- Removing STUN without a replacement can break calls; private TURN/direct privacy modes need explicit configuration and UX.
- Dependency “fixes” involving major versions can change network/protocol behavior and require focused regression tests.

## Prioritized Phase 1 plan

1. Define transport-independent envelope, crypto-session, identity, secure-storage, attachment-store, transport, and transport-manager contracts. Document unavailable guarantees explicitly.
2. Put the existing invite HKDF/AES-GCM behavior behind a `LegacyInviteCryptoSession` adapter with byte-for-byte compatible envelopes and lifecycle tests.
3. Adapt Socket.IO behind `Transport`; make receive acceptance asynchronous so acknowledgments follow successful authenticated processing.
4. Replace non-cryptographic UUID generation and predictable public message IDs with CSPRNG-backed random identifiers.
5. Extract conversation orchestration from `sdk.ts`; inject `CryptoSession`, `IdentityManager`, `TransportManager`, and storage ports.
6. Add a volatile storage adapter only for current behavior. Do not call it secure and do not introduce plaintext persistence.
7. Remove automatic Google Font loading and make ICE servers/privacy policy injected configuration.
8. Repair E2E tests and add transport-disconnect/reconnect and out-of-order scenarios before changing the cryptographic protocol.
9. Add CI lint, production audit, secret scanning, CodeQL, SBOM, and license checks.
10. Only after these boundaries and tests are stable, begin the separately reviewed vodozemac prototype described in Phase 3.
