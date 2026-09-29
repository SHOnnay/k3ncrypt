# K3NCRYPT Android Beta Release

**Version:** v0.1-beta · **Platform:** Android
**Stage:** Private beta

K3NCRYPT is an open-source, privacy-first messenger. This Android beta includes encrypted messaging, contact identity verification, and voice calling.

## Install the APK

1. Download `K3NCRYPT-v0.1-beta.apk` from the official [K3NCRYPT GitHub Release](https://github.com/SHOnnay/k3ncrypt/releases/tag/v0.1-beta).
2. On your Android device, open the downloaded APK.
3. If Android asks, allow your browser or file manager to install this APK, then return to the installer and continue.
4. Open K3NCRYPT and follow the setup instructions. Keep your device passphrase private.

Install only the APK attached to the official K3NCRYPT release. Android may show an unfamiliar-source warning because this beta is distributed directly rather than through an app store.

## Included features

- End-to-end encrypted messaging
- Contact identity and fingerprint verification
- Voice calls with verified contacts
- Android local vault unlock
- Invitation-based contact onboarding

## Known beta limitations

- This is beta software and is still being tested.
- Notifications may be limited.
- Network and device conditions can affect call availability and quality.
- Additional features and broader device testing are under development.

## Security notes

- Message content is encrypted by the client before relay delivery. The service handles delivery and can observe operational metadata, including routing and connection timing.
- An invitation connects people; it does not verify identity. Compare fingerprints through another trusted channel and confirm them in the app before relying on a contact as verified.
- Protect your Android device and local vault passphrase. A compromised device or operating system can expose information while it is in use.
- Keep the APK’s SHA-256 checksum below and compare it with the downloaded file if you want to verify the download.

**APK SHA-256:** `98dc5e0b98d7fd595e7bdbab97da9048d52c734dea531022fbb923cc7ae2f6ea`
