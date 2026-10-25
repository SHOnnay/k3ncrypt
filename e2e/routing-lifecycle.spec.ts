import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { create, invite } from './usabilityHelpers';

const uri = process.env.K3NCRYPT_ROUTING_MONGO_URI;
const base = 'http://127.0.0.1:43432', api = 'http://127.0.0.1:43431';
const passphrase = 'alpha-family-existing-account-2026';
const DAY = 86400000;
test.describe('persistent authenticated routing lifecycle', () => {
  test.skip(!uri, 'Requires explicitly configured disposable loopback MongoDB');
  const cases = [...[0, 4, 5, 7, 8, 15, 30].map(days => ({ days, mixedAdoption: false, replacementRecovery: false })), { days: 0, mixedAdoption: true, replacementRecovery: false }, { days: 8, mixedAdoption: false, replacementRecovery: true }];
  for (const { days, mixedAdoption, replacementRecovery } of cases) test(replacementRecovery ? 'replacement room retains both existing identities and original verified records after legacy ownership loss' : mixedAdoption ? 'one peer adopts while the other stays offline; no false acceptance before both adopt' : `verified conversation after ${days} days, real TTL, process and backend restart`, async () => {
    if (!uri || new URL(uri).hostname !== '127.0.0.1') throw new Error('Loopback Mongo only');
    const directory = await mkdtemp('/private/tmp/k3ncrypt-routing-clock-');
    const clockFile = directory + '/offset'; await writeFile(clockFile, '0');
    const databaseName = 'k3ncrypt_playwright_routing_' + randomUUID().replace(/-/g, '');
    const mongo = await new MongoClient(uri).connect(), database = mongo.db(databaseName);
    const secret = randomBytes(32).toString('base64url');
    let server: ChildProcess | undefined; let a: BrowserContext | undefined, b: BrowserContext | undefined;
    let clockOffset = 0, routingEnabled = !mixedAdoption && !replacementRecovery;
    let deniedBeforePeerAdoption = 0;
    const stop = async () => { if (server && server.exitCode === null) { const child = server; const done = new Promise<void>(r => child.once('exit', () => r())); child.kill('SIGTERM'); await done; } server = undefined; };
    const start = async () => {
      const occupied = await fetch(api + '/api/ready').then(() => true, () => false);
      if (occupied) throw new Error('Disposable backend port is already occupied; refusing another revision or database');
      server = spawn(process.execPath, ['-r', resolve('e2e/support/routing-clock.cjs'), '-r', 'ts-node/register', 'index.ts'], {
        cwd: process.cwd(), stdio: 'ignore', env: { PATH: process.env.PATH, LANG: 'C', NODE_ENV: 'test', PORT: '43431', K3NCRYPT_BIND_HOST: '127.0.0.1',
          MONGO_URI: uri, MONGO_DB_NAME: databaseName, K3NCRYPT_ALLOWED_ORIGINS: base, K3NCRYPT_ROUTING_TEST_CLOCK: clockFile,
          K3NCRYPT_DEVICE_TRUST_PROOF_SECRET: secret, K3NCRYPT_DURABLE_ROUTING: String(routingEnabled), K3NCRYPT_TEST_ONLY_DIAGNOSTICS: 'true',
          K3NCRYPT_FCM_ENABLED: 'false', ...(process.env.K3NCRYPT_ROUTING_TEST_MUX === 'true' ? { K3NCRYPT_MUX_MESSAGE_DELIVERY: 'true' } : {}) },
      });
      await expect.poll(async () => { if (server?.exitCode !== null) throw new Error('Disposable backend exited'); try { return (await fetch(api + '/api/ready')).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
    };
    const context = async (name: string) => {
      const context = await chromium.launchPersistentContext(directory + '/' + name, { headless: true, baseURL: base });
      await context.addInitScript(({ offset }) => {
        const Original = Date;
        globalThis.Date = class extends Original {
          constructor(...args: any[]) { if (!args.length) super(Original.now() + offset); else super(args[0]); }
          static now() { return Original.now() + offset; }
        } as DateConstructor;
        (globalThis as any).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true;
      }, { offset: clockOffset });
      return context;
    };
    const close = async (context: BrowserContext) => { for (const page of context.pages()) await page.close({ runBeforeUnload: true }); await context.close(); };
    const select = async (page: Page, name: string) => { const row = page.locator('[aria-labelledby=sidebar-chats-heading] .conversation-row'); await expect(row).toHaveCount(1); await row.click(); await expect(page.locator('.chat-header')).toBeVisible(); };
    const unlock = async (context: BrowserContext, peer: string, openRoom = true) => {
      const page = context.pages()[0] ?? await context.newPage(); page.on('websocket', socket => socket.on('framereceived', frame => { const text = String(frame.payload); if (text.includes('Message could not be queued.') || text.includes('Multiplexed message rejected.')) deniedBeforePeerAdoption++; })); page.on('response', response => { if (!response.ok()) console.log('SAFE_HTTP', response.status(), new URL(response.url()).pathname.includes('/prekeys/') ? 'prekey' : 'other'); }); await page.goto(base);
      await page.getByRole('button', { name: 'Unlock this device' }).click(); await page.locator('input[type=password]').fill(passphrase);
      await page.getByRole('button', { name: 'Unlock account' }).click(); await expect(page.locator('.new-conversation')).toBeVisible(); if (openRoom) await select(page, peer); return page;
    };
    const send = async (page: Page, text: string) => { await page.locator('#msg-input').fill(text); await expect(page.locator('#send-btn')).toBeEnabled(); await page.locator('#send-btn').click(); try { await expect(page.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary')).toHaveText(/^(Sent|Delivered)$/, { timeout: 15000 }); } catch (error) {
      console.log('SAFE_SEND_STATE', await page.evaluate(async () => { const g = globalThis as any; const crypto = await g.__K3NCRYPT_ACTIVE_CRYPTO_DIAGNOSTICS__?.(); return { mux: g.__K3NCRYPT_MUX_SNAPSHOT__?.(), transport: g.__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?.(), inboundFailureCategory: crypto?.inboundFailureCategory, connectionFailureCategory: crypto?.connectionFailureCategory, flowStages: g.__k3ncryptMessageFlowEvents?.slice(-12).map((event: any) => event.stage) }; })); throw error;
    } };
    try {
      await start(); a = await context('alice'); b = await context('bob');
      let alice = a.pages()[0], bob = b.pages()[0];
      await create(alice, 'Alice'); await create(bob, 'Bob'); const link = await invite(alice);
      await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
      await bob.locator('#channel-hash').fill(link); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30000 }); await expect(bob.locator('.chat-header')).toContainText('Alice');
      const fingerprints: string[] = [], peerFingerprints: string[] = [];
      for (const page of [alice, bob]) {
        await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Security Your identity and contact verification', exact: true }).click();
        await expect(page.locator('.verification-code').first()).toHaveText(/K3 .+/);
        fingerprints.push((await page.locator('.verification-code').first().textContent()) ?? '');
        await expect(page.locator('.verification-code').last()).toHaveText(/K3 .+/);
        peerFingerprints.push((await page.locator('.verification-code').last().textContent()) ?? '');
        await page.getByRole('button', { name: 'Compare security code', exact: true }).click(); await page.getByRole('button', { name: 'Codes match', exact: true }).click();
        await page.getByRole('button', { name: 'Mark as verified', exact: true }).click(); await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
      }
      expect(peerFingerprints).toEqual([fingerprints[1], fingerprints[0]]);
      await send(alice, 'retained synthetic history'); await expect(bob.locator('#messages-area')).toContainText('retained synthetic history');
      await send(bob, 'baseline bidirectional confirmation'); await expect(alice.locator('#messages-area')).toContainText('baseline bidirectional confirmation');
      await expect.poll(() => database.collection('links').countDocuments({ 'routingOwners.1': { $exists: true } })).toBe(mixedAdoption || replacementRecovery ? 0 : 1);
      const mainRoom = await database.collection('links').findOne({ invitationPublications: 2 });
      expect(mainRoom).not.toBeNull();
      await close(a); a = undefined; await close(b); b = undefined; await stop();
      if (days === 8 && !replacementRecovery) {
        clockOffset = 6 * DAY; await writeFile(clockFile, String(clockOffset)); await start(); a = await context('alice'); alice = await unlock(a, 'Bob');
        await send(alice, 'queued before temporary prekey expiry');
        await expect.poll(() => database.collection('offline_messages').countDocuments({ state: 'active', timestamp: { $gte: Date.now() + clockOffset - 5000 } })).toBeGreaterThan(0);
        await close(a); a = undefined; await stop();
      }
      routingEnabled = true;
      clockOffset = days * DAY; await writeFile(clockFile, String(clockOffset));
      // Mongo's TTL monitor uses wall time. Backdate only temporary publications at the virtual expiry boundary,
      // then wait for actual server TTL deletion; routing/device documents are never fabricated or rewritten.
      if (days >= 7) {
        await database.collection('prekey_bundles').updateMany({}, { $set: { expiresAt: new Date(0) } });
        await expect.poll(() => database.collection('prekey_bundles').countDocuments(), { timeout: 10000 }).toBe(0);
      }
      if (replacementRecovery) {
        await start(); a = await context('alice'); b = await context('bob'); alice = await unlock(a, 'Bob', false); bob = await unlock(b, 'Alice', false);
        const oldSnapshot = (page: Page) => page.evaluate(async ({ roomId, passphrase, root }) => {
          const { BrowserSecureStorage } = await import(/* @vite-ignore */ root + '/service/src/storage/secureVault.ts');
          const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ root + '/service/src/storage/persistence.ts');
          const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
          try {
            const mode = JSON.parse(new TextDecoder().decode(await vault.read('conversation-protocol', roomId)));
            const contactBytes = await vault.read('contact-identity', mode.remoteAddress);
            const contact = JSON.parse(new TextDecoder().decode(contactBytes));
            const hashes = [];
            for (const [type, id] of [['contact-identity', mode.remoteAddress], ['vodozemac-session', roomId], ['product-messages', roomId]]) {
              const bytes = await vault.read(type, id); if (!bytes?.byteLength) throw new Error('Original retained record missing');
              hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''));
            }
            return { hashes, verification: contact.verification, unchanged: contact.changeStatus === 'unchanged' };
          } finally { vault.lock(); }
        }, { roomId: mainRoom!.hash as string, passphrase, root: '/@fs' + process.cwd() });
        await alice.locator('[aria-labelledby=sidebar-chats-heading] .conversation-row').click();
        await expect(alice.locator('body')).toContainText('CONVERSATION_ROUTING_AUTHORIZATION_UNAVAILABLE');
        const originals = [await oldSnapshot(alice), await oldSnapshot(bob)];
        expect(originals.every(record => record.verification === 'verified' && record.unchanged)).toBe(true);
        const replacement = await invite(alice);
        await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
        await bob.locator('#channel-hash').fill(replacement); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(alice.locator('.chat-header')).toContainText('Bob'); await expect(bob.locator('.chat-header')).toContainText('Alice');
        for (const [i, page] of [alice, bob].entries()) {
          await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Security Your identity and contact verification', exact: true }).click();
          await expect(page.locator('.verification-code').first()).toHaveText(fingerprints[i]);
          await expect(page.locator('.verification-code').last()).toHaveText(fingerprints[1 - i]);
          await expect(page.getByRole('button', { name: 'Mark as verified', exact: true })).toBeDisabled();
          await page.getByRole('button', { name: 'Compare security code', exact: true }).click(); await page.getByRole('button', { name: 'Codes match', exact: true }).click();
          await page.getByRole('button', { name: 'Mark as verified', exact: true }).click(); await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
        }
        await send(alice, 'new room explicitly verified'); await expect(bob.locator('#messages-area')).toContainText('new room explicitly verified');
        await send(bob, 'existing identity preserved'); await expect(alice.locator('#messages-area')).toContainText('existing identity preserved');
        expect(await oldSnapshot(alice)).toEqual(originals[0]); expect(await oldSnapshot(bob)).toEqual(originals[1]);
        expect((await database.collection('links').findOne({ hash: mainRoom!.hash }))!.routingOwners).toBeUndefined();
        expect(await database.collection('links').countDocuments({ 'routingOwners.1': { $exists: true } })).toBe(1);
        await expect(alice.locator('[aria-labelledby=sidebar-chats-heading] .conversation-row')).toHaveCount(2);
        console.log(JSON.stringify({ fixture: 'replacement-recovery', oldVerifiedRecordsUnchanged: true, sameLocalIdentities: true, newExplicitComparison: true, oldAuthorityNotRecreated: true, oldHistoryNotMerged: true }));
        return;
      }
      await start(); a = await context('alice'); alice = await unlock(a, 'Bob');
      await expect(alice.locator('#messages-area')).toContainText('retained synthetic history');
      await expect(alice.locator('.unavailable-conversation')).toHaveCount(0);
      if (mixedAdoption) {
        await expect.poll(async () => (await database.collection('links').findOne({ hash: mainRoom!.hash }))?.routingOwners?.length).toBe(1);
        await alice.locator('#msg-input').fill('synthetic message while peer browser closed'); await alice.locator('#send-btn').click();
        await expect.poll(() => deniedBeforePeerAdoption, { timeout: 15000 }).toBeGreaterThan(0);
        expect(await database.collection('offline_messages').countDocuments({ channel: mainRoom!.hash })).toBe(0);
        await expect(alice.locator('.message.sent').filter({ hasText: 'synthetic message while peer browser closed' }).locator('.message-delivery-details summary')).not.toHaveText(/^(Sent|Delivered)$/);
      } else {
        await send(alice, 'synthetic message while peer browser closed');
        try { await expect.poll(() => database.collection('offline_messages').countDocuments({ state: 'active', timestamp: { $gte: Date.now() + clockOffset - 5000 } }), { timeout: 10000 }).toBeGreaterThan(0); } catch (error) { console.log('SAFE_FAILED_SEND', await alice.evaluate(async () => { const hook = (globalThis as any).__K3NCRYPT_ACTIVE_CRYPTO_DIAGNOSTICS__; const v = await hook?.(); return { inboundFailureCategory: v?.inboundFailureCategory, connectionFailureCategory: v?.connectionFailureCategory, deliveries: v?.activeMessageMetadata?.map((m: any) => m.delivery) }; })); throw error; }
        await expect(alice.locator('.message.sent').filter({ hasText: 'synthetic message while peer browser closed' })).not.toContainText('Delivered');
      }
      b = await context('bob'); bob = await unlock(b, 'Alice');
      await expect(bob.locator('#messages-area')).toContainText('synthetic message while peer browser closed', { timeout: 30000 });
      await expect.poll(async () => (await database.collection('links').findOne({ hash: mainRoom!.hash }))?.routingOwners?.length).toBe(2);
      await expect(alice.locator('.message.sent').filter({ hasText: 'synthetic message while peer browser closed' }).locator('.message-delivery-details summary')).toHaveText('Delivered');
      if (days === 8) await expect(bob.locator('#messages-area')).toContainText('queued before temporary prekey expiry');
      await send(bob, 'synthetic reply after restart'); await expect(alice.locator('#messages-area')).toContainText('synthetic reply after restart');
      let i = 0;
      for (const page of [alice, bob]) {
        await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Security Your identity and contact verification', exact: true }).click();
        await expect(page.locator('.verification-view')).toContainText('Verified'); await expect(page.locator('.verification-code').first()).toHaveText(fingerprints[i++]);
        await page.getByRole('button', { name: 'Close settings' }).click();
      }
      await expect(bob.locator('.message.received').filter({ hasText: 'synthetic message while peer browser closed' })).toHaveCount(1);
      if (days === 8 || days === 30) {
        const bytes = Buffer.alloc(23 * 1024, 71), name = 'synthetic.bin';
        await alice.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
        await alice.getByRole('button', { name: 'Send file', exact: true }).click();
        await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 30000 });
        await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
        const save = bob.getByRole('link', { name: `Save ${name}`, exact: true }); await expect(save).toBeVisible({ timeout: 30000 });
        const hash = await save.evaluate(async element => { const data = await (await fetch((element as HTMLAnchorElement).href)).arrayBuffer(); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join(''); });
        expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
        await bob.getByRole('button', { name: 'Close', exact: true }).click();
      }
      console.log(JSON.stringify({ fixture: 'durable-routing', mixedAdoption, deniedBeforePeerAdoption, transport: process.env.K3NCRYPT_ROUTING_TEST_MUX === 'true' ? 'mux' : 'legacy', days, actualTtlDeleted: days >= 7, persistentProcessRestart: true, backendRestart: true, retainedVerifiedHistory: true, offlineReplay: true }));
    } finally {
      await a?.close(); await b?.close(); await stop(); await database.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
    }
  });
});
