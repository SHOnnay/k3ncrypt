# Local development

## Requirements

- Node.js 22.12 or newer.
- npm.
- MongoDB for durable lifecycle, membership, and persistence tests.
- Docker Desktop or Docker Engine for the container workflow.

## Environment

Copy `.env.sample` for local development. Production deployments should start from `.env.production.sample` and provide `MONGO_URI`, `MONGO_DB_NAME`, `CHAT_LINK_DOMAIN`, `K3NCRYPT_ALLOWED_ORIGINS`, `K3NCRYPT_TRUST_PROXY`, and a randomly generated `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET` of at least 32 characters. Never commit a real secret.

The client uses `CHATE2EE_API_URL`, `CHATE2EE_ICE_SERVERS`, `CHATE2EE_ICE_TRANSPORT_POLICY`, and `CHATE2EE_ENABLE_DEBUG_LOGS`. The backend uses `PORT` and the Mongo/configuration variables above.

The browser vault always requires the normal local passphrase unlock. There is no development auto-unlock or passphrase-resume shortcut. Keep local account data in a dedicated development browser profile and do not store passphrases in environment files or browser storage.

## Commands

```sh
npm install
npm run build-service-sdk
npm run dev
npm test -- --runInBand
npm run lint
npm run client:build
npm audit
```

For durable integration tests:

```sh
MONGO_URI=mongodb://localhost:27017 MONGO_DB_NAME=k3ncrypt \
  npx jest backend/security/durableDeviceTrust.mongo.integration.test.ts --runInBand
```

## Docker

The repository includes `docker/Dockerfile`, `docker/backend.Dockerfile`, `docker/frontend.Dockerfile`, and `docker/docker-compose.yaml`. Use the sample environment file and keep database credentials outside source control.

## Same-LAN video interoperability

For a local Web-to-Android call test, use a dedicated MongoDB database and keep its published port on loopback. Do not use production data or the broadly published `docker-compose.phase3h.yml` Mongo port for this test. A suitable local environment uses the existing `MONGO_URI`, `MONGO_DB_NAME`, `K3NCRYPT_DEVICE_TRUST_PROOF_SECRET`, `PORT`, and `K3NCRYPT_ALLOWED_ORIGINS` variables. Keep them in the ignored root `.env` file; the development API binds only to `127.0.0.1`.

Run `npm run local-video-interop:tls` on the Mac while connected to the test Wi-Fi with VPN disabled. It creates short-lived TLS files under ignored `android/app/build/`, writes the Android LAN HTTPS origin to ignored `client/.env.local`, configures the Mac Web dev server in ignored `client/.env.development.local` to reach the backend over loopback HTTP, and stages the public development CA plus a network-security resource scoped to the detected LAN host under the ignored Android build directory. CA and server private keys stay under `android/app/build/local-video-interop/`.

Start `npm run dev` for the Web client and loopback backend, then run `npm run local-video-interop:proxy` in another terminal. The HTTPS proxy binds only to the detected LAN address and forwards to `127.0.0.1:3001`; MongoDB remains loopback-only. Build the debug app with the generated origin:

```sh
INTEROP_ORIGIN="$(cat android/app/build/local-video-interop/origin)"
cd android
./gradlew :app:assembleDebug --no-daemon \
  -Pk3ncryptLocalVideoInterop=true \
  -Pk3ncryptBackendUrl="$INTEROP_ORIGIN" \
  -Pk3ncryptSocketUrl="$INTEROP_ORIGIN"
```

The generated CA is trusted only by that debug build for the detected LAN host. The normal debug configuration retains only system trust and the existing emulator-only HTTP exception. Release manifests do not reference either development network-security resource. This setup does not change release TLS settings or deploy anything.

The Mac browser uses the loopback backend endpoint and does not need to trust the development CA. The Android debug app receives the matching public CA in its debug-only resources; it does not require disabling certificate checks or installing a device-wide CA. Re-run the TLS setup and rebuild the debug APK if the Mac's Wi-Fi address changes. Delete the ignored generated files when testing is finished.
