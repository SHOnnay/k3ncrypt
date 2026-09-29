# ADR 0001: Stable envelope identity for multipath

Status: Proposed; implementation approval belongs to Phase 1 review.

## Context

TypeScript currently computes SHA-256 over `JSON.stringify(envelope)` in `ModernConversation.digest()`. Object key order/escaping can differ across transports/languages, which is unsuitable as a cross-path dedupe key. Server mailbox dedupe is separate and must not change.

## Proposal

Use the exact validated `olmMessage` string plus length-prefixed conversation ID under the domain-separated SHA-256 construction in `envelope-identity-v1.md`. Keep reading existing `modern-seen` digests during migration. Write new IDs only to a versioned record after approval. This identifier is not authentication.

## Consequences / unresolved

The seen retention is currently 1,024. Measure supported pending/replay lifetime; if longer than retention, propose a bounded increase or expiry contract. Confirm TypeScript/Kotlin byte-for-byte fixture agreement before enabling multipath. No decision on changing the existing implementation in Phase 0.
