# UX Part B: three visual directions (options only)

Status: options for the owner to choose from. **Nothing ships until one is picked.** Each direction keeps the cobalt / cream / ink identity, the Fraunces + Inter type pairing, the icons and every layout. They differ in surfaces, depth, shape and contrast.

How they were made: each direction is one stylesheet over the existing design tokens (`docs/ux/part-b/direction-*.css`), applied only by the opt-in screenshot spec `e2e/ux-directions.spec.ts` (`UX_DIRECTIONS=true`). Screenshots of the four requested screens (unlock, chat with file and call rows, invite, Calls page) at 1440×900 and 390×844 are in `k3ncrypt-ux-a/part-b/<direction>/`, next to `current/` for comparison.

## A. Quiet Paper — calmer, editorial

- Flat surfaces with hairline borders instead of shadows; solid cobalt instead of gradients.
- Slightly tighter radii (10 / 14 / 18 px); more air around content.
- Active navigation and chat rows marked with a thin cobalt edge, not a filled pill.
- Feels like a well-set letter. Least visual noise; best for long reading.

**Motion**
- Unlock: the cluster mark draws its three dots in sequence (≈400 ms), then the step text fades between phases.
- Sending a file: a 2 px cobalt line grows along the bottom edge of the file card; it settles into a check when sent.
- First load: content fades up with a 40 ms stagger (sidebar, header, messages); no movement larger than 8 px.

## B. Soft Depth — warmer, tactile

- Warmer cream; rounder shapes (18 / 24 / 32 px); layered soft shadows; pill buttons and composer.
- Message bubbles with a tail corner; avatars with a soft cobalt wash.
- Feels friendly and physical. Closest to consumer messaging apps; strongest "family" tone.

**Motion**
- Unlock: the cluster dots orbit once and settle into the logo as the vault opens; the card lifts slightly when ready.
- Sending a file: the card rises 2 px and its background fills left to right with a pale cobalt tint as bytes upload.
- First load: skeleton rows in the chat list shimmer once, then cross-fade to real names.

## C. Ink Rail — crisper, high contrast

- Dark ink navigation rail (sidebar and phone tab bar) beside cream content; cobalt accents.
- Squarer shapes (6 / 8 / 12 px); bordered cards; spaced uppercase labels; strong focus rings on buttons.
- Feels like a precise tool. Highest contrast and clearest structure; most "security product".

**Motion**
- Unlock: a thin cobalt bar sweeps across the top of the unlock card per phase (three segments).
- Sending a file: the send arrow slides out to the right and returns as a check; the card border turns cobalt while sending.
- First load: the rail slides in from the left (≈200 ms) while the content cross-fades.

## Shared motion rules (any direction)

- Respect `prefers-reduced-motion`: replace movement with instant state changes; keep only opacity fades under 150 ms.
- No motion longer than 500 ms; no looping animation except the unlock and sending progress indicators, which stop when done.
- Progress motion always matches real progress (unlock phases, file bytes), never a fake timer.

## What the owner picks

One direction (A, B or C), or a named mix (for example "B's warmth with C's ink rail"). The chosen stylesheet then becomes real tokens in `client/src/theme/tokens.css` and component CSS, with light and dark variants, checked by the audit spec at both sizes.
