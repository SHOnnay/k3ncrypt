#!/usr/bin/env bash
# Runs every real-Mongo Jest suite against disposable loopback containers. Never Atlas.
#  - k3n-test-rs: single-node replica set (transactions) with ttlMonitorSleepSecs=1, so TTL
#    deletions happen within seconds instead of the 60s default.
#  - k3ncrypt-file-transfer-tests: the container fileLedger.mongo.test.ts restarts by name.
# Usage: bash scripts/test-mongo.sh [--keep]   (--keep leaves the containers running)
set -u
RS=k3n-test-rs; RS_PORT="${K3NCRYPT_TEST_RS_PORT:-27118}"
FILE=k3ncrypt-file-transfer-tests; FILE_PORT="${K3NCRYPT_TEST_FILE_PORT:-27119}"

ping() { docker exec "$1" mongosh --port "$2" --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; }
wait_for() { for _ in $(seq 1 60); do ping "$1" "$2" && return 0; sleep 1; done; echo "Mongo $1 did not start" >&2; exit 1; }

docker rm -f "$RS" "$FILE" >/dev/null 2>&1
docker run -d --name "$RS" -p "127.0.0.1:$RS_PORT:$RS_PORT" --tmpfs /data/db:size=2g mongo:8.0 \
  --port "$RS_PORT" --replSet rs0 --bind_ip_all --setParameter ttlMonitorSleepSecs=1 >/dev/null
docker run -d --name "$FILE" -p "127.0.0.1:$FILE_PORT:27017" mongo:8.0 >/dev/null
wait_for "$RS" "$RS_PORT"; wait_for "$FILE" 27017
docker exec "$RS" mongosh --port "$RS_PORT" --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:$RS_PORT'}]}).ok" >/dev/null
until docker exec "$RS" mongosh --port "$RS_PORT" --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; do sleep 1; done

URI="mongodb://127.0.0.1:$RS_PORT/?replicaSet=rs0"
SECRET="$(openssl rand -base64 32)"
status=0
run() { local label=$1; shift; local db=$1; shift
  echo "== $label"
  env NODE_ENV=test K3NCRYPT_DEVICE_TRUST_PROOF_SECRET="$SECRET" MONGO_URI="$URI" MONGO_DB_NAME="$db" \
    K3NCRYPT_ROUTING_MONGO_URI="$URI" K3NCRYPT_ATTACHMENT_TRUST_MONGO_URI="$URI" K3NCRYPT_FILE_READ_MONGO_URI="$URI" \
    K3NCRYPT_RETENTION_MONGO_URI="$URI" K3NCRYPT_FILE_MONGO_PORT="$FILE_PORT" \
    npx jest "$@" --runInBand --forceExit --coverage=false --silent 2>&1 | grep -E '^(Tests:|FAIL )'
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
}
run 'database, device trust, private network' k3ncrypt_playwright_mongo backend/db/mongo.integration backend/security/durableDeviceTrust.mongo backend/privateNetwork/membershipSecurity.mongo
run 'web lifecycle TTL' k3ncrypt_playwright_lifecycle_mongo backend/db/webLifecycle.mongo
run 'routing ownership and clock skew' k3ncrypt_playwright_routing backend/security/routingOwnership.mongo backend/security/lifecycleClockSkew.mongo
run 'attachments' k3ncrypt_playwright_attachments backend/attachments/attachmentRevocation.mongo backend/attachments/fileRead.mongo backend/attachments/fileLedger.mongo
run 'retention TTL' k3ncrypt_playwright_retention backend/db/retention.mongo
run 'storage caps' k3ncrypt_playwright_caps backend/db/storageCaps.mongo

[ "${1:-}" = "--keep" ] || docker rm -f "$RS" "$FILE" >/dev/null 2>&1
exit "$status"
