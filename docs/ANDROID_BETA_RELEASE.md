# Upcoming Android personal-use beta

Release preparation targets **versionName `0.1.0-beta.3`, versionCode `3`**. No public release tag or signed APK/AAB is created by hardening. Previously distributed beta code `2` must upgrade without downgrade flags: every future artifact needs a strictly larger versionCode. Keep APK/AAB variants of one release aligned; record the source commit and artifact SHA-256 before publication.

## External signing inputs

Provide outside the repository/build context:

- `K3NCRYPT_ANDROID_KEYSTORE_PATH`
- `K3NCRYPT_ANDROID_KEYSTORE_PASSWORD`
- `K3NCRYPT_ANDROID_KEY_ALIAS`
- `K3NCRYPT_ANDROID_KEY_PASSWORD`

Use the original signing identity to update existing installations. Never generate substitute/debug signing credentials for a release, commit a key/password, place it in Docker context, or log its value. Missing inputs stop packaging with a configuration error. Release backend/socket origins are supplied externally and must be real HTTPS origins.

```sh
cd android
./gradlew :app:processReleaseMainManifest :app:mergeReleaseResources :app:generateReleaseBuildConfig :app:lintRelease --no-daemon
# Only after authorized external signing inputs and actual production origins are available:
./gradlew :app:assembleRelease :app:bundleRelease   -Pk3ncryptBackendUrl="$K3NCRYPT_RELEASE_BACKEND_ORIGIN"   -Pk3ncryptSocketUrl="$K3NCRYPT_RELEASE_SOCKET_ORIGIN" --no-daemon
```

Resource preparation is unsigned and does not prove distributable signing. APK output is under `app/build/outputs/apk/release`; AAB output is under `app/build/outputs/bundle/release`. Verify signatures, version, source commit, hashes and upgrade behavior on a preserved identity before publishing.

## Current implementation and publication gate

Web + Android implement encrypted messaging, invitation/QR setup, explicit verified-and-unchanged authority, audio/video, and secure V2 files/photos/documents. Physical Web↔Android media/file interoperability is still pending. Signing and physical gates must be completed before declaring this upcoming beta ready.

Files: 8 MiB; 256 KiB; 32 chunks plus manifest; two active transfers; 12 MiB stored/incomplete reservations; 24-hour expiry. Same-session exact-object retry only; process death/cache loss requires restart. Photos use the same encrypted path; no thumbnails or automatic opening. Unknown-size providers are rejected.

Calls: no bundled TURN/default Android ICE services; direct ICE exposes network information and may fail across NAT/firewalls. Android ends calls on backgrounding; process death does not preserve them. Local Session is experimental/separate. Relay acknowledgements do not establish peer persistence or reading. No anonymity, metadata-free or IP-hidden claim is made.

Private app storage is intentionally excluded from cloud backup/device transfer across credential/device-protected domains. Keystore keys remain device-bound; this does not add a new recovery mechanism. Physical backup/transfer/provider behavior remains a device-validation item.
