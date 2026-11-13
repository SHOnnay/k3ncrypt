#!/usr/bin/env bash
# The shared protocol fixtures are the contract between web/relay (this repo) and Android (private repo). Both test
# suites read their own copy, so the copies must be identical. Run before any release of either side.
#   bash scripts/check-fixtures.sh [path-to-android-repo]      (default: ../k3ncrypt-android)
#   bash scripts/check-fixtures.sh --sync [path]               copy this repo's fixtures over the Android copy
set -eu
cd "$(dirname "$0")/.."
sync=0; if [ "${1:-}" = "--sync" ]; then sync=1; shift; fi
other="${1:-../k3ncrypt-android}"
[ -d "$other/protocol-fixtures" ] || { echo "No protocol-fixtures in $other"; exit 2; }
if [ "$sync" = 1 ]; then cp -R protocol-fixtures/. "$other/protocol-fixtures/"; fi
if diff -rq protocol-fixtures "$other/protocol-fixtures"; then echo "fixtures identical"; else echo "FIXTURES DIFFER"; exit 1; fi
