# Phase 6 security closure implementation

Date: 2026-09-22. Baseline: `e9e36adba5f55a5920c1842541123813e30a533b`.

## Assessment

This is a targeted runtime hardening pass, **not complete Phase 6 security closure or a production-readiness claim**. It fixes concrete persistence, framing, trust enforcement, capture, and session-access defects. Account-wide enrollment, distributed freshness, and full synchronization admission/import remain incomplete. The earlier foundation reports must not be read as evidence that those product capabilities work end to end.

Reviewed inputs include the complete Phase 6 architecture, Phase 6B closure and final audit, Phase 6C architecture and production integration, and the locally supplied `PHASE6_CODEX_SECURITY_AUDIT_REPORT.md`. The supplied audit was already untracked and is not included in this implementation commit.

## Implemented changes and evidence

| Area | Runtime change | Evidence / qualification |
| --- | --- | --- |
| Identity addressing | Domain-separated SHA-256 record addresses for references incompatible with vault labels, including spaced display fingerprints; existing valid addresses retained. Persisted account namespace and stable device ID replace use of room routing IDs for new local lifecycle state. | Real encrypted-vault test stores and reloads `K3 ABC DEF`. Existing lifecycle scope/device binding is retained during migration. Fingerprints and wire identities are not silently changed. |
| Duplicate identity | Device lists reject duplicate public identity references even under different device IDs. | New adversarial duplicate-identity test. |
| Lifecycle apply | Enrollment/revocation require issued context, active author in current list, matching author identity/scope, epoch/commitment, version, nonce, and time window. | Tests reject absent/revoked authors with recomputed digests and a permissive injected verifier. Existing authorization tests continue to pass. |
| Target confirmation | Activation requires a persisted matching approval digest/nonce and the stored target key/algorithm. Remote contexts bind to the exact payload decrypted through the supplied session. | Structural contexts and modified decrypted payloads reject. Existing target confirmation, wrong-target, replay and lifecycle tests pass. This does not complete target-device bootstrap. |
| Trust freshness | Future/forked notifications suspend the enforcer and atomically persist a high-water fence. Missing lifecycle state with a retained high-water record cannot rebootstrap. Queued retries and incoming signaling check trust. Inbound calls check trust before handling signals. | Restart/suspension tests and queued-envelope regression. Device-control notifications also require a verified unchanged contact with active membership in the local account list. |
| Session facade | `getAuthenticatedSession()` no longer exposes the mutable ratchet adapter. Frozen facade encrypt/decrypt route through runtime mutex, write-ahead mutation marker, persistence, and quarantine on failure. Retained facade becomes unavailable after close. | Facade persistence-count test; interruption before marker deletion discards the unsafe session on restart. Existing crash tests and real Chromium messaging/restart test pass. |
| Durable lifecycle transaction | Encrypted lifecycle state, pending/revoked entries, authorization replay history, commitment history, and separate high-water record commit using one compare-and-swap operation. IndexedDB performs comparisons and writes in one readwrite transaction and waits for transaction completion. No sequential-write fallback. | Two real vault instances contend against the same persistence. Chromium cross-page IndexedDB race has exactly one winner and stale partial updates change neither record. A browser-discovered abort-event handling defect was corrected. |
| Device control codec | Send produces prefix + JSON bytes, not JSON of the whole prefixed string. Channel and proof decoder share bounded decoding with rejected unknown top-level fields. Fresh sessions initialize the channel after establishment. | Actual channel send/receive round trip and malformed-frame tests. Crypto replay rejection remains the existing session responsibility; the codec itself is not a replay store. |
| Sync frame admission | No public frame factory. Transport-decrypted frames are recorded in a private WeakMap and consumed once. Structural copies are rejected; package decoding validates purpose/sequence/checkpoint. Nested decoded state is frozen. | Fabricated-frame and repeated-frame tests; existing malformed/identity/expiry tests. Production composition checks verified peer membership and derives the expected session binding from room + live session ID. |
| Privacy | All direct browser capture goes through `BrowserCaptureController`. Pending cancellation stops late tracks; hidden documents release capture and cannot request it. Voice UI releases/discards on unmount/background/Escape/error; voice adapter releases on constructor/start/stop errors. Actual call peer configuration receives relay policy. | Capture denial/retry/cancel/background tests and relay-policy factory test. Source search finds direct `navigator.mediaDevices.getUserMedia` only in the controller. Component unmount cleanup is inspected, not separately browser-tested. |

## Runtime boundaries

```text
ModernConversation
  -> encrypted local account/device binding
  -> current lifecycle trust check
  -> runtime-owned CryptoSession facade
       -> mutex -> write-ahead marker -> existing ratchet -> persisted state
  -> authenticated control / call / sync adapters

Lifecycle mutation
  -> issued context + active author + scope/epoch/commitment + stored approval
  -> encrypted vault CAS
       -> lifecycle/pending/revoked state + replay history + high-water record
       -> one IndexedDB transaction

Explicit browser capture request
  -> foreground/cancellation controller -> browser media permission
  -> release on cancellation, background, failure or owner cleanup
```

The encrypted storage envelope and algorithms are unchanged. No changes were made to Vodozemac internals, `VodozemacCryptoSession` algorithms, mailbox encryption, attachment/media encryption formats, or call encryption. The runtime facade is an adapter around those existing primitives. No new keys, recovery authority, server trust authority, provider, dependency, analytics or remote asset was introduced.

## Remaining limitations and exact boundaries

1. **Identity correction is local, not complete account bootstrap.** The account namespace separates local account/device/routing fields. It does not transfer an existing account to a second device. Existing valid identifiers are preserved for compatibility; canonical addresses hash the existing public reference, not a redesigned identity fingerprint. Whole-vault deletion or rollback, including deletion of account binding and all high-water records, is not detectable using that same vault alone.
2. **Authenticated-context composition remains privileged.** The internal authority adapter assumes its injected CryptoSession and pinned peer identity came from trusted composition. WeakMap provenance blocks structural payload fabrication, not malicious code executing inside the application or a hostile dependency injector. Production ModernConversation derives its own local context; the complete target-side session/approval delivery and proof-of-possession ceremony is still missing. Incoming approval/revocation controls do not automatically mutate trust. Do not claim cross-device enrollment is closed.
3. **Freshness is not omniscience.** A received newer/forked event suspends durably; a server withholding all revocation notifications cannot be detected by this local mechanism. No distributed lease/acknowledgement freshness protocol was added. A suspended account needs authenticated reconciliation; no automatic un-fencing or recovery was invented.
4. **Transactions cover lifecycle state, not every subsystem.** Lifecycle/pending/revoked entries and its replay history/high-water are atomic. Sync checkpoints and sync replay state still use the existing separate `SyncPersistence` transaction contract. There is no joint lifecycle + sync checkpoint transaction or production distributed database adapter. Cross-device atomicity is not provided by IndexedDB.
5. **Session ownership remains bounded.** The facade fixes persistence bypass through `getAuthenticatedSession`. Existing single-owner conversation/tab constraints and account/session recovery marker design remain. This pass does not validate simultaneous independent runtimes sharing one account vault or add multi-process ratchet ownership. Incomplete mutations quarantine/discard the session rather than automatically recover delivery availability.
6. **Sync protocol completion remains open.** Authentic frame provenance is hardened, but existing caller-driven PREPARED/READY evidence, complete manifest/import validation, durable recovery semantics, conflict resolution, and application-level bootstrap are not proven complete. The sync session boundary requires the active same-account peer; an ordinary verified contact is not sufficient. Do not enable production multi-device synchronization based on these tests alone.
7. **Privacy limits remain.** The controller enforces foreground/cancellation and routes real browser requests, but cannot prove human intent against compromised application code. Background capture is stopped, not transparently resumed. OS/browser camera/microphone revocation behavior and React unmount timing need wider device/browser testing. Relay-only calls still require usable deployment TURN credentials.
8. **Unrelated audit areas remain open.** Recovery, group cryptography, mobile secure hardware adapters, and production infrastructure were not reimplemented. No broader Phase 6C closure is implied.

## Validation

- Full Jest: 74 suites / 366 tests passed; one Mongo integration suite / test skipped because `MONGO_URI` was not configured.
- Service TypeScript: `npx tsc --noEmit -p service/tsconfig.json` passed.
- Client TypeScript: `npx tsc --noEmit -p client/tsconfig.json` passed.
- ESLint: `npm run lint` passed.
- Client production build: `npm run client:build` passed.
- Full `npm audit --json`: zero reported vulnerabilities (production and development dependency tree).
- Chromium: cross-page IndexedDB CAS regression passed; modern messaging, offline delivery and both browser restarts passed. Test backend used explicitly reported volatile room storage, not Mongo.
- `git diff --check`: passed.
- Additional repo-wide `npx tsc --noEmit -p tsconfig.json` **failed**: root CommonJS/ES6 configuration also includes client/Vite files, stale SDK declarations, unresolved Vite/WASM aliases and unsupported `import.meta`/`replaceAll`. Separate service/client checks and client build pass; this root configuration problem was not hidden or fixed by weakening compiler checks.
- Initial sandboxed full Jest run could not open its HTTP test listener (`EPERM`); rerunning with local-server permission passed. No assertions or tests were skipped to obtain that result.
- Firefox/WebKit, real Mongo, physical microphone/camera, Rust and full cross-device enrollment were not validated in this pass. No clean-install claim is made.

## Changed files

- Identity: `service/src/identity/{machineIdentity,accountBinding}.ts`.
- Lifecycle: `service/src/devices/{authenticatedContext,deviceList,lifecycle,runtime,trust}.ts`; lifecycle/runtime tests and new `securityClosure.test.ts`.
- Persistence: `service/src/core/contracts.ts`, `service/src/storage/{persistence,secureVault}.ts`; `e2e/security-persistence.spec.ts`.
- Runtime/session: `service/src/crypto/{modernConversation,vodozemacRuntime}.ts` and their tests.
- Sync: `service/src/sync/{authenticatedTransport,runtime,transfer}.ts`, `sync.test.ts`.
- Privacy/calls: `service/src/privacy/capture.ts` and tests; `service/src/calls/{composition,media}.ts` and media tests; `service/src/voice/recorder.ts`; `service/src/webrtc/peer.ts`; `client/src/components/ChatContainer/ChatFooter.tsx`.
- This report.

## Release decision

The fixes materially strengthen runtime boundaries and are suitable for continued review. **Phase 6 remains not production-ready and not fully closed.** The open integration and deployment limitations above must remain visible; passing unit tests does not override them.
