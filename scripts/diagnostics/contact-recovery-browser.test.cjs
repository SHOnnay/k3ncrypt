const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const esbuild = require('node:module').createRequire(path.join(root, 'service/package.json'))('esbuild');

// This is an encrypted-persistence and real-Sidebar rendering fixture. It does not
// claim a real Olm handshake; protocol restoration and backend renewal are tested
// separately in ModernConversation.test.ts and backend/api/prekeys.test.ts.
const fixture = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './client/src/components/AppShell/Sidebar';
import { BrowserSecureStorage } from './service/src/storage/secureVault';
import { IndexedDbVaultPersistence } from './service/src/storage/persistence';
import { ContactIdentityRegistry } from './service/src/identity/contactIdentityRegistry';
import { conversationEligibility, conversationDiagnostic, diagnoseOrphanedConversationRecords } from './client/src/product/conversationEligibility';
import { readConversationDescriptors } from './client/src/product/sessionStore';
import { classifySafeDiagnostic, safeFailureCopy } from './client/src/product/safeDiagnostics';
const persistence = new IndexedDbVaultPersistence();
const vault = new BrowserSecureStorage(persistence);
const secret = 'disposable-browser-fixture-passphrase';
const room = '11111111-1111-4111-8111-111111111111';
const descriptor = { version: 1, roomId: room, controlCapability: 'a'.repeat(43), label: 'Saved fixture friend', updatedAt: 1,
  remoteAddress: 'synthetic-peer', remoteIdentityCommitment: 'K3 ' + 'A'.repeat(43), relationship: 'accepted', bootstrapState: 'ESTABLISHED' };
const put = (type, id, value) => vault.write(type, id, new TextEncoder().encode(JSON.stringify(value)).buffer);
globalThis.contactFixture = {
  locked: () => vault.isLocked(),
  lock: () => vault.lock(),
  seed: async () => {
    await vault.initializeWithPassphrase(secret);
    const descriptors = [descriptor, {...descriptor, roomId:'22222222-2222-4222-8222-222222222222', label:'Fixture two'}, {...descriptor, roomId:'33333333-3333-4333-8333-333333333333', label:'Fixture three'}];
    await put('product-session', 'conversations', descriptors);
    for (const extra of descriptors.slice(1)) {
      await put('conversation-protocol', extra.roomId, {version:1,mode:'modern',localAddress:'synthetic-self',remoteAddress:extra.remoteAddress,routingProof:'b'.repeat(43),sessionId:'fixture-session'});
      await vault.write('vodozemac-session', extra.roomId, new Uint8Array([1,2,3]).buffer);
    }
    await put('conversation-protocol', room, { version: 1, mode: 'modern', localAddress: 'synthetic-self', remoteAddress: descriptor.remoteAddress, routingProof: 'b'.repeat(43), sessionId: 'fixture-session' });
    await put('contact-identity', descriptor.remoteAddress, { contactId: descriptor.remoteAddress, identityId: descriptor.remoteIdentityCommitment, algorithm: 'Olm-Curve25519+Ed25519', publicKey: 'AAAA', verification: 'verified', changeStatus: 'unchanged' });
    await vault.write('vodozemac-session', room, new Uint8Array([1, 2, 3]).buffer);
    await put('product-messages', room, [{ id: 'synthetic-id', text: 'synthetic local history' }]);
  },
  inspect: async (legacyMisclassification = false) => {
    if (vault.isLocked()) await vault.unlock(secret);
    const descriptors = await readConversationDescriptors(vault);
    const eligibility = await conversationEligibility(vault, descriptors[0]);
    if (eligibility) throw new Error('Fixture local eligibility unexpectedly failed');
    // A controlled fake provider supplies the availability result. No live requests.
    const response = await fetch('/fixture-prekeys');
    let code;
    if (!response.ok) code = classifySafeDiagnostic('conversation-open', Object.assign(new Error(response.status === 404 ? 'Pre-key bundle unavailable' : 'service unavailable'), { status: response.status }));
    if (legacyMisclassification && code === 'CONVERSATION_PREKEY_UNAVAILABLE') code = 'CONTACT_REGISTRY_MISSING';
    const diagnostics = code ? descriptors.map(item => conversationDiagnostic(item, code)) : [];
    const orphans = await diagnoseOrphanedConversationRecords(vault);
    globalThis.fixtureChatState = { conversations: descriptors, unavailableConversations: diagnostics, orphanedConversationRecords: orphans,
      messages: [], syncStatus: 'blocked', accountState: 'ready', profileDisplayName: 'Disposable owner' };
    document.body.innerHTML = renderToStaticMarkup(React.createElement(Sidebar, { isWelcomeActive: true, activeSection: 'chats', onNavigate() {}, onNewConversation() {}, onOpenConversation() {}, onOpenSettings() {} }));
    const contact = await new ContactIdentityRegistry(vault).get(descriptor.remoteAddress, false);
    return { code, orphanCount: orphans.roomIds.length, verification: contact?.verification, pinMatches: contact?.identityId === descriptor.remoteIdentityCommitment,
      historyEntries: JSON.parse(new TextDecoder().decode(await vault.read('product-messages', room))).length,
      contactRows: document.querySelectorAll('button.conversation-row').length,
      hasPausedCopy: document.body.textContent.includes('Contact saved · reconnection paused'),
      hasEmptyTrustClaim: document.body.textContent.includes('No trusted contacts yet'),
      feedback: code ? safeFailureCopy('conversation-open', code) : undefined };
  },
  digest: async () => {
    const values = await Promise.all([
      'product-session:conversations', 'conversation-protocol:' + room, 'contact-identity:' + descriptor.remoteAddress,
      'vodozemac-session:' + room, 'product-messages:' + room,
    ].map(key => persistence.readRecord(key)));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values))))).map(n => n.toString(16).padStart(2, '0')).join('');
  },
};`;

async function buildFixture() {
  const result = await esbuild.build({
    stdin: { contents: fixture, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'fixture-imports', setup(build) {
      build.onResolve({ filter: /context\/ChatContext$/ }, () => ({ path: 'context', namespace: 'fixture' }));
      build.onResolve({ filter: /^@chat-e2ee\/service$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: root, contents: args.path === 'context'
        ? 'export const useChat = () => globalThis.fixtureChatState;'
        : 'export { ContactIdentityRegistry } from "./service/src/identity/contactIdentityRegistry"; export { ConversationModeStore } from "./service/src/crypto/conversationMode";' }));
    } }], loader: { '.css': 'empty' },
  });
  return result.outputFiles[0].text;
}

test('seven-day missing prekeys keep a verified saved contact/history visible across a real disposable browser restart', { timeout: 60000 }, async () => {
  const code = await buildFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'k3ncrypt-contact-restart-fixture-'));
  let context; let serverAgeDays = 0; let temporaryOutage = false;
  async function open() {
    context = await chromium.launchPersistentContext(directory, { headless: true });
    await context.route('**/*', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/fixture-prekeys') {
        const status = serverAgeDays >= 7 ? 404 : temporaryOutage ? 503 : 200;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ fixture: true }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><title>Disposable contact fixture</title></html>' });
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://contact-fixture.invalid');
    await page.addScriptTag({ content: code });
    return page;
  }
  try {
    let page = await open();
    await page.evaluate(() => globalThis.contactFixture.seed());
    const baseline = await page.evaluate(() => globalThis.contactFixture.inspect());
    assert.equal(baseline.verification, 'verified'); assert.equal(baseline.contactRows, 3);
    const digest = await page.evaluate(() => globalThis.contactFixture.digest());
    for (const days of [0, 4, 5, 7, 8, 15, 30]) {
      serverAgeDays = days;
      const state = await page.evaluate(() => globalThis.contactFixture.inspect());
      assert.equal(state.code, days >= 7 ? 'CONVERSATION_PREKEY_UNAVAILABLE' : undefined);
      assert.equal(state.verification, 'verified'); assert.equal(state.contactRows, 3);
      assert.equal(await page.evaluate(() => globalThis.contactFixture.digest()), digest);
    }
    serverAgeDays = 7;
    const oldView = await page.evaluate(() => globalThis.contactFixture.inspect(true));
    assert.equal(oldView.code, 'CONTACT_REGISTRY_MISSING'); assert.equal(oldView.contactRows, 0);
    assert.equal(oldView.orphanCount, 0); assert.equal(oldView.verification, 'verified');
    let paused = await page.evaluate(() => globalThis.contactFixture.inspect());
    assert.equal(paused.code, 'CONVERSATION_PREKEY_UNAVAILABLE'); assert.equal(paused.contactRows, 3);
    assert.equal(paused.hasEmptyTrustClaim, false); assert.equal(paused.hasPausedCopy, true);
    assert.match(paused.feedback, /reconnection is paused/);
    await context.close(); context = undefined;
    page = await open();
    assert.equal(await page.evaluate(() => globalThis.contactFixture.locked()), true);
    paused = await page.evaluate(() => globalThis.contactFixture.inspect());
    assert.equal(paused.verification, 'verified'); assert.equal(paused.pinMatches, true);
    assert.equal(paused.historyEntries, 1); assert.equal(paused.contactRows, 3); assert.equal(paused.hasPausedCopy, true);
    assert.equal(await page.evaluate(() => globalThis.contactFixture.digest()), digest);
    // Expiry remains paused; this fixture does not pretend to renew deleted authority.
    await page.evaluate(() => globalThis.contactFixture.lock());
    assert.equal(await page.evaluate(() => globalThis.contactFixture.locked()), true);
    // Separately model a temporary provider outage that clears for the original binding.
    serverAgeDays = 0; temporaryOutage = true;
    assert.equal((await page.evaluate(() => globalThis.contactFixture.inspect())).code, 'NETWORK_FAILURE');
    temporaryOutage = false;
    const available = await page.evaluate(() => globalThis.contactFixture.inspect());
    assert.equal(available.code, undefined); assert.equal(available.hasPausedCopy, false);
    assert.equal(available.verification, 'verified'); assert.equal(available.historyEntries, 1);
    assert.equal(await page.evaluate(() => globalThis.contactFixture.digest()), digest);
  } finally {
    await context?.close();
    // Only the fresh disposable directory created by this test is removed.
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
