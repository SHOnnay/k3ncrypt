import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { create, security, uncheckedPair, expectFileSent } from './usabilityHelpers';
import { fsUrl } from './fsUrl';

// M1c (Option B). Invariant: checking is explicit and user-controlled; nothing changes trust
// silently. Screenshots go to SHOT_DIR at 1440x900 and 390x844.
const shotDir = process.env.SHOT_DIR ?? 'test-results/m1c-screens';
mkdirSync(shotDir, { recursive: true });
async function shoot(page: Page, name: string) {
  const original = page.viewportSize();
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
    await page.screenshot({ path: `${shotDir}/${name}-${label}-${width}x${height}.png` });
  }
  if (original) await page.setViewportSize(original);
}
async function cameraImage(page: Page, url: string) {
  await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    // Real local decoder on a synthetic camera frame; no scan callback bypass.
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(10); const timer = setInterval(() => canvas.getContext('2d')!.drawImage(image, 0, 0), 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    };
  }, url);
}
async function ownCode(page: Page): Promise<string> {
  await security(page);
  await page.locator('.verification-security-details > summary').click();
  await page.locator('.check-show-mine summary').click();
  const image = page.getByAltText('Your code for scanning', { exact: true }).first();
  await expect(image).toBeVisible();
  const src = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Close settings' }).click();
  return src!;
}

test('new account looks empty: no contacts, own invitation only on the Invite screen', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(); const page = await context.newPage();
  await create(page, 'Fresh');
  await expect(page.getByRole('region', { name: 'Conversations' })).toContainText('No chats yet.');
  const empty = page.locator('.chat-empty-page');
  await expect(empty).toContainText('No chats yet.');
  await expect(empty).toContainText('Invite someone to start.');
  await expect(empty).not.toContainText('Your invitation');
  await expect(empty.getByRole('button', { name: /Invite someone/ })).toBeVisible();
  await expect(page.getByText(/Open pending invitation/)).toHaveCount(0);
  await shoot(page, '01-new-account-chats');
  await page.getByRole('button', { name: 'Contacts', exact: true }).first().click();
  await expect(page.locator('.workspace-page')).toContainText('No contacts yet.');
  await expect(page.locator('.workspace-page')).toContainText('Invite someone to start.');
  await shoot(page, '02-new-account-contacts');
  await page.locator('.new-conversation').click();
  await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible();
  const own = page.getByRole('region', { name: 'Your invitations' });
  await expect(own).toContainText('Your invitation ·');
  await expect(own).toContainText('Waiting for someone to accept. It is not a contact yet.');
  await expect(page.getByText('Using an older K3NCRYPT invitation?')).toHaveCount(0);
  await shoot(page, '03-invite-screen-own-invitation');
  await context.close();
});

test('in person: scan code, wrong code refused, Confirm records the check, then show my code', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);
  await expect(bob.locator('.chat-header')).toContainText('Not checked yet');
  await expect(bob.locator('.chat-header .connection-status')).toContainText('Connected');
  await expect(bob.locator('.check-banner')).toContainText('Before sharing photos and files, check it’s really Alice. It takes a minute.');
  await shoot(bob, '04-chat-unchecked-banner-and-status');
  const aliceCode = await ownCode(alice);
  const bobCode = await ownCode(bob);

  await bob.locator('.chat-header').getByRole('button', { name: 'Check', exact: true }).click();
  await expect(bob.locator('.verification-view')).toContainText('Is Alice using K3NCRYPT on an Android phone?');
  await shoot(bob, '05-check-step1-android-question');
  await bob.getByRole('button', { name: 'No', exact: true }).click();
  await expect(bob.locator('.verification-view')).toContainText('Are you with Alice right now?');
  await shoot(bob, '06-check-step2-together');
  await bob.getByRole('button', { name: 'Yes, we’re together', exact: true }).click();
  await expect(bob.locator('.verification-view')).toContainText('Scan Alice’s code');
  await expect(bob.getByRole('button', { name: 'Show numbers instead', exact: true })).toBeVisible();
  const confirm = bob.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toHaveCount(0); // hidden until a code is scanned
  await expect(bob.locator('.check-flow summary')).toHaveCount(0); // Show my code lives under More options
  await shoot(bob, '07-check-scan');

  await cameraImage(bob, bobCode); await bob.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(bob.getByText('This isn’t Alice’s code. Don’t confirm. Make sure you’re scanning Alice’s own phone.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(confirm).toHaveCount(0);
  await shoot(bob, '08-check-scan-wrong-code');
  await cameraImage(bob, aliceCode); await bob.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(bob.getByText('That’s Alice’s code. Tap Confirm to mark Alice as checked.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(bob.locator('.verification-summary')).toContainText('Not checked yet');
  await expect(confirm).toBeVisible();
  await shoot(bob, '09-check-scan-matched');
  await confirm.click();
  await expect(bob.locator('.verification-summary')).toContainText('Checked on this device');
  await expect(bob.getByText('Now let Alice scan your code.', { exact: true })).toBeVisible();
  await expect(bob.getByAltText('Your code for scanning', { exact: true }).first()).toBeVisible();
  await shoot(bob, '10-check-show-my-code');
  await bob.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(bob.locator('.chat-header')).toContainText('Checked on this device');
  await expect(alice.locator('.chat-header')).toContainText('Not checked yet'); // per device, never automatic
  await a.close(); await b.close();
});

test('remote: numbers, mismatch warning, They match, and the Android path offers no check from this side', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);
  await security(alice);
  await alice.getByRole('button', { name: 'Yes, Android', exact: true }).click();
  const view = alice.locator('.verification-view');
  await expect(view).toContainText('Bob’s Android phone checks you by your full security number');
  await expect(view).toContainText('Checking Bob from this side needs an update to the Android app.');
  await expect(alice.getByRole('button', { name: 'They match' })).toHaveCount(0);
  await expect(alice.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(view).toContainText('Read each group, one character at a time.');
  await expect(alice.getByRole('button', { name: 'Copy my security number' })).toBeVisible();
  const groups = await alice.locator('.security-number-groups code').allInnerTexts();
  expect(groups.length).toBeGreaterThan(8);
  await shoot(alice, '11-check-android-path');
  await alice.getByRole('button', { name: 'Back', exact: true }).click();
  await alice.getByRole('button', { name: 'No', exact: true }).click();
  await alice.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  await expect(view).toContainText('Call Bob on a number you already know. Don’t use a number sent in this chat.');
  const aliceNumber = await alice.getByLabel('Security number', { exact: true }).innerText();
  expect(aliceNumber).toMatch(/^\d{5}( · \d{5}){5}$/);
  await shoot(alice, '12-check-numbers');
  await alice.getByRole('button', { name: 'They don’t match', exact: true }).click();
  await expect(alice.getByRole('alert')).toContainText('someone may be in between you');
  await expect(alice.locator('.verification-summary')).toContainText('Not checked yet');
  await shoot(alice, '13-check-numbers-mismatch');
  await security(bob);
  await bob.getByRole('button', { name: 'No', exact: true }).click();
  await bob.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  expect(await bob.getByLabel('Security number', { exact: true }).innerText()).toBe(aliceNumber); // both sides read the same number
  await alice.getByRole('button', { name: 'They match', exact: true }).click();
  await expect(alice.locator('.verification-summary')).toContainText('Checked on this device');
  await expect(view).toContainText('Bob is checked on this device. Ask Bob to check you too.');
  await shoot(alice, '14-check-numbers-checked');
  await a.close(); await b.close();
});

test('file card before and after checking, and the changed-number banner pauses files', async ({ browser }) => {
  test.setTimeout(240_000);
  const { a, b, alice, bob } = await uncheckedPair(browser);
  // Alice checks Bob so she may send; Bob has not checked Alice.
  await security(alice);
  await alice.getByRole('button', { name: 'No', exact: true }).click();
  await alice.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  await alice.getByRole('button', { name: 'They match', exact: true }).click();
  await alice.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await alice.locator('input[type=file]').setInputFiles({ name: 'garden.txt', mimeType: 'text/plain', buffer: Buffer.from('roses and mint') });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expectFileSent(alice, 60_000);

  const card = bob.locator('.message.received .message-file-card').last();
  await expect(card).toContainText('Check it’s really Alice to open this file.', { timeout: 30_000 });
  await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(0);
  await shoot(bob, '15-file-card-before-check');
  await card.getByRole('button', { name: 'Check now', exact: true }).click();
  await bob.getByRole('button', { name: 'No', exact: true }).click();
  await bob.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  await bob.getByRole('button', { name: 'They match', exact: true }).click();
  await bob.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
  const save = bob.getByRole('link', { name: 'Save garden.txt', exact: true });
  await expect(save).toBeVisible({ timeout: 60_000 });
  await expect(save).toHaveText('Save');
  await shoot(bob, '16-file-card-after-check');

  // Identity change, injected into Bob's own vault (a real reinstall needs a second device).
  const changed = 'K3 HQIO A1J9 DNVI TEHH JHLB EA8F S3_9 HP6_ GVJM OUBY NLG';
  await bob.evaluate(async ({ root, passphrase, changed }) => {
    const { BrowserSecureStorage } = await import(/* @vite-ignore */ root + '/service/src/storage/secureVault.ts');
    const { IndexedDbVaultPersistence } = await import(/* @vite-ignore */ root + '/service/src/storage/persistence.ts');
    const vault = new BrowserSecureStorage(new IndexedDbVaultPersistence()); await vault.unlock(passphrase);
    try {
      const entries = JSON.parse(new TextDecoder().decode(await vault.read('product-session', 'conversations')));
      const room = entries.find((item: { remoteAddress?: string }) => item.remoteAddress);
      const contact = JSON.parse(new TextDecoder().decode(await vault.read('contact-identity', room.remoteAddress)));
      const next = { ...contact, verification: 'unverified', changeStatus: 'changed-pending-review', identityChangedAt: Date.now(),
        pendingIdentity: { identityId: changed, algorithm: contact.algorithm, publicKey: contact.publicKey } };
      delete next.verifiedAt;
      await vault.write('contact-identity', room.remoteAddress, new TextEncoder().encode(JSON.stringify(next)).buffer);
    } finally { vault.lock(); }
  }, { root: fsUrl(process.cwd()), passphrase: 'alpha-family-existing-account-2026', changed });
  await bob.reload();
  await bob.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await bob.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await bob.getByRole('button', { name: 'Unlock account', exact: true }).click();
  // Documented rule: an identity change hides the old name claim (anti-impersonation). Owner decision pending.
  await bob.locator('.conversation-row').first().click();
  const banner = bob.locator('.check-banner--changed');
  await expect(banner).toContainText('Your contact’s security number changed. This happens if your contact reinstalled K3NCRYPT or got a new phone. It can also mean someone is trying to listen in. Files and calls are paused until you check again.', { timeout: 30_000 });
  await expect(banner.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await expect(bob.locator('.chat-header')).toContainText('Security number changed');
  await expect(bob.locator('.message.received .message-file-card').last()).toContainText('Your contact’s security number changed. Check again to open this file.');
  await shoot(bob, '17-changed-number-banner');
  await banner.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(bob.locator('.verification-view')).toContainText('Security number changed');
  await shoot(bob, '18-changed-number-check-again');
  await a.close(); await b.close();
});
