import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { create, invite } from './usabilityHelpers';

// Bug A characterization: what does a brand-new account show, and where does it come from?
// Requires a clean disposable DB (PLAYWRIGHT_MONGO_DB_NAME) on loopback Mongo.
const out = process.env.BUG_A_OUT ?? 'test-results/bug-a';

async function snapshot(page: Page, name: string) {
  const sidebar = await page.getByRole('region', { name: 'Conversations' }).innerText().catch(() => '<none>');
  await page.screenshot({ path: `${out}/${name}-chats.png`, fullPage: true });
  await page.getByRole('button', { name: 'Contacts', exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-contacts.png`, fullPage: true });
  const contacts = await page.locator('.workspace-contact').allInnerTexts();
  const pendingRows = await page.locator('.workspace-record').allInnerTexts();
  // M1c / Bug A: the own invitation is listed only on the Invite someone screen.
  await page.locator('.new-conversation').click();
  const ownInvitations = await page.getByRole('region', { name: 'Your invitations' }).innerText({ timeout: 10_000 });
  return { sidebar, contacts, pendingRows, ownInvitations };
}

test('same profile has one vault; a locked invitation join asks for the existing passphrase', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await create(page, 'Shared Profile');
  await page.reload();
  await page.waitForTimeout(1500);
  const lockedButtons = await page.getByRole('button').allInnerTexts();
  expect(lockedButtons.join(' ')).not.toContain('Create your private account');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).toEqual(['k3ncrypt-local-vault']);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await create(otherPage, 'Inviter');
  const link = await invite(otherPage);
  await page.getByRole('button', { name: 'I have an invitation' }).click();
  await page.locator('#channel-hash').fill(link);
  const existing = page.getByLabel('Your existing passphrase');
  const status = page.locator('.setup-overlay [role=status], .setup-overlay .status, [role=status]');
  // Bug: these used to show the new-account rule "Choose a passphrase with at least 12 characters".
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status.filter({ hasText: 'Enter the passphrase you already use to unlock this device.' }).first()).toBeVisible();
  await existing.fill('not-the-right-passphrase');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status.filter({ hasText: 'That passphrase did not unlock this device.' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Choose a passphrase with at least 12 characters.')).toHaveCount(0);
  await existing.fill('alpha-family-existing-account-2026');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.chat-header')).toContainText('Inviter', { timeout: 30_000 });
  await context.close(); await other.close();
});

test('fresh accounts: no cross-account data, and the only entry is the own pending invitation', async ({ browser }) => {
  test.setTimeout(120_000);
  const results: Record<string, unknown> = {};
  const responses: string[] = [];
  for (const name of ['Alpha Fresh', 'Bravo Fresh']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('response', async response => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      responses.push(`${name} ${response.request().method()} ${url.pathname} ${response.status()} ${await response.text().catch(() => '')}`);
    });
    await create(page, name);
    const seen = await snapshot(page, name.split(' ')[0].toLowerCase());
    results[name] = seen;
    expect(seen.contacts, 'an unaccepted account must have no established contacts').toEqual([]);
    expect(seen.ownInvitations).toContain('Your invitation ·');
    expect(seen.sidebar).toContain('No contacts yet.');
    expect(JSON.stringify(seen)).not.toContain(name === 'Alpha Fresh' ? 'Bravo' : 'Alpha');
    await context.close();
  }
  expect(responses.filter(line => line.startsWith('Bravo')).join('\n')).not.toContain('Alpha Fresh');

  const client = new MongoClient(process.env.PLAYWRIGHT_MONGO_URI!);
  await client.connect();
  const db = client.db(process.env.PLAYWRIGHT_MONGO_DB_NAME);
  const counts: Record<string, number> = {};
  for (const { name } of await db.listCollections().toArray()) counts[name] = await db.collection(name).countDocuments();
  await client.close();
  console.log(JSON.stringify({ results, counts, apiCalls: responses.map(line => line.split(' ').slice(0, 5).join(' ')) }, null, 1));
  expect(responses.filter(line => line.includes('POST /api/chat-link ')).length, 'each new account auto-creates exactly one own room').toBe(2);
});
