import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import { test, expect, type Page } from '@playwright/test';
import { connectedPair, create, invite } from './usabilityHelpers';

type Route = { roomId: string; localRoutingAddress: string; peerRoutingAddress: string };
type MailboxRow = { id: string; channel: string; mailbox: string; sender: string; state: string; claimId?: string; claimedUntil?: Date };
const passphrase = 'alpha-family-existing-account-2026';

const bindings = async (page: Page): Promise<Route[]> => page.evaluate(() =>
  (globalThis as typeof globalThis & { __K3NCRYPT_MUX_ROOM_BINDINGS__?: () => Route[] }).__K3NCRYPT_MUX_ROOM_BINDINGS__?.() ?? []);
const activeTransport = async (page: Page): Promise<string | undefined> => page.evaluate(() =>
  (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => string | undefined }).__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?.());
const replay = async (page: Page, roomId: string): Promise<void> => page.evaluate(async id => {
  await (globalThis as typeof globalThis & { __K3NCRYPT_MUX_REPLAY_ROOM__?: (roomId: string) => Promise<void> }).__K3NCRYPT_MUX_REPLAY_ROOM__?.(id);
}, roomId);
const sendQueued = async (sender: Page, text: string): Promise<void> => {
  await sender.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(sender.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary')).toHaveText('Sending…', { timeout: 30_000 });
};
const sendWithoutWaitingForDelivery = async (sender: Page, text: string): Promise<void> => {
  await sender.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
};
const delivery = (sender: Page, text: string) => sender.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary');
const sendAndConfirm = async (sender: Page, text: string): Promise<void> => {
  await sender.locator('.chat-footer input[type=text], .chat-footer textarea').fill(text);
  await sender.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
  await expect(delivery(sender, text)).toHaveText('Sent', { timeout: 30_000 });
};

const installAckPolicy = async (page: Page, mode: string): Promise<void> => page.evaluate(nextMode => {
  type Held = { response: Record<string, unknown>; acknowledge?: (response: Record<string, unknown>) => void };
  const target = globalThis as typeof globalThis & {
    __K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?: { mode: string; hits: number; held: Held[] };
    __K3NCRYPT_TEST_ONLY_MUX_ACK_INTERCEPTOR__?: (response: Record<string, unknown>, acknowledge?: (response: Record<string, unknown>) => void) => boolean;
  };
  const state = target.__K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__ ??= { mode: 'pass', hits: 0, held: [] };
  state.mode = nextMode; state.hits = 0;
  target.__K3NCRYPT_TEST_ONLY_MUX_ACK_INTERCEPTOR__ = (response, acknowledge) => {
    if (state.mode === 'pass') return false;
    state.hits += 1;
    if (state.mode === 'hold') { state.held.push({ response: { ...response }, acknowledge }); return true; }
    const mode = state.mode;
    const invalid = { ...response };
    if (mode === 'wrong-room' || mode === 'wrong-terminal-room') invalid.roomId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    if (mode === 'wrong-id') invalid.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    if (mode === 'wrong-claim') invalid.claimId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    if (mode === 'wrong-generation') invalid.connectionGeneration = 'old-socket-generation';
    if (mode === 'wrong-nonce') invalid.subscriptionNonce = 'replayed-subscription-context';
    if (mode === 'wrong-terminal-room') { invalid.outcome = 'permanent-rejection'; invalid.reasonClass = 'unsupported-message'; }
    if (mode === 'duplicate') { acknowledge?.(response); acknowledge?.(response); return true; }
    acknowledge?.(invalid);
    return true;
  };
}, mode);

const heldClaims = async (page: Page): Promise<string[]> => page.evaluate(() =>
  (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?: { held: Array<{ response: Record<string, unknown> }> } }).__K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?.held.map(item => String(item.response.claimId)) ?? []);
const ackHits = async (page: Page): Promise<number> => page.evaluate(() =>
  (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?: { hits: number } }).__K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?.hits ?? 0);
const releaseHeldClaim = async (page: Page, claimId: string, count = 1): Promise<void> => page.evaluate(({ id, attempts }) => {
  const state = (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__?: { held: Array<{ response: Record<string, unknown>; acknowledge?: (response: Record<string, unknown>) => void }> } }).__K3NCRYPT_TEST_ONLY_MUX_ACK_STATE__;
  const held = state?.held.find(item => item.response.claimId === id);
  for (let attempt = 0; attempt < attempts; attempt += 1) held?.acknowledge?.(held.response);
}, { id: claimId, attempts: count });

test('real Socket.IO/Mongo Mux ACK and claim attacks cannot mutate unrelated delivery state', async ({ browser }) => {
  test.skip(process.env.PLAYWRIGHT_MUX_ACK_GATE !== 'true', 'Requires the isolated real-Mongo Stage 1B ACK gate.');
  test.setTimeout(360_000);
  const mongoUri = process.env.PLAYWRIGHT_MONGO_URI;
  const mongoDbName = process.env.PLAYWRIGHT_MONGO_DB_NAME;
  if (!mongoUri || !mongoDbName || !/^k3ncrypt_playwright_[a-zA-Z0-9_-]+$/.test(mongoDbName)) throw new Error('An explicitly disposable loopback Mongo test database is required.');
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const database = mongo.db(mongoDbName);
  const offline = database.collection<MailboxRow>('offline_messages');
  const { a, b, alice, bob } = await connectedPair(browser, true);
  const c = await browser.newContext({ permissions: ['microphone', 'camera'] });
  await c.addInitScript(() => { (globalThis as typeof globalThis & { __K3NCRYPT_TEST_ONLY_DIAGNOSTICS__?: boolean }).__K3NCRYPT_TEST_ONLY_DIAGNOSTICS__ = true; });
  const carol = await c.newPage();
  try {
    await sendAndConfirm(bob, 'Warm Bob to Alice for ACK gate');
    await expect(alice.locator('.message-text').filter({ hasText: 'Warm Bob to Alice for ACK gate' })).toBeVisible();
    await expect(delivery(bob, 'Warm Bob to Alice for ACK gate')).toHaveText('Sent', { timeout: 30_000 });
    const invitation = await invite(alice);
    await create(carol, 'Carol');
    await carol.locator('.new-conversation').click();
    await carol.getByRole('button', { name: 'I have an invitation' }).click();
    await carol.locator('#channel-hash').fill(invitation);
    await carol.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(alice.locator('.chat-header')).toContainText('Carol', { timeout: 30_000 });
    await expect(carol.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
    for (const page of [alice, carol]) {
      await page.getByRole('button', { name: 'Open settings' }).click();
      await page.getByRole('button', { name: 'Security' }).click();
      await page.getByRole('button', { name: 'Compare security code', exact: true }).click();
      await page.getByRole('button', { name: 'Codes match', exact: true }).click();
      await page.getByRole('button', { name: 'Mark as verified', exact: true }).click();
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    }
    await alice.locator('.chat-footer input[type=text], .chat-footer textarea').fill('Warm Alice to Carol for ACK gate');
    await alice.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
    await expect(delivery(alice, 'Warm Alice to Carol for ACK gate')).toHaveText('Sent', { timeout: 30_000 });
    await carol.locator('.chat-footer input[type=text], .chat-footer textarea').fill('Warm Carol to Alice for ACK gate');
    await carol.locator('.chat-footer').getByRole('button', { name: 'Send message' }).click();
    await expect(delivery(carol, 'Warm Carol to Alice for ACK gate')).toHaveText('Sent', { timeout: 30_000 });
    await bob.reload();
    await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await bob.locator('input[type=password]').fill(passphrase);
    await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(bob.locator('.chat-header')).toBeVisible();
    await carol.reload();
    await carol.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await carol.locator('input[type=password]').fill(passphrase);
    await carol.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(carol.locator('.chat-header')).toBeVisible();
    await alice.reload();
    await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await alice.locator('input[type=password]').fill(passphrase);
    await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await expect(alice.locator('.chat-header')).toBeVisible();
    await expect.poll(async () => (await bindings(alice)).length, { timeout: 30_000 }).toBe(2);
    await expect.poll(() => activeTransport(alice), { timeout: 30_000 }).toBe('multiplexed');
    await expect.poll(() => activeTransport(bob), { timeout: 30_000 }).toBe('multiplexed');
    await expect.poll(() => activeTransport(carol), { timeout: 30_000 }).toBe('multiplexed');
    const aRoutes = await bindings(alice); const bRoutes = await bindings(bob);
    const bobRoom = bRoutes.find(route => aRoutes.some(peer => peer.roomId === route.roomId && peer.localRoutingAddress === route.peerRoutingAddress && peer.peerRoutingAddress === route.localRoutingAddress));
    expect(bobRoom).toBeDefined();
    const aliceRoom = aRoutes.find(route => route.roomId === bobRoom!.roomId)!;
    const mailbox = { channel: aliceRoom.roomId, mailbox: aliceRoom.localRoutingAddress, sender: bobRoom!.localRoutingAddress, state: 'active' };
    const rowForSend = (startedAt: number) => offline.findOne({ ...mailbox, timestamp: { $gte: startedAt } }, { sort: { timestamp: -1 } });
    const expireClaim = async (id: string, claimId: string): Promise<void> => {
      await offline.updateOne({ id, claimId, state: 'active' }, { $set: { claimedUntil: new Date(Date.now() - 1) } });
    };
    await installAckPolicy(alice, 'pass');

    const expectInvalidAckRetained = async (label: string, mode: string): Promise<void> => {
      const text = `${label} room-bound ACK probe ${randomUUID()}`;
      await installAckPolicy(alice, mode);
      const startedAt = Date.now();
      await sendWithoutWaitingForDelivery(bob, text);
      await expect.poll(() => ackHits(alice), { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(delivery(bob, text)).toHaveText('Sending…');
      await expect.poll(() => rowForSend(startedAt), { timeout: 30_000 }).toBeDefined();
      const found = await rowForSend(startedAt);
      expect(found?.state).toBe('active'); expect(found?.claimId).toBeTruthy();
      await expect(delivery(bob, text)).toHaveText('Sending…');
      await installAckPolicy(alice, 'pass');
      await expireClaim(found!.id, found!.claimId!);
      await replay(alice, aliceRoom.roomId);
      await expect(delivery(bob, text)).toHaveText('Sent', { timeout: 30_000 });
      await expect.poll(() => offline.findOne({ id: found!.id }), { timeout: 10_000 }).toBeNull();
    };

    // A1–A3 and A10: exact Socket.IO ACK callback fields are corrupted while
    // the live backend and durable mailbox claim path remain in use.
    for (const [label, mode] of [['A1', 'wrong-room'], ['A2', 'wrong-id'], ['A3', 'wrong-claim'], ['A10', 'wrong-terminal-room']] as const) {
      await expectInvalidAckRetained(label, mode);
    }

    // A4: claim A's late valid callback cannot remove claim B's active row.
    const staleClaimText = `A4 replaced-claim ${randomUUID()}`;
    await installAckPolicy(alice, 'hold'); const claimStartedAt = Date.now(); await sendQueued(bob, staleClaimText);
    const claimA = await rowForSend(claimStartedAt);
    expect(claimA?.claimId).toBeTruthy();
    await expect.poll(async () => (await heldClaims(alice)).includes(claimA!.claimId!), { timeout: 30_000 }).toBe(true);
    // Expire claim A in the isolated disposable Mongo fixture so server-side
    // claim B acquisition is deterministic even if another legitimate replay
    // races the lease deadline.
    await offline.updateOne({ id: claimA!.id, claimId: claimA!.claimId }, { $set: { claimedUntil: new Date(Date.now() - 1) } });
    await replay(alice, aliceRoom.roomId);
    await expect.poll(async () => (await offline.findOne({ id: claimA!.id }))?.claimId, { timeout: 15_000 }).not.toBe(claimA?.claimId);
    const claimB = await offline.findOne({ id: claimA!.id });
    expect(claimB?.claimId).toBeTruthy(); expect(claimB?.claimId).not.toBe(claimA?.claimId);
    await expect.poll(async () => (await heldClaims(alice)).includes(claimB!.claimId!), { timeout: 15_000 }).toBe(true);
    await releaseHeldClaim(alice, claimA!.claimId!);
    await expect.poll(async () => (await offline.findOne({ id: claimA!.id }))?.claimId, { timeout: 5_000 }).toBe(claimB?.claimId);
    await releaseHeldClaim(alice, claimB!.claimId!);
    await expect(delivery(bob, staleClaimText)).toHaveText('Sent', { timeout: 30_000 });
    await expect.poll(() => offline.findOne({ id: claimA!.id }), { timeout: 10_000 }).toBeNull();

    // A5: an old generation's held callback is delivered only after Alice's
    // authenticated Mux socket reconnects and a new claim is accepted.
    const generationText = `A5 old-generation ${randomUUID()}`;
    await installAckPolicy(alice, 'hold'); const generationStartedAt = Date.now(); await sendQueued(bob, generationText);
    const generationClaim = await rowForSend(generationStartedAt);
    expect(generationClaim?.claimId).toBeTruthy();
    await expect.poll(async () => (await heldClaims(alice)).includes(generationClaim!.claimId!), { timeout: 30_000 }).toBe(true);
    await alice.evaluate(async () => await (globalThis as typeof globalThis & { __K3NCRYPT_MUX_RECONNECT__?: () => Promise<void> }).__K3NCRYPT_MUX_RECONNECT__?.());
    await expect.poll(() => alice.evaluate(() => (globalThis as typeof globalThis & { __K3NCRYPT_MUX_SNAPSHOT__?: () => { authenticated: boolean; roomSubscriptionCount: number } }).__K3NCRYPT_MUX_SNAPSHOT__?.()), { timeout: 30_000 }).toMatchObject({ authenticated: true, roomSubscriptionCount: 2 });
    await installAckPolicy(alice, 'pass');
    const expiredGenerationClaim = await offline.findOne({ id: generationClaim!.id });
    await expireClaim(generationClaim!.id, expiredGenerationClaim!.claimId!);
    await replay(alice, aliceRoom.roomId);
    await expect(delivery(bob, generationText)).toHaveText('Sent', { timeout: 30_000 });
    await releaseHeldClaim(alice, generationClaim!.claimId!);
    await expect.poll(() => offline.findOne({ id: generationClaim!.id }), { timeout: 10_000 }).toBeNull();

    // A7: unsubscribe invalidates the room authority before the held callback.
    const unsubscribeText = `A7 post-unsubscribe ${randomUUID()}`;
    await installAckPolicy(alice, 'hold'); const unsubscribeStartedAt = Date.now(); await sendQueued(bob, unsubscribeText);
    const unsubscribeClaim = await rowForSend(unsubscribeStartedAt);
    expect(unsubscribeClaim?.claimId).toBeTruthy();
    await expect.poll(async () => (await heldClaims(alice)).includes(unsubscribeClaim!.claimId!), { timeout: 30_000 }).toBe(true);
    await alice.evaluate(async id => await (globalThis as typeof globalThis & { __K3NCRYPT_MUX_UNSUBSCRIBE_ROOM__?: (roomId: string) => Promise<void> }).__K3NCRYPT_MUX_UNSUBSCRIBE_ROOM__?.(id), aliceRoom.roomId);
    await releaseHeldClaim(alice, unsubscribeClaim!.claimId!);
    await expect.poll(() => offline.findOne({ id: unsubscribeClaim!.id }), { timeout: 5_000 }).toMatchObject({ state: 'active', claimId: unsubscribeClaim!.claimId });
    await expect(delivery(bob, unsubscribeText)).toHaveText('Sending…');
    await alice.evaluate(async id => await (globalThis as typeof globalThis & { __K3NCRYPT_MUX_RESUBSCRIBE_ROOM__?: (roomId: string) => Promise<void> }).__K3NCRYPT_MUX_RESUBSCRIBE_ROOM__?.(id), aliceRoom.roomId);
    await installAckPolicy(alice, 'pass');
    const expiredUnsubscribeClaim = await offline.findOne({ id: unsubscribeClaim!.id });
    await expireClaim(unsubscribeClaim!.id, expiredUnsubscribeClaim!.claimId!);
    await replay(alice, aliceRoom.roomId);
    await expect(delivery(bob, unsubscribeText)).toHaveText('Sent', { timeout: 30_000 });

    // A6: a separately authenticated Carol socket has no application ACK event
    // and cannot mutate Alice's mailbox by asserting its room/claim fields.
    const unauthorizedText = `A6 unauthorized-device ${randomUUID()}`;
    await installAckPolicy(alice, 'hold'); const unauthorizedStartedAt = Date.now(); await sendQueued(bob, unauthorizedText);
    const unauthorizedClaim = await rowForSend(unauthorizedStartedAt);
    expect(unauthorizedClaim?.claimId).toBeTruthy();
    await expect.poll(async () => (await heldClaims(alice)).includes(unauthorizedClaim!.claimId!), { timeout: 30_000 }).toBe(true);
    await carol.evaluate(payload => {
      (globalThis as typeof globalThis & { __K3NCRYPT_MUX_FORGED_ACK__?: (payload: Record<string, unknown>) => void }).__K3NCRYPT_MUX_FORGED_ACK__?.(payload);
    }, { roomId: aliceRoom.roomId, id: unauthorizedClaim!.id, claimId: unauthorizedClaim!.claimId });
    await new Promise(resolve => setTimeout(resolve, 300));
    await expect.poll(() => offline.findOne({ id: unauthorizedClaim!.id }), { timeout: 5_000 }).toMatchObject({ state: 'active', claimId: unauthorizedClaim!.claimId });
    await releaseHeldClaim(alice, unauthorizedClaim!.claimId!);
    await expect.poll(() => offline.findOne({ id: unauthorizedClaim!.id }), { timeout: 5_000 }).toBeNull();

    // A9/A12: return the real valid Socket.IO ACK twice after the recipient's
    // durable commit; only that committed event becomes Sent.
    const validText = `A9 A12 duplicate-valid ${randomUUID()}`;
    await installAckPolicy(alice, 'duplicate'); await sendWithoutWaitingForDelivery(bob, validText);
    await expect(delivery(bob, validText)).toHaveText('Sent', { timeout: 30_000 });
    await installAckPolicy(alice, 'pass');
    await expect(alice.evaluate(async () => await (globalThis as typeof globalThis & { __K3NCRYPT_MUX_REPLAY_LAST_PROOF__?: () => Promise<boolean> }).__K3NCRYPT_MUX_REPLAY_LAST_PROOF__?.())).resolves.toBe(true);
    await expect(delivery(bob, validText)).toHaveText('Sent');

    // A8: revoking the device in the isolated durable trust store while a
    // callback is pending prevents the live relay from deleting the mailbox row.
    const revokedText = `A8 revoked-device ${randomUUID()}`;
    await installAckPolicy(alice, 'hold'); const revokedStartedAt = Date.now(); await sendQueued(bob, revokedText);
    const revokedClaim = await rowForSend(revokedStartedAt);
    expect(revokedClaim?.claimId).toBeTruthy();
    await expect.poll(async () => (await heldClaims(alice)).includes(revokedClaim!.claimId!), { timeout: 30_000 }).toBe(true);
    const device = await database.collection<{ accountIdentityReference: string; deviceId: string; trustEpoch: number; state: string }>('device_lifecycle').findOne({ state: 'active' }, { sort: { createdAt: 1 } });
    expect(device).toBeDefined();
    await database.collection('device_lifecycle').updateOne({ accountIdentityReference: device!.accountIdentityReference, deviceId: device!.deviceId, trustEpoch: device!.trustEpoch }, { $set: { state: 'revoked', trustEpoch: device!.trustEpoch + 1, revokedAt: new Date() } });
    await releaseHeldClaim(alice, revokedClaim!.claimId!);
    await expect.poll(() => offline.findOne({ id: revokedClaim!.id }), { timeout: 5_000 }).toMatchObject({ state: 'active', claimId: revokedClaim!.claimId });
    await expect(delivery(bob, revokedText)).toHaveText('Sending…');
  } finally {
    await a.close(); await b.close(); await c.close();
    await database.dropDatabase(); await mongo.close();
  }
});
