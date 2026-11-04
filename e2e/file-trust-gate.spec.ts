import { test, expect, type Page } from '@playwright/test';
import { create, invite, security, expectFileSent } from './usabilityHelpers';

// P0-1. Invariant: calls and file transfer require a verified, unchanged identity.
// Alice verified Bob, so Alice may send. Bob has NOT verified Alice, so Bob must not
// be able to open what arrives until he verifies her explicitly.
const verify = async (page: Page) => {
  await security(page);
  await page.getByRole('button', { name: 'No', exact: true }).click(); await page.getByRole('button', { name: 'No, we’ll call', exact: true }).click();
  await page.getByRole('button', { name: 'They match', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
};

test('an unverified recipient cannot open a received file until they verify the sender', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await browser.newContext(); const b = await browser.newContext();
  const alice = await a.newPage(); const bob = await b.newPage();
  await create(alice, 'Alice'); await create(bob, 'Bob');
  const link = await invite(alice);
  await bob.locator('.new-conversation').click(); await bob.getByRole('button', { name: 'I have an invitation' }).click();
  await bob.locator('#channel-hash').fill(link); await bob.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(alice.locator('.chat-header')).toContainText('Bob', { timeout: 30_000 });
  await expect(bob.locator('.chat-header')).toContainText('Alice', { timeout: 30_000 });
  // UX A10: before checking, the attach control is off and says why; Check now is offered.
  const blockedAttach = bob.getByRole('button', { name: 'Check Alice first to send files', exact: true });
  await expect(blockedAttach).toBeDisabled();
  await expect(bob.locator('.check-banner').getByRole('button', { name: 'Check now', exact: true })).toBeVisible();
  await verify(alice);

  await alice.locator('input[type=file]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('family photo list') });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expectFileSent(alice, 60_000);

  const card = bob.locator('.message.received .message-file-card').last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Check it’s really Alice to open this file.');
  await expect(bob.getByRole('button', { name: 'Download protected file', exact: true })).toHaveCount(0);

  await verify(bob);
  await bob.getByRole('button', { name: 'Download protected file', exact: true }).last().click();
  const save = bob.getByRole('link', { name: 'Save note.txt', exact: true });
  await expect(save).toBeVisible({ timeout: 60_000 });
  await expect(save).toHaveAttribute('title', 'Save file');
  await a.close(); await b.close();
});
