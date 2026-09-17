# Secure browser storage

Updated: 2026-09-17.

## Threat model

`BrowserSecureStorage` primarily protects secrets when IndexedDB/application data is copied, inspected offline, or included in a backup. The persistence adapter receives only versioned AES-GCM envelopes and public KDF/wrapping metadata.

It does **not** protect an unlocked application from malicious same-origin JavaScript or XSS, a compromised browser/extension or operating system, or live memory inspection. JavaScript references are cleared and mutable byte arrays are overwritten where practical, but JavaScript cannot promise secure erasure. This design is not equivalent to future Android hardware-backed key protection.

## Data-at-rest design

Initialization validates a passphrase/password (12–1024 characters) or optional numeric PIN (8–64 digits), creates a random 16-byte salt and random 32-byte Storage Master Key (SMK), derives a Key Encryption Key with Argon2id, and wraps the SMK with AES-256-GCM. The human secret is never stored and never encrypts records directly.

Current production Argon2id parameters are `m=19,456 KiB`, `t=2`, `p=1`, 32-byte output. They meet the current OWASP minimum profile. Metadata records the KDF name, format version, parameters, secret type, and salt so a later format can strengthen them. Unlock rejects unsafe, unsupported, or excessive parameters before running the KDF.

The SMK is imported into HKDF-SHA-256. Explicit labels derive a non-extractable AES-256-GCM storage key and a transient 32-byte vodozemac pickle key. Changing the unlock secret generates a new salt/nonce and rewraps the same SMK; records are not re-encrypted.

## Record envelope

Each write generates a fresh random 96-bit AES-GCM nonce. The persisted JSON has exact fields:

```text
version = 1
algorithm = AES-256-GCM
recordType
recordId
nonce
ciphertext || 128-bit authentication tag
```

`version`, `algorithm`, `recordType`, and `recordId` are canonical authenticated additional data. Copying ciphertext to another type or identifier therefore fails authentication. Parsers reject unknown fields, non-canonical base64url, oversized labels/records, unsupported versions, corrupted tags, and malformed metadata.

## Lock lifecycle

- `initializeWithPassphrase()` creates and unlocks a new vault.
- `unlock()` derives the KEK and authenticates the wrapped SMK before exposing any record.
- `lock()` drops the SMK/subkey references and overwrites the mutable SMK copy where practical.
- locked reads, writes, deletes, and pickle-key callbacks fail.
- `changeUnlockSecret()` verifies the old secret and atomically replaces only wrapping metadata.

`IndexedDbVaultPersistence` uses separate `vault_metadata` and `secure_records` stores. `IndexedDbPublicPreferences` uses a different database and is intentionally plaintext. Messaging accounts, sessions, contact verification, capabilities, and other secret records must use `SecureStorage`; only schema/UI/feature preferences belong in `PublicPreferences`.

## Versioning and migration

Version 1 fails closed on unknown storage versions and algorithms. There is no automatic legacy-conversation migration and no recovery/export format in this phase. A future migration must decrypt and authenticate with the old implementation before writing a new envelope, preserve rollback safety, and never downgrade KDF parameters silently.

## Benchmark

On the available Apple arm64 environment using Node 22.23.1 and `hash-wasm 4.12.0`, the final verification's five production-profile samples were 38.9, 42.1, 29.8, 33.0, and 27.5 ms (median 33.0 ms) at approximately 19 MiB. The first invocation includes WASM startup. Browser/device performance must be measured before exposing unlock UI; production parameters were not weakened for unit tests.
