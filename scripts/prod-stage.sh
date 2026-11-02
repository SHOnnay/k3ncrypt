#!/usr/bin/env bash
# Disposable LOCAL production stage: the real production build (NODE_ENV=production, every
# production config check on) behind a throwaway HTTPS proxy, with Mongo in Docker.
# Loopback only. Never Atlas, never Render. Usage: bash scripts/prod-stage.sh <test command...>
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d /tmp/k3n-prod-stage.XXXXXX)"
MONGO=k3n-prod-stage-mongo; MONGO_PORT=27121; APP_PORT=43501; HTTPS_PORT=43543
ORIGIN="https://csp.localhost:$HTTPS_PORT"

cleanup() { kill "${APP_PID:-}" "${PROXY_PID:-}" 2>/dev/null; docker rm -f "$MONGO" >/dev/null 2>&1; rm -rf "$STAGE"; }
trap cleanup EXIT

docker rm -f "$MONGO" >/dev/null 2>&1
docker run -d --name "$MONGO" -p "127.0.0.1:$MONGO_PORT:$MONGO_PORT" --tmpfs /data/db:size=1g mongo:8.0 --port "$MONGO_PORT" --replSet rs0 --bind_ip_all >/dev/null
until docker exec "$MONGO" mongosh --port "$MONGO_PORT" --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; do sleep 1; done
docker exec "$MONGO" mongosh --port "$MONGO_PORT" --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:$MONGO_PORT'}]}).ok" >/dev/null
until docker exec "$MONGO" mongosh --port "$MONGO_PORT" --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; do sleep 1; done

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$STAGE/key.pem" -out "$STAGE/cert.pem" -days 1 \
  -subj '/CN=csp.localhost' -addext 'subjectAltName=DNS:csp.localhost' >/dev/null 2>&1

cd "$ROOT"
export NODE_ENV=production PORT=$APP_PORT K3NCRYPT_BIND_HOST=127.0.0.1 \
  MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT/?replicaSet=rs0" MONGO_DB_NAME=k3ncrypt_prod_stage \
  K3NCRYPT_ALLOWED_ORIGINS="$ORIGIN" CHAT_LINK_DOMAIN="$ORIGIN" K3NCRYPT_TRUST_PROXY=true \
  K3NCRYPT_DURABLE_ROUTING=true K3NCRYPT_DEVICE_TRUST_PROOF_SECRET="$(openssl rand -hex 32)"
node dist/scripts/migrate.js >/dev/null
node dist/index.js >"$STAGE/app.log" 2>&1 & APP_PID=$!
STAGE_KEY="$STAGE/key.pem" STAGE_CERT="$STAGE/cert.pem" HTTPS_PORT=$HTTPS_PORT APP_PORT=$APP_PORT \
  node "$ROOT/scripts/prod-stage-proxy.cjs" >"$STAGE/proxy.log" 2>&1 & PROXY_PID=$!
for _ in $(seq 1 60); do curl -ksf "$ORIGIN/api/ready" --resolve "csp.localhost:$HTTPS_PORT:127.0.0.1" >/dev/null && break; sleep 1; done
curl -ksf "$ORIGIN/api/ready" --resolve "csp.localhost:$HTTPS_PORT:127.0.0.1" >/dev/null || { echo 'stage not ready'; tail -20 "$STAGE/app.log"; exit 1; }

K3NCRYPT_STAGE_ORIGIN="$ORIGIN" "$@"
