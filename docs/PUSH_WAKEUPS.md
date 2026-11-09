# Push wake-ups (Firebase Cloud Messaging)

**Off unless configured.** With no push settings the relay behaves exactly as before: no Firebase code runs, no network request is made, and `POST /api/device-trust/push` answers 503.

## What is sent
A wake-up is a data message with five fields only: `version`, `type` (`encrypted-activity`), a random `eventId`, `createdAt`, `expiresAt` (60 s). It contains no names, no message text, no sender, no room or contact identifier. The phone wakes, opens its normal connection, fetches the sealed envelope itself and decrypts it locally. Google can see that a wake-up reached a device and when.

## Limits (fail-safe)
- At most one wake per device token every 30 s; 32 sends in flight; a token that Google reports as invalid is retired.
- A wake is requested only after the sealed envelope is stored, and is never awaited: a push failure cannot delay or lose a message.
- Registering a token needs a fresh device proof plus a signature over the token hash from that device.

## Render settings (set by the owner, never in the repo or chat)
| Setting | Value |
|---|---|
| `K3NCRYPT_FCM_ENABLED` | `true` (leave unset or `false` to keep push off) |
| `K3NCRYPT_FCM_PROJECT_ID` | the Firebase project id (not a secret) |
| `K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH` | `/etc/secrets/<name of the secret file>` |
| Secret File | Render → service → Environment → Secret Files → add the Firebase service-account JSON under that name |

`K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` must also be set (it already is in production).

## One-time database step
`scripts/migratePushWake.ts --apply` creates the wake collections and indexes. It refuses to run while `K3NCRYPT_FCM_ENABLED=true`, so run it **before** turning push on (see the release notes for the exact command).
