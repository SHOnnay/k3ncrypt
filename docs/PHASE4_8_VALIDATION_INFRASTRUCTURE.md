# Phase 4.8 Validation Infrastructure

This repository now has a reproducible validation path for security and compatibility checks. It does not change product behavior, protocol defaults, cryptography, identity, mailbox, attachment/media encryption, or legacy handling.

## Local setup

```sh
git clone https://github.com/SHOnnay/k3ncrypt.git
cd k3ncrypt
npm ci
npx playwright install chromium firefox webkit
```

The browser suite starts its own backend and Vite processes. By default it uses isolated loopback ports `43101` (backend) and `43102` (client), refuses to reuse an existing server, and lets Playwright terminate both child processes. Override them only when a local service already occupies those ports:

```sh
PLAYWRIGHT_BACKEND_PORT=44101 PLAYWRIGHT_CLIENT_PORT=44102 npx playwright test
```

The client receives the isolated backend URL through `CHATE2EE_API_URL`; no production credentials or secrets are required.

## Full security command

```sh
./scripts/security-check
```

This runs Jest, service TypeScript, ESLint, the client production build, npm audit, Rust formatting/tests/clippy/WASM build, and the Chromium/Firefox/WebKit Playwright matrix. The script fails immediately if `cargo` is unavailable rather than silently skipping native validation.

Individual checks remain useful during development:

```sh
npm test
npx tsc --noEmit -p service/tsconfig.json
npm run lint
npm run client:build
npm audit --audit-level=high
npx playwright test --project=chromium
```

## Browser requirements

Playwright 1.59.x is pinned by the lockfile. The supported matrix is Chromium, Firefox, and WebKit. CI installs all three browser bundles. Headless mode is the default; set `PLAYWRIGHT_HEADED=true` for local visual debugging. A browser failure is not a reason to enable a security rollout; resolve the environment and rerun from clean isolated ports.

## Rust and WASM requirements

`crypto-wasm/rust-toolchain.toml` pins Rust `1.89.0`, `rustfmt`, `clippy`, and the `wasm32-unknown-unknown` target. The reproducible checks are:

```sh
cargo fmt --manifest-path crypto-wasm/Cargo.toml --check
cargo test --manifest-path crypto-wasm/Cargo.toml
cargo clippy --manifest-path crypto-wasm/Cargo.toml --all-targets -- -D warnings
cargo build --manifest-path crypto-wasm/Cargo.toml --target wasm32-unknown-unknown --release
```

The WASM package consumed by the client must be generated through the repository's pinned build process when source changes are made. Rust tests are not considered passed when `cargo` is missing.

## CI readiness

`.github/workflows/security-check.yml` uses Node 22, installs from the lockfile, installs all browsers, provisions Rust 1.89.0 and the WASM target, and runs the single security command. It has read-only repository permissions and no production credentials.

## Troubleshooting

- `EADDRINUSE`: do not start the app manually. Stop stale dev servers or choose unused `PLAYWRIGHT_*_PORT` values; the Playwright config does not reuse existing servers.
- Backend startup failure: inspect the process output and ensure the selected backend port is reachable at `/api`.
- Browser executable missing: rerun `npx playwright install chromium firefox webkit` (CI uses `--with-deps`).
- `cargo` missing or wrong version: install Rustup, select the pinned toolchain, and run `rustup target add wasm32-unknown-unknown`.
- Mongo-related tests: the security command unsets `MONGO_URI` and `MONGO_DB_NAME` so the deterministic test database path is used.
- Never add credentials, private keys, passphrases, or production URLs to test fixtures or CI variables.

## Validation status in this environment

- Chromium Vodozemac smoke flow: 3/3 passed using the isolated ports.
- Chromium modern-conversation flow: still fails during private-contact creation; this is an application-flow failure, not a port collision.
- Firefox startup: did not complete in the current desktop environment and was interrupted after the configured timeout window.
- WebKit: not accepted until Firefox startup and the full modern flow are resolved.
- Rust validation: unavailable here because `cargo` is not installed; CI will fail rather than silently skip it.
