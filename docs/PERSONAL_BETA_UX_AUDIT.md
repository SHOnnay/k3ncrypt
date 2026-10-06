# Personal beta UX audit

**Audited base:** `957187956cddc99e8707de4a24afc1ab852c4c6a` (`integration/main-product`)

This review covered the current Web React screens and Android Compose screens, their reachable state copy, responsive CSS, and the matching call, verification, and transfer state helpers. No security or architecture blocker was found. Verification gates, local identity authority, call admission, file admission, and existing wire protocols remain explicit.

## Journey findings

| Journey | Web | Android | Finding |
| --- | --- | --- | --- |
| First launch and account | Account identity and local vault were explained, but startup failure instructed refresh; create-account copy omitted the 12-character minimum and confirmation. An unlocked account still showed “Create your private account.” | Device authentication, configured service setup, and retry states were present. A missing service address is only available under advanced setup. | P1: retry without reloading, wait feedback, distinguish create account from add contact, confirm a new passphrase. |
| Add and verify a person | Invitation and QR flow, explicit verification, reset, and identity-change states exist. Ordinary explanations used “fingerprint” repeatedly. | Invitation scan/paste and explicit verification exist. The contact code was always printed inline with chat verification controls. | P1: say “security code” in normal instructions, hide the code until requested, clearly explain changed identity. Preserve comparison and confirmation gates. |
| First message | Labeled composer and truthful per-message relay state exist; the composer was a single-line input. | Multiline composer exists; status labels described relay internals. | P1: support Shift+Enter/new lines in Web and use plain status copy without claiming delivery. |
| Calls | Audio/video controls, verification blocking, permission-on-action and polite terminal copy exist. A real call permission prompt is supported by contextual call page copy. | Call controls, foreground limitation, verification gate, and permission-on-action exist. | P2: test media permission recovery and call controls with real devices and large text; no device was attached for this audit. |
| Photos and files | Limit was present in small footer text. Transfer UI showed internal phases and byte counts. The attachment button was hidden below 620 px. | The size limit and explicit save control existed; progress exposed enum phase and bytes. | P1: keep attachment available at mobile widths, make the limit clear before selection, map phases to human copy and show progress. |
| Network / permissions | Most surfaced errors were already bounded, but initialization offered no retry. Service startup may take time. | Network and permission errors were mapped to recovery guidance; unavailable service configuration is an advanced setting. | P1: retry startup and show delayed startup feedback. P2: real cold-start, Wi-Fi loss, denied-permission, and interrupted-upload checks require a configured live backend/device. |
| Empty states and navigation | Chats, Contacts, Calls, Settings; useful no-contact/no-message/no-call states and next actions. “Relay conversation open” exposed implementation language. | Same four tabs; saved contacts and no-conversation guidance. | P1: simplify the Web connection preview. No duplicate or dead top-level pages were found. |
| Identity change | Status badge and call blocking were present; recovery instructions were in Settings. | State and call block were visible; detailed recovery instructions were below chat. | P1: state plainly that K3NCRYPT can no longer confirm it is the same person/device and direct the user to compare the new code. No silent continue path found. |

## Accessibility and layout

- Web was rendered in Chromium at 1440, 1024, 768, 390, and 320 CSS pixels. The first-run screen had no horizontal overflow at these widths. Mobile navigation, content padding, dialogs, and call overlay have responsive rules in source. Before screenshots are in `/private/tmp/k3-personal-beta-ux-before-1440.png`, `/private/tmp/k3-personal-beta-ux-before-390.png`, and `/private/tmp/k3-personal-beta-ux-before-onboarding-create.png`.
- Readable after screenshots include `/private/tmp/k3-personal-beta-ux-after-1440-final.png`, `/private/tmp/k3-personal-beta-ux-after-390-final.png`, `/private/tmp/k3-personal-beta-ux-after-320-final.png`, and `/private/tmp/k3-personal-beta-ux-after-passphrase-final.png`.
- Web supplies visible focus styles, reduced-motion support, labels for call and attachment controls, and semantic alert/status regions. The submit icon needed an explicit accessible name. A true screen-reader session was unavailable.
- Android uses labeled Compose controls, scrollable first-run/settings surfaces, multi-line chat input, and system text styles. No ADB or emulator executable/device is available here, so small-device, landscape, large-font, TalkBack, and keyboard screenshots were not fabricated.
- A disposable private-browser smoke completed Web account creation against the local volatile development backend. The passphrase stayed in the browser and the private context was closed afterward. Saved-contact verification, messaging, calls, file receive/save, and process/network interruption were not exercised end to end. Focused tests cover the changed UI states and gates.

## Priorities

**P0:** None found; no basic workflow bypassed identity or authorization checks.

**P1 addressed on the UX branch:** startup retry/delay guidance; account state and passphrase clarity; explicit first passphrase confirmation; security-code wording and identity-change explanation; multi-line Web composer; mobile Web attachment access; bounded plain-language file progress/errors; plain Android send and transfer copy; hide Android contact code until requested; message send control label.

**P2 retained:** Full service cold-start and media/device-permission trials; real network loss/reconnect and upload interruption; Android small/large-font, landscape, TalkBack and keyboard validation; Web screen-reader session; native nickname prompt; broader call/failure copy review.

**P3 retained:** Further visual polish and animation review, which should follow usability evidence from family beta users.
