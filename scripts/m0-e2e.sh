#!/usr/bin/env bash
# Local-only E2E baseline. Uses a disposable loopback MongoDB replica set in Docker.
# Each spec gets a fresh backend because production HTTP rate limits are per IP
# and must stay enabled; a shared backend turns parallel specs into 429 failures.
# Never point this at Atlas: playwright.config.ts refuses non-loopback Mongo hosts.
set -u
PORT="${K3NCRYPT_M0_MONGO_PORT:-27117}"
NAME=k3n-m0-mongo
OUT="${K3NCRYPT_M0_OUT:-test-results/m0}"
PROJECT="${K3NCRYPT_M0_PROJECT:-chromium}"
mkdir -p "$OUT"

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:27017" --tmpfs /data/db:size=2g mongo:8.0 --replSet rs0 --bind_ip_all >/dev/null
  until docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; do sleep 1; done
  docker exec "$NAME" mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}).ok' >/dev/null
  sleep 3
fi

export PLAYWRIGHT_MONGO_URI="mongodb://127.0.0.1:$PORT/?directConnection=true"
specs=("$@")
[ ${#specs[@]} -eq 0 ] && specs=(e2e/*.spec.ts)
status=0
for spec in "${specs[@]}"; do
  name="$(basename "$spec" .spec.ts)"
  npx playwright test "$spec" --project="$PROJECT" --workers=1 --timeout=90000 \
    --reporter=json --output="$OUT/artifacts/$name" >"$OUT/$name.json" 2>"$OUT/$name.err"
  code=$?
  node -e '
    const fs=require("fs");const n=process.argv[1];let r;
    try{r=JSON.parse(fs.readFileSync(process.argv[2],"utf8"))}catch{console.log(`CRASH   ${n}`);process.exit()}
    const s=r.stats;console.log(`${s.unexpected?"FAIL":"ok  "}    ${n}  pass=${s.expected} fail=${s.unexpected} skip=${s.skipped} flaky=${s.flaky}`)
  ' "$name" "$OUT/$name.json"
  [ "$code" -eq 0 ] || status=1
done
exit "$status"
