# Dependency security

Audit date: 2026-09-17.

## Result

`npm audit` reports **0 known advisories** after targeted upgrades and overrides. `npm audit --omit=dev` also reports **0 production advisories**. This is a time-sensitive snapshot, not a guarantee.

## Remediation

- Removed dormant `form-data`, `node-fetch`, and `uuid` dependencies with the plaintext image-upload code.
- Replaced server identifiers with Node `crypto.randomUUID()`.
- Upgraded Express and Socket.IO.
- Pinned patched compatible Engine.IO, Engine.IO client, Socket.IO adapter/parser, and `ws` transitive versions.
- Ran non-breaking `npm audit fix` for development tooling.
- Upgraded Vite and its React plugin, then pinned patched `esbuild 0.28.2` in both workspaces.
- Removed obsolete `@types/socket.io`; Socket.IO ships its own types.
- Kept `cross-env` in development dependencies.

No `npm audit fix --force` was used.

## Operational policy

CI should run both `npm audit --omit=dev` (release gate) and full `npm audit` (toolchain visibility), review lockfile diffs, and test upgrades before release. Overrides are temporary compatibility controls and should be removed when direct dependency ranges naturally select the fixed versions.

