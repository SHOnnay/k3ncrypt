import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const passphrase = 'phase one e crash validation';
const serviceUrl = (file: string) => `/@fs${resolve(process.cwd(), 'service/src', file)}`;
const modules = {
  runtime: serviceUrl('crypto/vodozemacRuntime.ts'),
  vault: serviceUrl('storage/secureVault.ts'),
  persistence: serviceUrl('storage/persistence.ts'),
};

type Prepared = { envelope: { version: number; strategy: string; data: { version: number; olmMessage: string } }; sessionId: string; productStored: boolean; seenStored: boolean };

const prepareReceiver = async (page: Page, writeProduct: boolean): Promise<Prepared> => page.evaluate(async ({ urls, roomId, secret, writeProductMessage }) => {
  const [{ loadVodozemacBindings }, { VodozemacRuntime }, { BrowserSecureStorage }, { IndexedDbVaultPersistence }] = await Promise.all([
    import('/src/crypto/vodozemacModule.ts'), import(/* @vite-ignore */ urls.runtime),
    import(/* @vite-ignore */ urls.vault), import(/* @vite-ignore */ urls.persistence),
  ]);
  const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence());
  await vault.initializeWithPassphrase(secret);
  const receiver = new VodozemacRuntime(vault, loadVodozemacBindings);
  await receiver.initialize();
  await receiver.restoreOrCreateIdentity();
  const receiverBundle = await receiver.getPublicBundle();
  const bindings = await loadVodozemacBindings();
  const sender = bindings.accountFactory.createAccount();
  sender.generateFallbackKey();
  const senderKeys = JSON.parse(sender.identityKeys()) as { curve25519: string };
  const senderSession = sender.createOutboundSession!(receiverBundle.identity.curve25519, receiverBundle.fallbackKey!.key);
  const frame = (text: string) => Uint8Array.from([1, 1, ...new TextEncoder().encode(text)]);
  const firstWire = senderSession.encrypt(frame('initial session'));
  await receiver.establishInboundSession(roomId, senderKeys.curve25519, firstWire);
  const sessionId = receiver.activeSessionId!;
  const secondWire = senderSession.encrypt(frame('crash-window message'));
  const envelope = { version: 2, strategy: 'vodozemac-olm-v1', data: { version: 1, olmMessage: secondWire } };
  const plaintext = await receiver.decrypt('message', envelope);
  if (new TextDecoder().decode(plaintext) !== 'crash-window message') throw new Error('Unexpected decrypted text');
  if (writeProductMessage) {
    await vault.write('product-messages', roomId, new TextEncoder().encode(JSON.stringify([{ id: 'test-message', text: 'crash-window message' }])).buffer);
  }
  const productStored = !!await vault.read('product-messages', roomId);
  const seenStored = !!await vault.read('modern-seen', roomId);
  senderSession.free?.(); sender.free?.(); receiver.close(); vault.lock();
  return { envelope, sessionId, productStored, seenStored };
}, { urls: modules, roomId: room, secret: passphrase, writeProductMessage: writeProduct });

const inspectRestart = async (page: Page, prepared: Prepared) => page.evaluate(async ({ urls, roomId, secret, saved }) => {
  const [{ loadVodozemacBindings }, { VodozemacRuntime }, { BrowserSecureStorage }, { IndexedDbVaultPersistence }] = await Promise.all([
    import('/src/crypto/vodozemacModule.ts'), import(/* @vite-ignore */ urls.runtime),
    import(/* @vite-ignore */ urls.vault), import(/* @vite-ignore */ urls.persistence),
  ]);
  const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence());
  await vault.unlock(secret);
  const sessionStored = !!await vault.read('vodozemac-session', roomId);
  const productStored = !!await vault.read('product-messages', roomId);
  const seenStored = !!await vault.read('modern-seen', roomId);
  const receiver = new VodozemacRuntime(vault, loadVodozemacBindings);
  await receiver.initialize();
  await receiver.restoreOrCreateIdentity();
  await receiver.restoreSession(roomId, saved.sessionId);
  let replay: 'accepted' | 'rejected' = 'accepted';
  try { await receiver.decrypt('message', saved.envelope); } catch { replay = 'rejected'; }
  receiver.close(); vault.lock();
  return { sessionStored, productStored, seenStored, replay };
}, { urls: modules, roomId: room, secret: passphrase, saved: prepared });

test.describe('Phase 1E real Web WASM and encrypted IndexedDB restart characterization', () => {
  test('receiver restart after decrypt and before product persistence', async ({ page }) => {
    await page.goto('/crypto-smoke.html');
    const saved = await prepareReceiver(page, false);
    expect(saved).toMatchObject({ productStored: false, seenStored: false });
    await page.reload();
    const recovered = await inspectRestart(page, saved);
    expect(recovered).toEqual({ sessionStored: true, productStored: false, seenStored: false, replay: 'rejected' });
  });

  test('receiver restart after product persistence and before replay marker', async ({ page }) => {
    await page.goto('/crypto-smoke.html');
    const saved = await prepareReceiver(page, true);
    expect(saved).toMatchObject({ productStored: true, seenStored: false });
    await page.reload();
    const recovered = await inspectRestart(page, saved);
    expect(recovered).toEqual({ sessionStored: true, productStored: true, seenStored: false, replay: 'rejected' });
  });
});
