# Android local unlock

Android now opens its encrypted local records only after system biometric or device-credential authentication. On Android 11 and later, the system prompt accepts a strong biometric or the device credential. On Android 8–10, it uses the system device-credential confirmation screen. A device without a configured screen lock cannot create or open the local vault.

## Storage boundary

The existing Room record format remains AES-GCM with the existing record-address associated data. The new non-exportable Android Keystore key requires user authentication. The app does not receive or store the device PIN, password, pattern, or biometric data. The Vodozemac account and pickle format remain unchanged.

The app does not construct the conversation screen or restore the identity until the Keystore key has performed an authenticated encryption/decryption check and the storage gate has opened. Each new process starts with the gate locked. Returning after at least one minute in the background locks storage, disconnects the relay, and releases the volatile identity; an active call is allowed to finish before this background lock applies. Android also prevents the activity from appearing in system screenshots and recents previews.

## Existing-install migration

The previous Keystore key did not require user authentication. After the first successful system authentication, `LocalVaultGate` decrypts every existing Room record with that old key and re-encrypts it with the new key. The complete rewrite and a format marker commit in one Room transaction. A failure leaves the old records and marker unchanged; the app stays locked. Once the new format is committed, the old key is deleted. An install without records creates the new format directly.

The migration does not clear app data, reset an identity, change trust metadata, or create a new session. If the old key is missing or any old record fails authentication, migration stops and preserves the database for recovery. A missing or invalid new Keystore key likewise leaves records in place; it cannot be silently replaced to recover encrypted data.

## Limits and verification

The Keystore authentication validity window is eight hours. A cold app start still requires the system authentication prompt. A continuously foregrounded session that outlasts that window will fail closed on protected storage access and must be unlocked again. This phase does not add a separate password or a cross-device recovery key. Existing data remains tied to the Android Keystore installation and can become inaccessible if that key is lost or invalidated.

The migration rollback and reopen test, existing encrypted Room persistence tests, debug and release builds, and Android unit tests passed on the disposable API 35 emulator. Older Android credential fallback compiles but was not exercised on an API 26–29 device. The persistent beta emulator was not used for migration testing.
