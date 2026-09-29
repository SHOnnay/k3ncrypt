# ADR 0001: Stable envelope identity for multipath

Status: Proposed; implementation approval belongs to Phase 1 review.

## Context

TypeScript currently computes SHA-256 over `JSON.stringify(envelope)` in `ModernConversation.digest()`. Object key order/escaping can differ across transports/languages, which is unsuitable as a cross-path dedupe key. Server mailbox dedupe is separate and must not change.

## Proposal

Use the exact validated `olmMessage` string plus length-prefixed conversation ID under the domain-separated SHA-256 construction in `envelope-identity-v1.md`. Keep reading existing `modern-seen` digests during migration. Write new IDs only to a versioned record after approval. This identifier is not authentication.

## Consequences / unresolved

The seen retention is currently 1,024. Measure supported pending/replay lifetime; if longer than retention, propose a bounded increase or expiry contract. Confirm TypeScript/Kotlin byte-for-byte fixture agreement before enabling multipath. No decision on changing the existing implementation in Phase 0.

## Phase 1B requirements and decision gate

An ID must be stable for one encrypted envelope across retry, relay mailbox replay and future paths, independent of JSON property order, adapter framing and relay-generated IDs. Domain separation and length-prefixed conversation binding prevent accidental cross-conversation correlation. The exact validated `olmMessage` bytes are the proposed input: a resend must reuse those ciphertext bytes, never re-encrypt for retry. This hash is a correlation key, not an authenticator; only the normal receive path authenticates the sender.

The current `SHA-256(JSON.stringify(envelope))` is local to the TypeScript receiver and is unsuitable as a common TypeScript/Android/path ID. The relay's server-side dedupe key serves its mailbox and remains separate. Before adopting the proposed ID, confirm strict envelope validation yields the same exact string on both platforms, byte-for-byte fixture parity, collision-domain separation, legacy seen-set check-both behavior and versioned storage. Do not rewrite old seen records. The 1,024-entry window must cover the longest supported retry/mailbox replay period or be replaced by a reviewed bounded retention policy; a seven-day mailbox TTL alone does not establish a sufficient window.
