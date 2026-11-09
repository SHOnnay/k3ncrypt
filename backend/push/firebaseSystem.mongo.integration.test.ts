import { randomBytes, randomUUID, createHash } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync, createWriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import type { Server } from 'http';
import express from 'express';
import type { Db } from 'mongodb';
import { applyWakeSchema, wakeSchemaReady, WAKE_SLOTS } from './durableWakeStore';
import { captureAdmittedWakeRoute } from './authenticatedWakeRoutes';
import { DurableDeviceTrustAuthority, MongoDeviceTrustStore } from '../security/durableDeviceTrust';
import { MongoPushStore, wakePayload } from './privateWake';
import { DurableWakeRuntime } from './durableWakeRuntime';
import { WakeDispatcher } from './wakeDispatcher';
import type { DeviceAuthorizationProof } from '../security/deviceTrust';

const uri = process.env.K3NCRYPT_TEST_MONGO_URI;
const suite = uri && process.env.K3NCRYPT_F1C_ANDROID === 'true' ? describe : describe.skip;
/** Opt-in heavyweight cross-runtime test. All extra endpoints exist only in this test process. */
suite('F1c actual Kotlin HTTP client / Node / disposable Mongo / fake FCM', () => {
  let server: Server; let database: Db; let directory: string;
  let storage: typeof import('../db')['default'];
  let localUrl: string;
  const previous = { ...process.env };
  const keys = ['MONGO_URI', 'MONGO_DB_NAME', 'K3NCRYPT_DEVICE_TRUST_PROOF_SECRET', 'K3NCRYPT_FCM_ENABLED', 'K3NCRYPT_FCM_PROJECT_ID', 'K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH'];
  beforeAll(async () => {
    const url = new URL(uri!); if (url.hostname !== '127.0.0.1') throw new Error('DISPOSABLE_LOOPBACK_DATABASE_REQUIRED');
    directory = mkdtempSync('/private/tmp/k3ncrypt-f1c-');
    // Not a service account, deliberately unusable as credentials. The injected provider is fake.
    const config = join(directory, 'not-provider-credentials.json'); writeFileSync(config, '{"testOnly":true}');
    Object.assign(process.env, { MONGO_URI: uri, MONGO_DB_NAME: `k3ncrypt_test_f1c_${randomUUID().replace(/-/g, '')}`,
      K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: randomBytes(32).toString('hex'), K3NCRYPT_FCM_ENABLED: 'true',
      K3NCRYPT_FCM_PROJECT_ID: 'synthetic-f1c-only', K3NCRYPT_FCM_SERVICE_ACCOUNT_PATH: config });
    // db captures its URI at import. No production app/server entrypoint is loaded.
    storage = (await import('../db')).default;
    await storage.connectDb(); database = storage.getDatabase()!;
    if (!database || !database.databaseName.startsWith('k3ncrypt_test_f1c_')) throw new Error('TEST_DATABASE_REQUIRED');
    process.env.K3NCRYPT_FCM_ENABLED = 'false';
    await applyWakeSchema(database); expect(await wakeSchemaReady(database)).toBe(true);
    process.env.K3NCRYPT_FCM_ENABLED = 'true';
    const authority = new DurableDeviceTrustAuthority(new MongoDeviceTrustStore(database), process.env.K3NCRYPT_DEVICE_TRUST_PROOF_SECRET!);
    const app = express(); app.use(express.json({ limit: '16kb' }));
    app.use('/api/device-trust', (await import('../api/deviceTrust')).default);
    app.post('/__f1c/mail-and-wake', async (req, res) => {
      let stage = 'proof';
      try {
        const proof = req.body.proof as DeviceAuthorizationProof;
        const admitted = await authority.verify(proof, 'relay:message', { conversationId: req.body.room });
        const room = req.body.room as string; const address = randomUUID();
        const control = randomBytes(32).toString('base64url'), renewal = randomBytes(32).toString('base64url');
        await database.collection('links').insertOne({ hash: room, deleted: false, expired: false, controlCapabilityHash: createHash('sha256').update(control).digest('hex') });
        await database.collection('prekey_bundles').insertOne({ channel: room, address, bundle: { identity: { ed25519: req.body.ed, curve25519: req.body.curve } }, expiresAt: new Date(Date.now() + 60000), renewalProofHash: createHash('sha256').update(`k3ncrypt-prekey-renewal-v1\0${renewal}`).digest('hex') });
        // This is the authenticated post-admission seam; not a claim of a full Android socket join.
        stage = 'route-capture';
        expect(await captureAdmittedWakeRoute(database, { account: admitted.accountIdentityReference, device: admitted.deviceId,
          epoch: admitted.trustEpoch, room, address, control, routingProof: renewal, current: () => true })).toBe(true);
        const provider = jest.fn(async (_token: string, data: ReturnType<typeof wakePayload>) => {
          expect(Object.keys(data).sort()).toEqual(['createdAt', 'eventId', 'expiresAt', 'type', 'version']);
          for (const forbidden of [room, address, admitted.accountIdentityReference, admitted.deviceIdentityReference]) expect(JSON.stringify(data)).not.toContain(forbidden);
          writeFileSync(join(directory, 'wake.json'), JSON.stringify(data));
        });
        const worker = new DurableWakeRuntime(database, new WakeDispatcher(new MongoPushStore(database), provider, () => true, wakePayload), () => true);
        const id = randomUUID();
        stage = 'mail-insert';
        await storage.storeOfflineMessage({ id, channel: room, mailbox: address, sender: randomUUID(), dedupeKey: randomUUID(), timestamp: Date.now(), expiresAt: new Date(Date.now() + 60000), envelope: { ciphertext: 'opaque-synthetic-test-envelope' } });
        // Optional enqueue hook is detached; explicit duplicate enqueue is safe and deterministic.
        await worker.enqueuePersisted(room, address, id);
        await database.collection('prekey_bundles').deleteMany({ channel: room });
        stage = 'wake-dispatch';
        await worker.runOnce(); expect(provider).toHaveBeenCalledTimes(1);
        stage = 'unauthorized-ack';
        expect(await storage.ackOfflineMessage(id, address, room, 'unauthorized-claim')).toBe(false);
        const pending = await storage.countOfflineMessages({ channel: room, mailbox: address });
        const outage = new DurableWakeRuntime(database, new WakeDispatcher(new MongoPushStore(database), async () => { throw Object.assign(new Error('synthetic'), { code: 'messaging/server-unavailable' }); }, () => true, wakePayload), () => true);
        stage = 'provider-outage';
        await outage.enqueuePersisted(room, address, id); await outage.runOnce();
        expect(await storage.countOfflineMessages({ channel: room, mailbox: address })).toBe(pending);
        expect(await database.collection(WAKE_SLOTS).countDocuments({ state: 'pending' })).toBe(1);
        // An authorized existing mailbox claim and matching ACK remain the only consumption evidence.
        stage = 'authorized-mailbox-claim-ack';
        const claimId = randomUUID();
        const claimed = await storage.claimOfflineMessage<{ id: string }>(address, room, new Date(Date.now() + 5000), claimId);
        expect(claimed?.id).toBe(id); expect(await storage.ackOfflineMessage(id, address, room, claimId)).toBe(true);
        res.send({ accepted: provider.mock.calls.length, mailStillPending: pending === 1, prematureAcks: 0, providerFailurePreservedMail: true });
      } catch { console.error(`F1C_FIXTURE_STAGE_FAILED:${stage}`); res.status(500).send({ error: 'F1C_FIXTURE_ASSERTION_FAILED' }); }
    });
    app.post('/__f1c/retired', async (req, res) => {
      res.send({ retired: !await database.collection('device_push_tokens_v1').findOne({ accountIdentityReference: req.body.account, deviceId: req.body.device }) });
    });
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('LOOPBACK_LISTEN_FAILED');
    localUrl = `http://127.0.0.1:${address.port}`;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (database?.databaseName.startsWith('k3ncrypt_test_f1c_')) await database.dropDatabase();
    await storage?.disconnectDb();
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  const gradle = (args: string[], logName: string): Promise<void> => new Promise((resolve, reject) => {
    const output = createWriteStream(`/private/tmp/${logName}.log`);
    const childEnv = { ...process.env };
    for (const key of keys) delete childEnv[key];
    const child = spawn('./gradlew', [...args, '--no-daemon', '--offline', '--console=plain'], {
      cwd: join(process.cwd(), 'android'), env: { ...childEnv, JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
        ANDROID_HOME: process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), K3NCRYPT_F1C_LOCAL_URL: localUrl, K3NCRYPT_F1C_WAKE_FIXTURE: join(directory, 'wake.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(output); child.stderr.pipe(output);
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, 540000);
    child.once('error', (error) => { clearTimeout(timer); output.end(); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); output.end(); code === 0 ? resolve() : reject(new Error(`F1C_GRADLE_FAILED_${logName}: exit ${code}; inspect sanitized test log`)); });
  });
  test('actual Kotlin API accepts signed bootstrap/register/rotate/remove and rejects replay/stale epoch', async () => {
    await gradle([':network:testDebugUnitTest', '--tests', 'com.k3ncrypt.network.FirebaseF1cContractTest'], 'k3ncrypt-f1c-kotlin-http');
  }, 600000);
  test('actual Kotlin wake policy accepts F1b payload and gates unlock/replay consumption', async () => {
    await gradle([':app:testPrivateDiagnosticsUnitTest', '--tests', 'com.k3ncrypt.app.FirebaseF1cWakeContractTest'], 'k3ncrypt-f1c-kotlin-wake');
  }, 600000);
});
