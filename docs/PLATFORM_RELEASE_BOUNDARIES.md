# K3NCRYPT Platform Release Boundaries

## Android

Build the web client into an Android host only with a native secure-storage adapter, Android notification channel, and an explicit `FLAG_SECURE` secure-window integration. The host must preserve the existing explicit microphone/camera permission boundary. Generate and sign an APK/AAB outside source control with a protected signing key.

## iOS

Use a native host with Keychain-backed secure storage, notification permission handling, CallKit adapter, and screen-capture detection callback. iOS cannot guarantee screenshot prevention; a capture-detection callback can hide or blur application content after detection.

## Windows, macOS, and Linux

Package the web client only alongside an audited native secure-storage adapter. Use platform-native notification APIs and ensure ringtone playback has application focus policy. Windows installer, macOS application bundle/notarization, and Linux package/AppImage generation must be reproducible and signed where the platform supports it.

## Security release gate

Do not place vault keys, recovery material, invitation links, TURN credentials, or production signing keys in a package, repository, build log, or crash report. Packaging adapters must use the `service/src/platform` secure-storage and permission boundaries, and must not bypass device trust or encrypted transport.
