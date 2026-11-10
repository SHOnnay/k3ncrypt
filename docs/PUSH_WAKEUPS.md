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

## Incoming-call wake-ups (`type: call`)
Off by default: the relay sends a call push only when push is configured **and** `K3NCRYPT_CALL_WAKE_ENABLED=true` **and** maintenance mode is off. Unset = no call push, and everything behaves as before.

**Trigger.** The relay cannot see that an encrypted message is a call invite, so it never guesses. The *caller's client* sends a `call-wake` socket event (`kind: ring` or `cancel`, a caller-chosen random `wakeId`, the recipient's routing address, and a one-time `relay:signal` device proof) on its already-joined room socket. The ack is immediate and identical whether or not anything is sent; the push itself is fire-and-forget and never delays signalling.

**Payload.** `{ version: "1", type: "call" | "call-cancel", eventId (the caller's random wakeId), createdAt, expiresAt (45 s) }`. No caller, room, contact or name. A cancel carries the same id so the phone can stop ringing and show a generic "Missed call". High-priority FCM, **no collapse key**, its own dispatcher (never coalesced with or throttled by message wakes), nothing written to the database.

**Who can ring whom.** Only the current, device-proven participant of a room can ring the room's other member, and only if that member's device has a captured push route for the room, the room is alive, the device is still active, and a live pre-key publication exists for that address. A cancel is honoured only once, only for a ring that same caller device made.

**Limits (per relay process).** Per caller device: burst 4, then 1 per 15 s, 40 per hour. Per caller-and-target pair: at least 8 s apart, 20 per hour. Per target token: burst 3, then 1 per 20 s, 30 per hour. Global: 120 per minute and 16 sends in flight. A full limiter map refuses new keys.

**Removing a contact.** `POST /api/device-trust/push/route-revoke` (headers `X-K3ncrypt-Control-Capability` and `X-K3ncrypt-Routing-Proof`, body `{ room, address }`) withdraws the caller's own wake route for that room; the answer never says whether a route existed. The route comes back only if the device joins the room again. Before this change, removing/archiving a contact on web only hid it locally and Android had no removal at all, so a removed contact could still ring for up to 30 days.

### What the relay and Google learn
- The relay learns **when a device asks to ring which route** (caller device, target route, time) and that a call-type push went to a given token. It already learns message timing the same way.
- FCM/Google learns that a call-type push reached a device at a time (the `type` field is visible to them), so they can tell calls from messages by timing and type. They do not learn who called, the room, or any content.
- Accepted limits: caps are per process (if Render runs several instances the effective caps multiply; the instance count is not verified); on Android 14/15 the full-screen call screen may be unavailable to sideloaded installs, in which case a heads-up ring is used.