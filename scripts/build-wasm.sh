#!/usr/bin/env bash
# M3k: build the browser crypto WASM in a pinned, disposable container and compare it with the
# committed artifact. Pins: rust:1.89.0 (crate, per rust-toolchain.toml), wasm-pack 0.15.0 (built
# with Rust 1.91.0 because it needs it), wasm-bindgen-cli 0.2.128, release profile, wasm-opt as run
# by wasm-pack. Output goes to a temp dir; the committed crypto-wasm/pkg is never modified.
# Usage: bash scripts/build-wasm.sh [output-dir]
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$(mktemp -d /tmp/k3n-wasm.XXXXXX)}"; SRC="$(mktemp -d /tmp/k3n-wasm-src.XXXXXX)"
git -C "$ROOT" archive HEAD crypto-wasm | tar -x -C "$SRC"
docker run --rm -v "$SRC/crypto-wasm:/src:ro" -v "$OUT:/out" rust:1.89.0 bash -c '
  set -e; cp -r /src /build; cd /build
  rustup toolchain install 1.91.0 --profile minimal >/dev/null 2>&1
  cargo +1.91.0 install wasm-pack --version 0.15.0 --locked >/dev/null 2>&1
  cargo +1.91.0 install wasm-bindgen-cli --version 0.2.128 --locked >/dev/null 2>&1
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1
  wasm-pack build --target web --release --out-dir /out --out-name k3ncrypt_vodozemac >/dev/null 2>&1'
rm -rf "$SRC"
for f in k3ncrypt_vodozemac_bg.wasm k3ncrypt_vodozemac.js k3ncrypt_vodozemac.d.ts k3ncrypt_vodozemac_bg.wasm.d.ts; do
  a=$(shasum -a 256 "$ROOT/crypto-wasm/pkg/$f" | cut -d' ' -f1); b=$(shasum -a 256 "$OUT/$f" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "same     $f" || echo "DIFFERS  $f  committed=${a:0:16} rebuilt=${b:0:16}"
done
echo "output: $OUT"
