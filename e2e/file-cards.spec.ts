import { test, expect, type Page } from '@playwright/test';
import { connectedPair, expectFileSent } from './usabilityHelpers';

// UX A9. Invariants: file cards show the name and a type badge once known (sender at once, recipient after
// download, remembered across unlock); a failed download offers Retry that succeeds.
const file = { name: 'Quarterly report.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(300 * 1024, 7) };

async function unlock(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
}

test('file cards show name and type, remember it, and retry a failed download', async ({ browser }) => {
  test.setTimeout(300_000);
  const { alice, bob } = await connectedPair(browser);
  await alice.locator('input[type=file]').setInputFiles(file);
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(alice.locator('.file-transfer-card')).toContainText(file.name, { timeout: 30_000 });
  await expectFileSent(alice, 120_000);
  const sentCard = alice.locator('.message.sent .message-file-card').last();
  await expect(sentCard).toContainText(file.name); await expect(sentCard.locator('.message-file-badge')).toHaveText('PDF');

  const card = bob.locator('.message.received .message-file-card').last();
  await expect(card).toContainText('Protected file', { timeout: 60_000 }); await expect(card.locator('.message-file-badge')).toHaveText('FILE');
  let failures = 0;
  await bob.route(/\/api\/attachments\/v2\/[^/]+\/chunks\/0$/, (route) => { if (failures++ === 0) return route.abort(); return route.continue(); });
  await card.getByRole('button', { name: 'Download protected file', exact: true }).click();
  const retry = bob.locator('.message.received').last().getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible({ timeout: 90_000 });
  await retry.click();
  await expect(bob.getByRole('link', { name: `Save ${file.name}`, exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText(file.name); await expect(card.locator('.message-file-badge')).toHaveText('PDF');

  await bob.unroute(/\/api\/attachments\/v2\/[^/]+\/chunks\/0$/);
  await unlock(bob);
  await expect(bob.locator('.message.received .message-file-card').last()).toContainText(file.name, { timeout: 30_000 });
});
