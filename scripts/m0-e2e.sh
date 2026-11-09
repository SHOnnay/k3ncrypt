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

# Windows without Docker: start the native disposable Mongo (scripts/local-mongo.ps1, default 127.0.0.1:27117)
# and run this script with K3NCRYPT_M0_NATIVE_MONGO=1. The Docker path below is unchanged.
if [ "${K3NCRYPT_M0_NATIVE_MONGO:-}" = "1" ]; then
  :
elif ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:27017" --tmpfs /data/db:size=2g mongo:8.0 --replSet rs0 --bind_ip_all >/dev/null
  until docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; do sleep 1; done
  docker exec "$NAME" mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}).ok' >/dev/null
  sleep 3
fi

if [ "${K3NCRYPT_M0_NATIVE_MONGO:-}" = "1" ]; then PORT="${K3NCRYPT_M0_MONGO_PORT:-27117}"; fi
export PLAYWRIGHT_MONGO_URI="mongodb://127.0.0.1:$PORT/?directConnection=true"
specs=("$@")
[ ${#specs[@]} -eq 0 ] && specs=(e2e/*.spec.ts)
status=0
# Specs that create many rooms exceed the production per-IP room-creation limit (20 burst,
# 1 per 4 s) when all their tests share one server; they get a fresh server per test.
SPLIT="${K3NCRYPT_M0_SPLIT:-file-usability}"
for spec in "${specs[@]}"; do
  name="$(basename "$spec" .spec.ts)"
  # Each entry is "spec|title-regex"; an empty regex means the whole spec.
  targets=("$spec|")
  if [[ " $SPLIT " == *" $name "* ]]; then
    targets=()
    while IFS= read -r line; do targets+=("$spec|$line"); done < <(npx playwright test "$spec" --project="$PROJECT" --list 2>/dev/null \
      | grep -E "› $name\.spec\.ts:" | sed -E 's/^.*\.spec\.ts:[0-9]+:[0-9]+ › //' | sort -u \
      | python3 -c 'import re,sys; [print("^.*" + re.escape(l.rstrip("\n")) + "$") for l in sys.stdin]')
  fi
  code=0; parts=(); index=0
  for target in "${targets[@]}"; do
    file="${target%%|*}"; title="${target#*|}"; index=$((index + 1))
    part="$OUT/$name.part$index.json"
    if [ -n "$title" ]; then set -- -g "$title"; else set --; fi
    npx playwright test "$file" "$@" --project="$PROJECT" --workers=1 --timeout=90000 \
      --reporter=json --output="$OUT/artifacts/$name" >"$part" 2>"$OUT/$name.err" || code=1
    parts+=("$part")
  done
  node -e '
    const fs=require("fs");const [out,...parts]=process.argv.slice(1);const merged={suites:[],stats:{expected:0,unexpected:0,skipped:0,flaky:0}};
    for(const p of parts){try{const r=JSON.parse(fs.readFileSync(p,"utf8"));merged.suites.push(...r.suites);for(const k in merged.stats)merged.stats[k]+=r.stats[k]??0}catch{}}
    fs.writeFileSync(out,JSON.stringify(merged));
  ' "$OUT/$name.json" "${parts[@]}"
  node -e '
    const fs=require("fs");const n=process.argv[1];let r;
    try{r=JSON.parse(fs.readFileSync(process.argv[2],"utf8"))}catch{console.log(`CRASH   ${n}`);process.exit()}
    const s=r.stats;console.log(`${s.unexpected?"FAIL":"ok  "}    ${n}  pass=${s.expected} fail=${s.unexpected} skip=${s.skipped} flaky=${s.flaky}`)
  ' "$name" "$OUT/$name.json"
  [ "$code" -eq 0 ] || status=1
done
exit "$status"
