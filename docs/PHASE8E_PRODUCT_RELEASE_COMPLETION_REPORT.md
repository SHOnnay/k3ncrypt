# K3NCRYPT Phase 8E Product Release Completion Report

## Outcome

Phase 8E completes the beta-facing product layer without changing cryptographic algorithms, device identity, trust enforcement, synchronization security, or private-network security boundaries.

## Notifications and calls

- Added a browser notification boundary that receives only post-authentication client events.
- Notification text is private by default: `K3NCRYPT — New message`. Sender names and message content are excluded unless a user explicitly enables previews.
- Added per-conversation muting, global notification controls, incoming and missed-call event support, and a security-event notification type.
- Added an incoming-call ringtone controller with deterministic start/stop handling. It produces output only and never requests microphone or camera access. The existing call lifecycle stops it on accept, reject, timeout, cancellation, failure, end, and unmount.
- Android notification channels, iOS CallKit, and desktop native notification integrations remain adapter targets for native hosts. The browser client uses the standards-based Notification API when permission has already been granted.

## Privacy experience

- Privacy settings now include notification visibility, background sensitive-content blur, screen-privacy preference, media behavior, and permission status.
- The app applies background blur when enabled and the document becomes hidden. This reduces casual task-switcher exposure in browsers; it is not presented as screenshot prevention.
- The release and privacy guides document native platform limits: Android can provide secure-window integration, iOS can provide capture detection, while desktop guarantees depend on the host operating system.

## User flows and settings

- Settings expose functional Notifications and Calls sections alongside existing identity/device, recovery, trust, privacy, connection, and appearance controls.
- Existing onboarding explains the local account passphrase, private contact invitation, local identity, and vault restoration in user language.
- Existing device enrollment and revocation controls remain wired exclusively through the authenticated Phase 6 runtime.

## Release preparation and website

- Added `docs/RELEASE_GUIDE.md`, `docs/USER_PRIVACY_GUIDE.md`, and `docs/PLATFORM_RELEASE_BOUNDARIES.md`.
- Added a lightweight static public landing page at `site/index.html` for GitHub Pages or Cloudflare Pages deployment.
- Packaging guidance covers Android signing, desktop host secure storage, iOS CallKit/capture detection, and platform signing without adding package secrets to source control.

## Remaining limitations

- Native Android, iOS, Windows, macOS, and Linux hosts are documented adapter boundaries; signed APK, installer, application-bundle, and AppImage artifacts are not produced by this web repository.
- Browser notifications require prior browser permission and may be limited by browser background policies.
- No software can fully prevent screen photography. Screenshot/capture protections require a platform-specific host and must be verified on each target OS.
- The static landing page is deployment-ready but is not automatically published by this change.

## Validation

- Jest: 94 passing suites, 420 passing tests; one environment-gated suite/test skipped.
- TypeScript: client, service, and backend no-emit checks passed.
- ESLint, client production build, and SDK production build passed.
- `npm audit --audit-level=high` reported zero vulnerabilities.
- Backend and frontend production Docker builds passed.
- `git diff --check` passed.
