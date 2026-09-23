# Phase 8J Video Call UX Report

## Completed features

- Added authenticated call media mode (`audio` or `video`) to encrypted call invitation control signals.
- Added mode validation: unknown media modes are rejected before incoming-call state is created.
- Outgoing video calls select camera plus microphone constraints; the selected mode is retained for the incoming peer when it accepts the call.
- Added local track controls for microphone and camera enable/disable.
- Exposed local and remote `MediaStream` values through `Peer`, `WebRTCCall`, and `E2ECall` so browser UI renderers can attach actual streams.
- Preserved existing encrypted signaling, replay checks, device trust checks, and WebRTC DTLS-SRTP media transport.

## Validation

- Service SDK production build passed.
- ESLint passed for modified call/WebRTC files.
- Prior targeted WebRTC and SDK tests passed; no new browser-rendering test was added in this pass.

## Remaining limitations

- The React `CallOverlay` is not yet connected to `localStream` and `remoteStream`, so there is no production remote-video main view or local preview.
- Mute and camera controls are exposed at SDK level but are not yet wired into the React overlay.
- Video permission-denial copy, voice-only fallback choice, camera switching, and output-device selection remain unfinished.
- Browser-to-browser video integration, TURN fallback, mobile support, and production operational readiness are unverified.

## Beta recommendation

The secure signaling and browser media foundations now carry video mode correctly, but the end-user video experience is incomplete without stream rendering and UI controls. Continue to advertise voice calling only until those UI and browser integration paths are completed and tested.
