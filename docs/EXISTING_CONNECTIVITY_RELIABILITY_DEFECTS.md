# Existing connectivity reliability defects

Recorded 2026-10-09 during the gated Stage 1 integration. These are product reliability issues; this record does not change their behavior or identify a complete root cause.

## Offline first-contact acceptance

A newly invited contact can fail to open when the invite creator is offline. In the controlled A/B/C browser comparison this occurred on integration baseline, unpatched Mux, and gated Mux. The observed safe diagnostic was `CONVERSATION_SESSION_MISSING`: room setup completed, but the offline peer had not established the encrypted session. This is pre-existing and outside the gated integration fix.

## Intermittent saved-conversation restoration

Conversation opening has intermittently surfaced `CONVERSATION_RESTORE_FAILED` on the integration baseline and in an earlier gated-Mux run. In the latest controlled runs, saved-contact refresh/unlock and the follow-up message succeeded on both Mux variants. A separate baseline stress attempt failed earlier during switching and did not reach refresh/unlock. The post-unlock failure remains intermittent and unattributed; no replay migration, vault CAS, or session recovery cause was established.

## Prekey lookup reported as invitation expiry

`ModernConversation.connectUnlocked` maps any failure fetching the local prekey bundle to “This private invitation expired,” without preserving the HTTP status or failure category. A baseline switching run observed this classification and then surfaced `CONVERSATION_RESTORE_FAILED`. The available evidence does not establish the underlying HTTP response. The displayed expiry can therefore misclassify a prekey lookup failure.
