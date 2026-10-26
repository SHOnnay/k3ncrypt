# Web Security, Devices, Privacy and Connection review

## Source and decision

- Branch: `codex/web-security-panels`.
- Exact base: `f6b9f3a1e426f1b34ad9df130c8f8949ea394b9d` (the completed contact-cleanup release).
- Verdict: **GO for owner visual and functional review**. This is not deployment approval or a claim of new-device onboarding success.
- Changes are confined to Web presentation, a bounded read-only service check, modal keyboard handling, regression tests and this report.
- Backend, Mongo schemas, Android, service SDK, cryptography, device authority, routing ownership, contact archive storage and messaging context are unchanged.

## Confirmed problems and corrections

| Before | After | Why |
| --- | --- | --- |
| “Verify Contact · XXXX”, “Unverified” and a vague wait instruction | A neutral Contact verification title for fallback names; verified, not yet verified, waiting for authenticated identity, temporarily unavailable, and changed-identity states | A display label is not identity proof. Missing comparison material must not enable confirmation. Existing accepted descriptors with missing identity are distinguished from a new invitation. |
| Device rows used a three-column network-status grid with two children | Independent wrapping device cards, separate lifecycle pills, readable public details, explicit revoke confirmation and duplicate-action prevention | The old grid placed device text in the status-dot column. |
| Device ID was compared to `userId`, which is a routing address | The complete unlocked public identity identifies the current device's identity; no self-revoke action is offered | The old comparison misidentified this device as another approved device. Authorization remains in the existing service. |
| Long guided setup instructions referenced a missing setup option | Device review comes first; absence of guided setup is stated; existing advanced protocol controls remain explicitly confirmed | No fake account linking or automatic synchronization is promised. |
| Preferences, fixed properties and browser permissions were mixed together | App protection; Notifications and previews; Screen privacy; Browser permissions; Data and external connections | Only implemented preferences use checkboxes. |
| “Service connection” used `syncStatus`; “Online” used session establishment | Separate service reachability, local encrypted-session readiness, and last device-authorization check | Neither existing boolean measured service reachability or remote presence. An open invitation is not an established encrypted session. |
| Tab from a native details summary jumped to the header; hidden details-body controls distorted wrapping | Native summaries are included in the modal focus cycle; closed-details content is excluded | Reproduced in the actual authenticated single-device panel. Forward and backward wrapping now pass. |
| Some semantic control colors fell below normal-text AA contrast | Small panel-only changes to positive/danger text and the dark primary gradient's final stop | Measured normal-text contrast is at least 4.5:1 for tested panel surfaces and active controls, without replacing the design system. |

The original 380px desktop panel, Inter/Fraunces, custom icons, gradients, theme tokens and navigation remain. At narrow widths the panel fills the screen. Panels scroll independently; headings, controls and long public values wrap. Font enlargement and reduced motion are respected. Browser-native confirmation dialogs remain intentionally native.

## Privacy control census

| Control/property | Class | Actual behavior |
| --- | --- | --- |
| Notifications | Implemented preference | Enables the existing open-app notification path only when browser permission allows it. Does not grant permission or wake a closed app. |
| Notification previews | Implemented preference | Includes message text in permitted alerts only when enabled; disabled in the UI when notifications are off. |
| Blur sensitive content | Implemented preference | Existing hidden-tab app blur. Does not lock the vault or prevent screenshots. |
| Conversation mute / ringtone in their existing panels | Implemented preferences | Existing notification filtering and local call ringtone; unchanged. |
| Encrypted vault | Fixed protection/status | Reports unlocked/locked/not open. No switch to weaken it. |
| End-to-end encryption | Fixed property | Describes message encryption separately from explicit identity verification. |
| Link previews / usage analytics | Fixed properties | No preview fetches or app usage analytics offered. Does not imply the service handles no connection metadata. |
| Protected files | Fixed behavior | Explicit/manual downloads; no automatic-media switch. |
| Microphone / camera | Browser permission reports | Actual known Permissions API values mapped to Allowed, Blocked, Ask when needed or Not reported. Existing Refresh permissions retained. |
| Notification permission | Browser permission report | Actual `Notification.permission` or Unavailable; change access in browser site settings. |
| Screenshot prevention | Unsupported in Web | Read-only Unavailable status; no false screenshot-protection switch. |
| Guided device onboarding / automatic vault-history synchronization | Unsupported workflow | Clearly explained as unavailable. No new enrollment or trust mechanism added. |

Enrollment drafts and notices are cleared on room, identity, account, panel or view changes. Failed selection errors from another room do not change current-conversation readiness. Late device errors are fenced to the originating UI scope. A pending action cannot be duplicated. Cached identity-comparison/device details are hidden when the vault is locked. None of these UI guards replaces service authorization.

## Connection check boundaries

- Uses the existing public `/api/ready` endpoint only while Connection is open.
- One request on open, manual recheck, or browser online/offline transition; no polling/retry loop.
- Five-second deadline; one current request, previous request aborted and stale results ignored.
- Omits credentials and referrer; sends no room, contact, key, token or identity payload.
- Reads at most 4 KiB and requires the known JSON `status: ready` response. A 200 HTML fallback is not called ready.
- HTTP 503/non-ready, failed requests, offline browser and timeouts are distinct from an established local session.
- This is not a socket monitor, remote-presence detector or delivery acknowledgment. Ordinary messaging does not depend on this check.
- Sending remains subject to existing operation-time authorization. Sent/Delivered authority is unchanged.

## Validation

### Final passed checks

- Client Jest: **43 suites, 276 tests passed**.
- Production client build: TypeScript + Vite passed.
- Lint: passed.
- `git diff --check`: passed.
- Focused changed-file sensitive-pattern scan: zero findings; no new credentials or private artifacts.
- **11 unique Chromium checks passed in bounded groups**:
  - Four authenticated panel checks: both themes; 320/360/393px; 150% root font size; keyboard forward/backward trap; scrolling; reduced motion; closed-page/reload restoration; real permission/preference state; service HTTP/offline/failure/timeout/retry; waiting identity; explicit unverify; failed enrollment and confirmation cancellation.
  - One explicitly synthetic device component fixture: active/pending/revoked states, long labels, actual shared button CSS, no overlap, no self-revoke, no action after cancellation, and duplicate-action guard. This is not evidence of actual enrollment/revocation authority.
  - One render of the supplied original HTML reference using local font assets, light/dark.
  - Two authenticated archive/restore regressions, including unchanged encrypted identity/history digests and messaging after restore, plus expired/deleted/unknown/invalid records never gaining trust.
  - Existing authenticated Slate Trust app navigation/theme/message smoke test.
  - Existing invitation, comparison/QR verification and persistent identity regression (only the updated “Not yet verified” selector was adapted).
  - Completed audio-call history and **actual browser-process restart using disposable on-disk profiles**, now also checking retained verified Security state and Privacy preference on both participants.

Browser checks used only the existing loopback Mongo test service, generated isolated test database names and disposable identities. No owner browser profile or live records were accessed.

### Failures found during development and their disposition

- A combined eleven-test fixture burst hit the unchanged HTTP 429 invitation-creation limit; six authenticated tests could not reach their subject. Smaller isolated groups passed; no quotas or security checks were weakened. The combined burst is not reported as passed.
- The initially optimistic expectation that two independently registered accounts would become a linked device failed. The actual UI now explains the unsupported guided workflow, and a deterministic check verifies the existing rejection produces no false success or extra device. Successful new-device enrollment is **not validated** by this task.
- A copied live IndexedDB snapshot was an unsuitable normal-shutdown fixture: it selected an invitation or stalled restoration. That approach was removed rather than altering application authorization. Normal persistent-profile process shutdown/restart and explicit saved-contact selection passed using the existing restart regression.
- New component harness imports/selectors and one invalid synthetic fingerprint were corrected. The final component/unit tests pass.
- The actual modal-summary keyboard regression was reproduced before correction and now passes forward/backward tab-cycle tests.
- Existing non-failing advisories remain: Vite's >500 KiB chunk warning, the ChatFooter SSR useLayoutEffect warning, and local test CHAT_LINK_DOMAIN/terminal-color notices.

## Evidence and reproduction

Generated screenshots are outside Git under `/private/tmp/k3ncrypt-security-panels-evidence/`; an owner-facing copy and comparison gallery are saved separately in the task's local visualization artifacts. No screenshots or profile/database exports are committed.

- `before-{slate,paper}-{security,devices,privacy,connection}.png`: actual authenticated base application.
- `after-{slate,paper}-{security,devices,privacy,connection}.png`: actual authenticated candidate.
- `after-*-393.png`, `after-*-large-font.png`: actual narrow/enlarged application.
- `after-waiting-identity.png`, `after-unverified.png`, `after-device-existing-account-rejected.png`: actual disposable app states.
- `after-device-layout-component-fixture-393.png`: explicitly synthetic component fixture, not an enrolled-device claim.
- `reference-{light,dark}-settings.png`: supplied HTML rendered locally, not an application screenshot.

Run from this worktree using existing dependencies and disposable loopback Mongo:

```sh
npm test -- --runInBand --coverage=false client/src
npm run client:build
npm run lint -- --no-warn-ignored
git diff --check
```

Run browser groups separately to avoid fixture bursts; substitute the local reference path only when rendering the prototype:

```sh
PLAYWRIGHT_MONGO_URI=mongodb://127.0.0.1:37017 PLAYWRIGHT_BACKEND_PORT=48271 PLAYWRIGHT_CLIENT_PORT=48272 K3NCRYPT_SLATE_REFERENCE_HTML='/path/to/K3NCRYPT — Slate Trust, full app (3).html' npx playwright test e2e/security-panels.spec.ts e2e/device-panel-component.spec.ts --project=chromium --workers=1
PLAYWRIGHT_MONGO_URI=mongodb://127.0.0.1:37017 PLAYWRIGHT_BACKEND_PORT=48271 PLAYWRIGHT_CLIENT_PORT=48272 npx playwright test e2e/conversation-archive.spec.ts e2e/slate-ui-actual-app.spec.ts --project=chromium --workers=1
PLAYWRIGHT_MONGO_URI=mongodb://127.0.0.1:37017 PLAYWRIGHT_BACKEND_PORT=48271 PLAYWRIGHT_CLIENT_PORT=48272 npx playwright test e2e/alpha-contact.spec.ts e2e/call-history.spec.ts --project=chromium --workers=1
```

Reference rendering is explicitly skipped if no local reference path is provided. No production credentials are needed.

## Remaining boundaries

- Owner visual acceptance, actual Brave permission behavior and physical-device onboarding remain separate from automated Chromium evidence.
- This update does not fix or weaken a device enrollment/backend authorization failure. A supported end-to-end new-device enrollment needs its own approved disposable test/design if desired.
- No claim that the original owner's unavailable contacts have been recovered.
- No push, merge, deployment, Render change, live Mongo access, Android change, APK or installation.
