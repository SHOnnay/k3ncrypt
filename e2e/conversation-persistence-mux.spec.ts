import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock this device', exact: true }).click();
  await page.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(page.locator('.chat-header')).toBeVisible();
};
const send = async (sender: Page, recipient: Page, text: string) => {
  await sender.getByRole('textbox', { name: 'Write a message', exact: true }).fill(text);
  await sender.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(recipient.locator('.message-text').filter({ hasText: text })).toBeVisible({ timeout: 30000 });
  await expect(sender.locator('.message.sent').filter({ hasText: text }).locator('.message-delivery-details summary')).toHaveText('Sent', { timeout: 30000 });
};
const transport = (page: Page) => page.evaluate(() => {
  const hook = (globalThis as typeof globalThis & { __K3NCRYPT_ACTIVE_ROOM_TRANSPORT__?: () => string }).__K3NCRYPT_ACTIVE_ROOM_TRANSPORT__;
  return hook?.();
});

test('authenticated handoff succeeds while the peer remains legacy, including encrypted call signaling', async ({ browser }) => {
  test.setTimeout(120000);
  const { a, b, alice, bob } = await connectedPair(browser, true);
  try {
    await send(bob, alice, 'Established before transport handoff');
    expect(await transport(alice)).toBe('legacy');
    await bob.reload(); await unlock(bob);
    const aliceRow = bob.locator('.conversation-row').filter({ hasText: 'Alice' });
    await expect.poll(() => transport(bob), { timeout: 30000 }).toBe('multiplexed');
    expect(await transport(alice)).toBe('legacy');
    await send(bob, alice, 'Independent handoff Mux to legacy');
    await send(alice, bob, 'Independent handoff legacy to Mux');
    for (const mode of ['audio', 'video']) for (const [caller, receiver] of [[bob, alice], [alice, bob]]) {
      await expect(caller.getByRole('button', { name: `Start ${mode} call`, exact: true })).toBeEnabled();
      await caller.getByRole('button', { name: `Start ${mode} call`, exact: true }).click();
      await receiver.getByRole('button', { name: 'Decline call', exact: true }).click({ timeout: 30000 });
      await expect(caller.getByRole('button', { name: 'Cancel call', exact: true })).toHaveCount(0);
    }
    await alice.reload(); await unlock(alice);
    await expect.poll(() => transport(alice), { timeout: 30000 }).toBe('multiplexed');
    await aliceRow.click();
    await send(alice, bob, 'Mux retry acceptance Alice');
    await send(bob, alice, 'Mux retry acceptance Bob');
    await alice.reload(); await unlock(alice);
    await expect.poll(() => transport(alice), { timeout: 30000 }).toBe('multiplexed');
    await expect(alice.locator('.message-text').filter({ hasText: 'Mux retry acceptance Bob' })).toBeVisible();
    await send(bob, alice, 'Mux after refresh');
  } finally { await a.close(); await b.close(); }
});
