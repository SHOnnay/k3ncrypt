# Phase 6C Implementation Report

## Implemented foundations

### User-controlled recovery

`service/src/recovery` provides a fail-closed recovery ceremony around an opaque, user-supplied archive. It enforces archive version/expiry checks, one-time replay claims, material verification, a staged replacement state, explicit confirmation/rejection, and a new-fingerprint requirement. The module never stores private identity keys, treats an archive as proof of the old identity, or grants trust automatically.

### Platform security contract

`service/src/platform` defines the platform-neutral adapters required by Android, iOS, Windows, macOS, and Linux: secure storage, local encryption, foreground permissions, and suspend/resume lifecycle. No OS-specific implementation or plaintext fallback was introduced.

### Group communication boundaries

`service/src/groups` defines independent group identity/membership records, epoch-scoped authorization, key-management adapters, and endpoint-encrypted group-call boundaries. Removed or unknown devices cannot authorize group changes. Existing one-to-one Vodozemac and call paths are not changed.

### Privacy hardening

`service/src/privacy` provides immutable privacy defaults (analytics, background capture, and external media disabled), validates those defaults, and requires explicit foreground user action before permissions become active. Permission release is tracked and delegated to the platform adapter.

## Frozen boundaries preserved

No Vodozemac or `CryptoSession` internals, message/mailbox formats, attachment encryption, media encryption, existing call encryption, or Phase 6B trust/lifecycle code were modified.

## Validation

- TypeScript service compilation: passed.
- New recovery, group, and privacy tests: 6 passed.
- Full Jest, ESLint, client build, npm audit, and `git diff --check` are run before the commit.

## Explicit limitations and dependencies

The approved Phase 6C package is itself marked design-only/not-ready for production implementation. This commit therefore supplies security boundaries and testable foundations, not a production recovery cipher/archive format, native OS adapters, an MLS implementation/profile, group-call SFrame/key schedule, or metadata-anonymity system. Those require the documented independent protocol/profile decisions and Phase 6B audit closure. No server recovery key, hidden trust authority, or protocol shortcut was added.
