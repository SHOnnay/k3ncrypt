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
