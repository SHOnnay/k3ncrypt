# Connectivity characterization and acceptance matrix

## Phase 0 baseline coverage

| Area | Existing evidence to run | New characterization required | Record |
|---|---|---|---|
| Invitation, join, introduction | `inviteCrypto.test.ts`, `modernConversation.test.ts` join-introduction cases | Verify creator/joiner route and unverified state survive refresh | baseline pass/gap |
| Contact persistence/restore | modern conversation and contact registry suites | missing metadata restoration via authenticated receive | baseline pass/gap |
| First sessions | `modernConversation.test.ts` first-message tests | both initiation orders and simultaneous attempts | baseline pass/gap |
| Outbox/retry | modern conversation retry test | CP5/CP6 and restart with unchanged ciphertext | baseline pass/gap |
| Relay/mailbox/ACK | `listeners.test.ts`, `sync/relay.test.ts`, DB offline message tests | absent, live-accepted, live-declined, replay, lost ACK semantics | ACK table in current behavior |
| Receiver persistence | Modern conversation and Android inbound processor tests | CP1–CP4 with injected failures; classify known gaps | crash-consistency.md |
| Verification/lifecycle | contact registry, device lifecycle/trust suites | revocation on existing socket; evidence unavailable | pass/fail and logs |
| Calls | calls security/integration/negotiation suites | invite/end/remote end, relay forwarding ACK vs remote transition | baseline pass/gap |
| Replay window | current seen-set | exactly 1,024 and overflow/retry lifetime | retention risk |
| Unknown frames | TS and Kotlin decoders | enumerate current parse/reject/display behavior | transport-control ADR |
| Fixtures | current fixture consumers | new envelope/path fixture shape read by TS and Kotlin | fixture tests |

## Mixed-version matrix

| Sender | Receiver | Path | Phase 0 expectation |
|---|---|---|---|
| Current | Current | Relay | Existing behavior unchanged |
| Future | Current (no feature) | Relay | Never send control frame; normal messaging/calls continue |
| Current | Future | Relay | Future endpoint accepts existing envelope and relay ACK path |
| Future | Future, feature off | Relay | Relay-only behavior |
| Future | Future, feature on | LAN/direct | Only after feature/admission/receipt gates; Phase 0 does not implement |
| Any | Unknown version/control | Any | Characterize current parser; future rule is fail closed without changing session/trust |

## Real-device acceptance after later phases

Android-to-Android verified contact; no internet for LAN test; app cold start; same ciphertext via LAN and relay overlap; Wi-Fi client isolation; process death; revocation/freshness change; switch between networks; TURN and blocked UDP. Browser support is recorded separately. Emulator-only success is insufficient for LAN claims.

## Phase 0 execution record

- Clean `main` baseline: `3e26ce952ea539ef7aaa9bb5db3d5dea4bf30f7f`; ancestor check passed before branching.
- New tests: Web inbound consumer/seen failures, duplicate and 1,024-entry overflow; outbound CP5/CP6; relay live versus mailbox ACK; shared fixture vectors in TypeScript and shape checks in Kotlin; Kotlin unknown-frame rejection. The current unknown printable TypeScript control behavior is recorded as a gap.
- Existing suites (unchanged): invitation/join/intro, contact restore, first-message direction, retry/restart, verification/device trust, call lifecycle, and relay authorization. These provide baseline coverage; they do not establish real-device LAN/direct behavior.
- Validation: lint, client production build and service SDK build passed. Root Jest: 106 suites/510 tests passed, 3 suites/7 tests skipped. Service Jest: 73 suites/396 tests passed. Android `testDebugUnitTest` passed with `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- The default root Jest coverage collector reported a nonfatal TypeScript resolution error for `client/vite.config.ts`; this is a tooling/coverage warning, not a test failure. The final run uses `--coverage=false` to report test outcomes without that warning. The service suite emitted Jest's open-handle warning even though its tests passed.

### Unclosed Phase 0 acceptance items

The fake Web decryptor does not establish real Vodozemac ratchet recovery at CP1/CP2. Android crash-point fault injection and actual network ACK-loss/restart with a disposable database have not been performed. LAN/direct and mixed-version real-device trials are intentionally future-phase work. Security reviewer approval of the Phase 0 specifications is still required before implementation of Phase 1.
