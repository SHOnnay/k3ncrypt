# Phase 8L-16 Offline Replay Fix Report

## Fix

Authenticated `chat-join` now completes after room-control authorization, routing ownership validation, and durable device-proof verification. It no longer waits for mailbox processing.

After `ModernConversation.connect()` releases its conversation lock, the Socket.IO transport requests `mailbox-replay`. The relay dispatches opaque encrypted entries and deletes an entry only after the existing client acceptance callback confirms normal envelope validation and durable inbound state persistence.

## Security impact

The change does not relax Vodozemac validation, trust checks, routing authorization, replay protection, or encrypted mailbox storage. A failed envelope remains retained.

## Validation

- `npm run lint`: passed.
- `npm run build-service-sdk`: passed.

The full browser regression and complete Jest validation remain required to confirm the final offline first-message path.
