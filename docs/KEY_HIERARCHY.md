# Local key hierarchy

Updated: 2026-09-17.

```text
human passphrase / password / 8+ digit PIN
        │  random 16-byte salt; versioned parameters
        ▼
Argon2id (m=19,456 KiB, t=2, p=1)
        │
        ▼
256-bit Key Encryption Key
        │  AES-256-GCM, fresh 96-bit nonce, metadata AAD
        ▼
random 256-bit Storage Master Key
        │
        ├── HKDF-SHA-256 "k3ncrypt:storage-record:v1"
        │       └── non-extractable AES-256-GCM record key
        │
        └── HKDF-SHA-256 "k3ncrypt:vodozemac-pickle:v1"
                └── transient 32-byte Account pickle key

separate CSPRNG generation
        ▼
random vodozemac Olm Account
        ├── Ed25519 signing identity
        ├── Curve25519 sender identity
        ├── one-time keys
        └── fallback keys
```

There is intentionally no arrow from the human unlock secret or SMK to the messaging identity. Changing a passphrase only rewraps the SMK and cannot rotate the Olm identity. Account pickles are encrypted with vodozemac's modern 32-byte-key mechanism and then stored as an authenticated secure record. Session pickles have no equivalent direct encrypted helper, so transient modern Serde bytes cross the WASM boundary and are immediately encrypted by `SecureStorage`; they must never be written plaintext.

The fixed HKDF salt is a protocol-domain value, not a password salt. Security comes from the random SMK and distinct `info` labels. No future attachment key is derived until an attachment feature actually needs one.
