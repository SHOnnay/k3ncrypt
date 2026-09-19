# K3ncrypt design system

K3ncrypt uses a light, quiet consumer-messenger direction. Privacy is communicated through clear state and restrained copy, not terminal styling or repeated security symbols.

## Tokens

Tokens live in `client/src/theme/tokens.css`.

- Paper & Ink: canvas `#EFEAE0`, raised/background `#F4F0E7`, surface `#E6E0D3`, primary text `#2B2620`, muted text `#6B6458`, denim-blue primary accent `#4C6B8A`.
- Slate Dusk: canvas `#1E212B`, raised/background `#242733`, surface `#262A35`, primary text `#EEF0F6`, muted text `#9CA2B4`, periwinkle primary accent `#8C93D9`.
- Sent messages use `#DCE6EE` in Paper & Ink and `#33314F` in Slate Dusk.
- Green is semantic status only: success/online uses `#4F8161` in Paper & Ink and `#7FA98C` in Slate Dusk. It is not the general brand/action color.
- Danger/end/error uses `#A8503F` in Paper & Ink and `#B4695B` in Slate Dusk.
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
