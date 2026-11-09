# Sounds

All K3NCRYPT sounds are **self-made**: they are generated at run time from sine tones (Web Audio on the web;
the Android client plays the same notes). There are no audio files and no third-party material, so there is no
external licence. They are released with the project's own licence (see `LICENSE`). Code: `client/src/utils/sounds.ts`.

| Sound | Who hears it | Notes |
|---|---|---|
| Message | Recipient, when the chat is not open on screen (another chat is open, or the tab/app is in the background) and the chat is not muted | 880 Hz 0.12 s, then 1175 Hz 0.18 s |
| Ringtone | Callee while a call is incoming | 659 Hz and 784 Hz notes, 0.35 s each, two pairs, repeated every 3 s |
| Ringback | Caller while the call is ringing | 440 Hz + 480 Hz together for 2 s, silent 4 s, repeated |

A muted chat has no sound and no browser notification, but still shows its unread badge. Sounds can also be turned off in Settings (the existing "ringtone" setting).
