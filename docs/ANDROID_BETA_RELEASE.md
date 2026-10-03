# K3NCRYPT Android Beta Release

| Release | App version | Platform | Stage |
| --- | --- | --- | --- |
| `v0.1.0-beta.2` | `0.1.0-beta` (version code `2`) | Android | Experimental beta |

K3NCRYPT is an open-source, privacy-first messenger. This Android beta includes encrypted messaging, invitation-based contact setup, explicit contact identity verification, and voice calling.

## Download and install

Download the APK directly from the official [K3NCRYPT v0.1.0-beta.2 release](https://github.com/SHOnnay/k3ncrypt/releases/tag/v0.1.0-beta.2):

[Download K3NCRYPT-v0.1.0-beta.2.apk](https://github.com/SHOnnay/k3ncrypt/releases/download/v0.1.0-beta.2/K3NCRYPT-v0.1.0-beta.2.apk)

1. Open the downloaded APK on your Android device.
2. If Android asks, allow your browser or file manager to install this APK, then return to the installer and continue.
3. Open K3NCRYPT and follow the setup instructions. Keep your device passphrase private.

Install only the APK attached to the official K3NCRYPT release. Android may show an unfamiliar-source warning because this beta is distributed directly rather than through an app store.

## Included features

- End-to-end encrypted messaging
- Invitation-based contact setup, including QR sharing/scanning
- Explicit contact identity and fingerprint verification
- Local vault unlock
- Voice calling with verified contacts; availability depends on network and device conditions

An invitation connects people; it does not verify identity. Compare fingerprints through another trusted channel and confirm them in the app before relying on a contact as verified.

## Known beta limitations

- This is experimental beta software and is still being tested.
- Notifications may be limited.
- Network and device conditions can affect call availability and quality.
- Video calls, LAN networking, direct/multipath delivery, SAS verification, and peer-persistence receipts are not available.

## Security notes

- Message content is encrypted by the client before relay delivery. The service handles delivery and can observe operational metadata, including routing and connection timing.
- Relay or transport acknowledgements do not prove that the recipient persisted or displayed a message.
- Protect your Android device and local vault passphrase. A compromised device or operating system can expose information while it is in use.
