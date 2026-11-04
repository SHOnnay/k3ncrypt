# Part B motion (prototype, waiting for owner approval)

Not in the app. `prototype.html` shows the three motions on the Ink Rail base, using the landing page's cobalt seam split/merge motif. Open it with `?scene=unlock|file|load`, add `&reduced=1` for the reduced-motion version, or `&t=<ms>` to freeze one frame. Frame strips and videos: `~/Desktop/k3ncrypt-part-a2/motion/`.

- **Unlock (~500 ms):** a cobalt seam draws down the middle of the unlock screen (0–150 ms), the two halves part along it (150–500 ms), and the chats settle in behind.
- **Sending a file:** the card starts as four pieces, slightly apart and tilted; each piece slides home as its share of bytes is sent, so the card is whole when the upload finishes. The progress line is the cobalt seam. In the app the pieces will be replaced by one solid card at 100%, removing the thin joins visible in the last prototype frame.
- **First load:** chat rows fade up with a 40 ms stagger, at most 8 px of movement.
- **Reduced motion:** no movement; unlock and load become 120–150 ms fades, and file pieces fade in place as bytes are sent.

Progress motion follows real progress (bytes sent), never a timer; the prototype uses a fixed 2.4 s upload only for the recording.
