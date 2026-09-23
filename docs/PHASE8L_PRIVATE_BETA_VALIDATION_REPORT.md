# Phase 8L Private Beta Validation Report

Date: 2026-09-23

## Environment

- macOS local development workspace.
- Node.js 22.23.1, npm workspaces, Vite 8.3.0.
- Chromium browser UI inspection at `http://localhost:5173/`.
- The local backend reported unavailable MongoDB and selected volatile in-memory room storage.
- No real peer device, separate Wi-Fi/mobile-hotspot network, TURN service, camera/microphone permission grant, Android device, or native mobile build was available for this run.

## Tests performed

| Area | Result | Evidence |
| --- | --- | --- |
| Lint | Passed | `npm run lint` |
| Client build | Passed | `npm run client:build` |
| Service SDK build | Passed | `npm run build-service-sdk` |
| Dependency audit | Passed | `npm audit --audit-level=high`: 0 vulnerabilities |
| Focused security/call/voice/product tests | Passed with Mongo skips | 21 suites passed, 78 tests passed; 1 suite and 3 Mongo-dependent tests skipped |
| Full Jest suite | Failed | 93 suites passed, 3 failed; 426 tests passed, 3 failed, 4 skipped |
| Browser E2E | Failed and interrupted | Same-machine invite join passed; two Chromium failures were recorded before the runner remained active beyond expected time and was stopped |
| Manual new-user startup/onboarding | Blocked | App loaded, but invitation creation showed “Failed to generate invitation” because the development command's backend could not bind port 3001 and the existing listener returned 404 |

## Confirmed working coverage

- The application shell, initial onboarding screen, modern private-contact entry point, settings entry point, and invitation UI render in Chromium.
- Existing same-machine browser E2E coverage passed for two-user invite-link joining, retry-after-back navigation, bare-room rejection, Vodozemac browser initialization, and IndexedDB compare-and-swap persistence.
- Focused automated coverage passed for voice-message encryption workflow, browser capture release semantics, call negotiation and permission-denial behavior, WebRTC signaling/replay handling, call media cleanup primitives, attachment authorization, device-trust checks, and production configuration validation.
- Browser UI inspection showed no application console warnings or errors; the only observed console entry was React's development-tools notice.

## Findings

### High — New-user invitation creation can fail when the backend endpoint is unavailable or a stale listener occupies the port

The manual onboarding flow at `client/src/components/SetupOverlay/CreateHashView.tsx` displayed “Failed to generate invitation. Please try again.” The development backend started by `npm run dev` crashed with `EADDRINUSE` on port 3001. The listener already on that port returned HTTP 404 for the requested API paths. This leaves the UI with a disabled “Continue to conversation” action and no recovery guidance beyond retrying.

Impact: a new beta user cannot start a conversation in this runtime condition.

Validation scope: this demonstrates missing startup/readiness and user-facing recovery behavior in a realistic local beta setup. It does not establish that a correctly configured backend fails invitation creation.

### High — Same-machine end-to-end message delivery is not reliable in the browser suite

`e2e/join-session.spec.ts` failed in the two-user message exchange scenario. The receiving-message assertion timed out even though the sender-side view retained the attempted text and presented a Retry action.

Impact: private-beta participants may not receive messages reliably after joining a conversation.

Relevant location: `e2e/join-session.spec.ts:129` and the legacy messaging/relay path exercised by that test.

### High — Modern conversation creation and restore scenario fails in browser E2E

`e2e/modern-conversation.spec.ts` failed before it could locate the generated modern invitation. The visible UI reported it could not create a private contact despite the test's valid-length passphrase.

Impact: modern onboarding/session restoration, which is the product's durable local-identity path, is not ready to be relied on for beta until reproduced and corrected.

Relevant location: `e2e/modern-conversation.spec.ts:33`.

### High — Cross-network call readiness is unverified and the default deployment has no ICE servers

`.env.production.sample` sets `CHATE2EE_ICE_SERVERS=[]`. The code supports STUN/TURN configuration, but no real TURN service or different-network call was tested.

Impact: calls can fail for NAT-restricted users. This blocks a geographically distributed private beta with calling enabled.

Relevant locations: `.env.production.sample`, `client/src/config/runtimeConfig.ts`, and `docs/CALL_DEPLOYMENT_GUIDE.md`.

### Medium — Full Jest validation is not green because proof-carrier interfaces changed without matching test expectations

`service/src/socket/socket.test.ts` expects proof acquisition with one argument, while the implementation calls it with an additional optional resource argument. `service/src/transports/transportManager.test.ts` similarly expects a two-argument transport call while the implementation delegates optional proof arguments.

Impact: the failing assertions obscure regressions in protected transport behavior and prevent a clean beta validation signal.

Relevant locations: `service/src/socket/socket.test.ts:176` and `service/src/transports/transportManager.test.ts:24`.

### Medium — Sync-relay integration test times out

`backend/sync/relay.test.ts` exceeded its test timeout while validating bounded opaque sync envelope forwarding.

Impact: multi-device synchronization reliability is not demonstrated under the suite's real relay conditions.

Relevant location: `backend/sync/relay.test.ts:42`.

### Medium — Browser coverage is incomplete

The Playwright configuration targets Chromium, Firefox, and WebKit, but the full run was stopped after it remained active beyond expected timeout following failures. Manual Safari, Firefox, camera/microphone, notification, and storage validation was not completed.

Impact: compatibility and permission behavior across the intended browsers remain unverified.

### Low — Test process leaves asynchronous work alive

Both targeted and full Jest runs report that Jest did not exit promptly because asynchronous operations remained active.

Impact: this complicates CI diagnostics and can conceal leaked sockets, intervals, or media-related handles.

## Not performed

- Real two-browser voice/video calls, permission prompts, mute/camera interaction, call teardown, reconnect, or ICE restart.
- Same-Wi-Fi, hotspot, offline, network-switch, and poor-network tests.
- TURN fallback timing or relay-only operation.
- Real Mongo-backed validation for skipped tests.
- Android, native-mobile, or native camera/audio testing.

## Assessment

K3NCRYPT has meaningful automated coverage for security boundaries and browser media primitives, but the current beta validation has user-facing blockers in onboarding, same-machine message delivery, modern conversation setup, and cross-network calling readiness. These issues should be resolved and the full Jest and browser E2E suites rerun before Android beta development or deployment decisions. This report does not claim production readiness.
