import { test, expect } from '@playwright/test';
import { connectedPair, copyMyCode, security } from './usabilityHelpers';

// Part A2 bug 4. Invariants: Security → More options shows no raw code text, each heading sits above its
// value, and the code still travels by Copy my code / paste.
test('More options: labelled security numbers, no raw code, copy and paste work', async ({ browser }) => {
  test.setTimeout(180_000);
  const { alice, bob } = await connectedPair(browser);
  for (const page of [alice, bob]) { await security(page); await page.locator('.verification-security-details > summary').click(); }
  const details = alice.locator('.verification-security-details');
  await expect(details).not.toContainText('"fingerprint"');
  await expect(details.getByRole('textbox', { name: 'My code as text' })).toHaveCount(0);
  for (const row of await details.locator('.security-numbers > div').all()) {
    const label = await row.locator('dt').boundingBox(); const value = await row.locator('dd').boundingBox();
    if (!label || !value) throw new Error('Security number row not rendered.');
    expect(label.y + label.height).toBeLessThanOrEqual(value.y + 0.5);
  }
  if (process.env.SECURITY_SHOT) await details.screenshot({ path: process.env.SECURITY_SHOT });
  const bobCode = await copyMyCode(bob);
  await details.getByRole('textbox', { name: 'Their code' }).fill(bobCode);
  await details.getByRole('button', { name: 'Check their code' }).click();
  await expect(alice.locator('.verification-view')).not.toContainText('isn’t');
});
