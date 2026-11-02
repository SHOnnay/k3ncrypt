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
  const pending = await page.getByRole('region', { name: 'Pending invitations' }).innerText().catch(() => '');
  const pendingRows = await page.locator('.workspace-record').allInnerTexts();
  return { sidebar, contacts, pending, pendingRows };
}

test('same profile has one vault: no second-account path, and a locked invitation join reports a misleading passphrase error', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await create(page, 'Shared Profile');
  await page.reload();
  await page.waitForTimeout(1500);
  const lockedButtons = await page.getByRole('button').allInnerTexts();
  await page.screenshot({ path: `${out}/same-profile-locked.png`, fullPage: true });
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name));
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await create(otherPage, 'Inviter');
  const link = await invite(otherPage);
  const flow: string[] = [];
  await page.getByRole('button', { name: 'I have an invitation' }).click();
  await page.locator('#channel-hash').fill(link);
  flow.push(`passphrase field shown: ${await page.locator('input[type=password]').count()}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForTimeout(2000);
  flow.push(`after continue with no passphrase: ${(await page.locator('.status, [role=alert], [role=status]').allInnerTexts()).join(' | ')}`);
  console.log(JSON.stringify({ lockedButtons, databases, flow }, null, 1));
  await page.screenshot({ path: `${out}/same-profile-join.png`, fullPage: true });
  expect(lockedButtons.join(' ')).not.toContain('Create your private account');
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
