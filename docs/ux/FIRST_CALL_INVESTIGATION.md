# First video call: "Call media could not start" (Part A2 bug 6, 2026-11-04)

Owner report: on production (`e99f6aae`), the first video call failed with "Call media could not start / Call media is unavailable. Check the microphone and camera"; the second call worked.

## What the message tells us

The UI text comes from `callSetupFailure` in `ChatContext.tsx`. "Check the microphone and camera" is its generic branch: the underlying error mentions media, capture or device, but not permission, camera or microphone. [read code]

- Capture errors (`getUserMedia`) never reach that branch: `captureFailureMessage` always produces a message that names permission, camera or microphone. So a denied or failed `getUserMedia` is **not** the cause. [read code]
- Errors that do reach it: "Call media cannot start before the required call state." (call no longer ringing/accepted when media is prepared), "Call media is not prepared." (offer started with no peer connection), "Authenticated call media is not ready." (callee accepted before call support was installed), "Call device trust rejected.". [read code]

## What was tried (none reproduced) [two-browser E2E]

`e2e/first-call-permission-delay.spec.ts` (opt-in, `FIRST_CALL_DIAG=true`), fake camera, test diagnostics on:

| Scenario | Runs | Result |
|---|---|---|
| First `getUserMedia` delayed 5 s (stands in for the permission prompt), caller and callee | 1 each | connected |
| Same, 15 s and 35 s | 1 each | connected |
| First call right after reload and unlock, no message sent first: both, caller only, callee only | 3 each | connected |

So a slow first permission prompt and a cold call-support install after unlock are both handled.

## Change made

Every call setup failure now records a fixed code and stage (`client/src/calls/callFailureCode.ts`): logged as `[K3NCRYPT] call_setup_failed` and shown under Settings → Advanced → "Last call problem". No message text or device detail is kept.

## Next step

When it happens again, open Settings → Advanced and note the code (for example `CALL_STATE_NOT_READY` at caller prepare). That names the path; the fix then goes into the Calls milestone together with the intermittent "Ringing…" first-call issue. No larger change until then.

Remaining suspects not covered locally: real Brave permission UI (page loses focus while the prompt is open), a real camera that takes seconds to start, and production latency between "accepted" and the offer.

## Calls milestone changes (2026-11-04, branch `calls/reliability`)

Found by reading the receive path: a call signal that arrived before the callee's call receiver (or its media listener) existed was decrypted and dropped (`call-listener-unavailable`, `listener-missing`, `media-listener-missing`), and the receiver ignored invites stamped before it started, which a few seconds of clock difference between devices also triggers. Either leaves the caller on "Ringing…" until expiry. [read code]

- Early signals are held (30 s, 32 max) and replayed in order when the receiver/listener is attached (`service/src/calls/pendingSignals.ts`).
- Invites within that window of the receiver's start are accepted; expired invites still never ring.
- An offer requested while media preparation is still running waits for it instead of failing with "Call media is not prepared." [unit test, red without the fix]
- An unanswered call ends with "No answer. <name> may be offline or have K3NCRYPT closed." and Retry; the callee sees "Missed call from <name>". [two-browser E2E]
- Optional connection helper (public STUN, off by default) with a one-tap offer when a call stalls on "Connecting". [two-browser E2E]

Stress: `CALL_STRESS=true` in `e2e/calls-reliability.spec.ts`, 20 first video calls per direction, each on freshly reloaded and unlocked sessions with alternating reload order: **20/20 and 20/20**. [two-browser E2E] Not run against the old code, so it is not shown to catch the original failure; the receive-path fixes are covered by unit tests.

**Android:** no wire change. Android checks invites by expiry, not by receiver start, so the clock issue does not apply there. Whether it drops signals before its receiver is ready was not checked. The connection helper setting does not exist on Android yet (planned in A2); web with the helper on still connects to Android, since one side's public address is often enough.
