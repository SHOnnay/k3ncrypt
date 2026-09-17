# K3ncrypt design system

K3ncrypt uses a light, quiet consumer-messenger direction. Privacy is communicated through clear state and restrained copy, not terminal styling or repeated security symbols.

## Tokens

Tokens live in `client/src/styles/global.css`.

- Surfaces: warm gray canvas, white surface, muted neutral surface.
- Text: charcoal primary, softer metadata, muted helper text.
- Accent: deep teal (`#176b52`) used for primary actions, focus, and selected state.
- Semantic colors: green success, amber warning, restrained red danger.
- Spacing: 4/8/12/16/24/32px.
- Radius: 10px controls, 16px cards, 20px sheets.
- Motion: 140ms fast and 200ms normal; reduced-motion preferences disable nonessential movement.
- Typography: local system stack (Inter-like system UI, SF Pro on Apple platforms, Segoe UI on Windows). No remote font request.

## Layout

Desktop uses a conversation sidebar, centered conversation workspace, and an optional privacy panel. Tablet collapses the sidebar to a navigation rail. Mobile moves navigation to a bottom bar and lets privacy information enter as a side sheet.

The current product has one disposable conversation at a time, so the sidebar renders only real state. It does not fabricate contacts, timestamps, unread counts, or settings.

## Components and behavior

Existing reusable `Button`, `Input`, `MessageBubble`, `ChatHeader`, composer, conversation row, and privacy sheet components share the tokens. Attachment, voice-note, recovery, and persistent identity controls are visibly disabled and labeled as future work. Call UI uses a light modal card and real call lifecycle state.

All controls retain visible focus treatment, semantic buttons/headers/asides, adequate touch targets, and descriptive ARIA labels. Message text stays in escaped React text nodes.

