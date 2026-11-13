#!/usr/bin/env bash
# Release gate: the two-browser specs that must be green before any deploy. Each spec gets a fresh relay (production
# rate limits stay on), with the relay in its production routing mode. Uses the native disposable MongoDB on Windows
# (scripts/local-mongo.ps1) or any loopback Mongo given in PLAYWRIGHT_MONGO_URI. Never Atlas.
#   bash scripts/e2e-gate.sh            one pass
#   bash scripts/e2e-gate.sh 3          three passes in a row (the gate for a release)
set -u
cd "$(dirname "$0")/.."
PASSES="${1:-1}"
SPECS="golden-path modern-conversation check-contact file-trust-gate conversation-archive pending-invitation-ui unlock-progress
remove-contact unread-persistence first-call call-usability call-after-switch call-history call-wake"
export PLAYWRIGHT_MONGO_URI="${PLAYWRIGHT_MONGO_URI:-mongodb://127.0.0.1:27117/?directConnection=true}"
export PLAYWRIGHT_DURABLE_ROUTING=true
if command -v powershell >/dev/null 2>&1 && [ -f scripts/local-mongo.ps1 ]; then powershell -NoProfile -File scripts/local-mongo.ps1 start >/dev/null; fi
# A local .env would leak developer settings into the test relay.
[ -f .env ] && mv .env .env.gate-aside
trap '[ -f .env.gate-aside ] && mv .env.gate-aside .env' EXIT
status=0
for pass in $(seq 1 "$PASSES"); do
  failed=""
  for name in $SPECS; do
    if npx playwright test "e2e/$name.spec.ts" --project=chromium --workers=1 --timeout=120000 --reporter=line >"test-results-gate-$name.log" 2>&1; then
      rm -f "test-results-gate-$name.log"
    else failed="$failed $name"; fi
  done
  if [ -z "$failed" ]; then echo "pass $pass: GREEN"; else echo "pass $pass: RED -$failed"; status=1; fi
done
exit "$status"
