import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { connectedPair } from './usabilityHelpers';

/**
 * The relay restarts in the middle of a call [two-browser E2E]. Reproduces 2026-11-16 04:56Z: Alice called Bob's closed
 * app, the relay was replaced while she waited, Bob's device reached the new relay first, and Alice waited forever.
 * Relay memory (rooms, subscriptions, waiters) is lost on restart; the database survives, as in production.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const passphrase = 'alpha-family-existing-account-2026';
const api = 'http://127.0.0.1:43451', client = 'http://127.0.0.1:43452';
const mongoUri = process.env.PLAYWRIGHT_MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const legacy = process.env.K3NCRYPT_RESTART_TEST_LEGACY === 'true';

async function comeBack(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
}

test('a relay restart while the caller waits: the contact comes back first, and the call still rings and connects', async ({ browser }) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(mongoUri).hostname)) throw new Error('Loopback Mongo only');
  const databaseName = 'k3ncrypt_playwright_restart_' + randomUUID().replace(/-/g, '');
  const secret = randomBytes(32).toString('base64url');
  let relay: ChildProcess | undefined;
  const start = async () => {
    relay = spawn(process.execPath, ['-r', 'ts-node/register', 'index.ts'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env,
      NODE_ENV: 'test', PORT: '43451', K3NCRYPT_BIND_HOST: '127.0.0.1', MONGO_URI: mongoUri, MONGO_DB_NAME: databaseName,
      K3NCRYPT_ALLOWED_ORIGINS: client, K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: secret, K3NCRYPT_TEST_ONLY_DIAGNOSTICS: 'true', K3NCRYPT_FCM_ENABLED: 'false', K3NCRYPT_DURABLE_ROUTING: 'true',
      ...(legacy ? {} : { K3NCRYPT_MUX_MESSAGE_DELIVERY: 'true', K3NCRYPT_TEST_MUX_SUBSCRIPTION_LEASE_MS: '90000' }) } });
    await expect.poll(async () => { if (relay?.exitCode !== null) throw new Error('relay exited'); try { return (await fetch(api + '/api/ready')).status; } catch { return 0; } }, { timeout: 60_000 }).toBe(200);
  };
  // A hard kill, as when a platform replaces the instance: nothing is flushed or said goodbye to.
  const kill = async () => { if (relay && relay.exitCode === null) { const child = relay; const gone = new Promise<void>((r) => child.once('exit', () => r())); child.kill('SIGKILL'); await gone; } relay = undefined; };
  await start();
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    for (const [from, to, text] of [[alice, bob, 'warm up one'], [bob, alice, 'warm up two']] as const) {
      await from.locator('#msg-input').fill(text); await from.locator('#send-btn').click();
      await expect(to.locator('#messages-area')).toContainText(text, { timeout: 30_000 });
    }
    // Alice's relay traffic passes through a gate. Playwright only routes sockets of pages loaded after the route, so
    // the gate goes in first and Alice reloads (she is still unlocked into the same chat).
    let blocked = false; let blockedAttempts = 0; let reopened = false; let rejoinedAt: number | undefined;
    await alice.routeWebSocket(/\/socket\.io\//, (ws) => { if (blocked) { blockedAttempts += 1; void ws.close(); return; } const server = ws.connectToServer();
      const debug = (dir: string, m: string | Buffer) => { if (process.env.RESTART_DEBUG && typeof m === 'string') { const e = m.match(/^4[23]\d*\[?"?([a-z-]*)/); if (e) console.log(`${Date.now() % 100000} ALICE${dir} ${e[1] || 'ack'}`); } };
      ws.onMessage((m) => { debug('>', m); if (rejoinedAt === undefined && reopened && typeof m === 'string' && /^42\d*\["(mux-subscribe|chat-join)"/.test(m)) rejoinedAt = Date.now(); server.send(m); }); server.onMessage((m) => { debug('<', m); ws.send(m); }); });
    await alice.route(/\/socket\.io\//, (route) => { if (blocked) { blockedAttempts += 1; return route.abort(); } return route.continue(); });
    await comeBack(alice);
    await bob.goto('about:blank');
    await alice.waitForTimeout(2_000);
    await alice.getByRole('button', { name: 'Calls', exact: true }).click();
    await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
    await expect(alice.locator('#call-status')).toHaveText('Calling… their phone may need to wake', { timeout: 15_000 });

    // The relay is replaced. Alice cannot reach the new relay until Bob's device is back on it, as the phone was.
    blocked = true;
    await kill();
    await start();
    await comeBack(bob);
    await bob.waitForTimeout(5_000);
    expect(blockedAttempts).toBeGreaterThan(0); // Alice really tried to reconnect and was held back.
    reopened = true; blocked = false;

    await bob.getByRole('button', { name: 'Accept call', exact: true }).waitFor({ state: 'visible', timeout: 45_000 });
    // Alice's own rejoin must release her wait. Without that, only a later, unrelated resubscription by Bob's web client
    // (about 10 s on) rescued the call; a phone does not do that, and the call was lost in production.
    expect(rejoinedAt).toBeDefined();
    expect(Date.now() - rejoinedAt!).toBeLessThan(6_000);
    await bob.getByRole('button', { name: 'Accept call', exact: true }).click();
    await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 60_000 });
    await alice.getByRole('button', { name: 'End call', exact: true }).click();
  } finally {
    await a.close(); await b.close(); await kill();
    const mongo = await new MongoClient(mongoUri).connect(); await mongo.db(databaseName).dropDatabase(); await mongo.close();
  }
});
