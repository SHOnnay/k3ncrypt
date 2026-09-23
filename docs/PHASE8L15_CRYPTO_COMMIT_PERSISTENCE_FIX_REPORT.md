# Phase 8L-15 Crypto Commit Persistence Report

## Trace

The inbound path creates an Olm session, then commits the account and session sequentially through the encrypted browser vault. The vault uses independent IndexedDB transactions for the account pickle and session record; no transaction waits on itself and the commit path does not acknowledge a message before persistence.

## Blocking dependency

The remaining pending boundary is the join/replay acknowledgement relationship:

1. `ModernConversation.connect()` holds the conversation-wide connection lock.
2. It waits for the relay join acknowledgement.
3. The relay now waits for client envelope acceptance before acknowledging the join.
4. Client acceptance includes inbound session creation and durable commit.

This couples a network acknowledgement to work scheduled during the locked connection transition. It is not safe to bypass the commit or acknowledge before validation.

## Status

No production persistence shortcut was introduced. The offline replay test remains failing. A safe fix requires separating authenticated relay admission from mailbox replay completion so the connection lock is released before the inbound session commit begins, while retaining the mailbox item until the later explicit accepted acknowledgement.

## Security

No Vodozemac verification, identity validation, device-trust check, replay protection, or encrypted mailbox behavior was weakened.
