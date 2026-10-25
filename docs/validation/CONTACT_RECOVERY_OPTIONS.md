# Three unavailable existing contacts — non-destructive options

No owner browser, identity, server record or production database was accessed. These are future options, not instructions to perform physical tests now.

## What the evidence proves

CONTACT_REGISTRY_MISSING previously could misclassify a remote prekey 404. Saved room rows and a zero count of locally missing access descriptors do not prove lost pins or capabilities. The updated UI preserves contacts and distinguishes local-record absence, remote outage and missing server routing authority.

The durable mechanism prevents future temporary-key expiry from removing an adopted relationship's authority. It does not reconstruct authority already deleted by legacy TTL cleanup. A current valid device and a local pin/descriptor/route secret do not alone prove the missing historical room ownership. A second current signature, without an independently retained authorized anchor for that old room, also must not fabricate it. No same-room peer-assisted recovery protocol is implemented or claimed validated here.

## Option A: original server authority remains valid

After approved safe activation, both original participants unlock the same original identities and authenticate/adopt while their server evidence remains valid. No new identity, pin replacement or comparison reset is needed for an unchanged established verified session. If either peer is offline, wait for its authorized adoption; do not treat first-peer adoption as complete migration.

## Option B: legacy ownership has genuinely expired/deleted

The smallest supported path is an explicitly accepted NEW invitation/room between the same original accounts, while keeping the original records untouched:

1. Preserve the original browser profile/vault and its backup under a separately approved local-preservation procedure. Do not clear IndexedDB, reset accounts, delete old contacts, or switch to Incognito as a repair.
2. Both parties use their SAME original unlocked accounts. Establish a separate invitation/room using existing authenticated flows.
3. Compare the exact security codes/identities explicitly for the new relationship and confirm only if they match the intended original peer. Do not auto-copy verification or accept changed keys. Stop on mismatch.
4. New encrypted messages use the new authorized room. Keep old room and encrypted history unchanged and paused; do not claim old pending mail or expired files moved to the new room.

Disposable persistent-browser acceptance verified both own identities and peer pins stayed identical. Hashes of old encrypted contact, session and history records remained byte-for-byte equal; original verification remained verified. New room verification required explicit comparison. New room messaging worked; the old room gained no invented owner and both room records remained stored.

Preserved: original vault, account/keys, old pinned contact/verification records, old encrypted history bytes, new use of the same identities.
Not automatically recovered: old room server authority, old-room opening through that authority, merged visible histories, expired mail/files, or new-room verification without an explicit comparison. Retained ciphertext is not a claim that the old room is now openable.

## If restoring the SAME old room is mandatory

Stop that recovery. A separately reviewed protocol would need independently retained current peer/room authorization, fresh mutual proof bound to exact identities/room/epochs, and explicit deletion/revocation tombstone fencing. If that historical anchor does not exist, consent today can create new authority but cannot prove deleted prior authority. Do not resurrect revoked/deleted rooms. No general trust reconstruction or owner-data mutation is authorized.

Owner decision needed: preserve original records and use a separate existing-protocol room, or require a separately approved same-room recovery design. Do not describe either as an automatic successful recovery of the owner's three rooms.
