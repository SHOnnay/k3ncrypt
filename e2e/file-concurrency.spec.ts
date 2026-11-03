import { test, expect, type Page } from '@playwright/test';
import { connectedPair } from './usabilityHelpers';

// UX A2 + A3. Invariants: opening a second file while one is downloading waits visibly ("Waiting…") and then
// completes, never a raw "Another file operation" error; download progress shows real intermediate percentages.
const files = [
  { name: 'two-mib.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * 1024 * 1024, 41) },
  { name: 'small-note.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(600 * 1024, 42) },
];

async function send(sender: Page, file: typeof files[number]) {
  await sender.locator('input[type=file]').setInputFiles(file);
  await sender.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(sender.locator('.media-transfer-status')).toContainText('Sent', { timeout: 300_000 });
}

test('two downloads in a row: second waits visibly, both complete, progress is real', async ({ browser }) => {
  test.setTimeout(600_000);
  const { alice, bob } = await connectedPair(browser);
  for (const file of files) await send(alice, file);
  const buttons = bob.getByRole('button', { name: 'Download protected file', exact: true });
  await expect(buttons).toHaveCount(2, { timeout: 60_000 });

  const seen = new Set<number>();
  const watch = setInterval(() => {
    void bob.locator('.message-file-progress').allInnerTexts().then((texts) => {
      for (const text of texts) for (const match of text.matchAll(/Downloading…\s*(\d+)%/g)) seen.add(Number(match[1]));
    }).catch(() => undefined);
  }, 100);
  await buttons.nth(0).click();
  await buttons.nth(0).click(); // the second card is index 0 once the first one is busy
  try {
    await expect(bob.getByRole('button', { name: 'Waiting for another file to finish', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(bob.getByRole('link', { name: `Save ${files[0].name}`, exact: true })).toBeVisible({ timeout: 300_000 });
    await expect(bob.getByRole('link', { name: `Save ${files[1].name}`, exact: true })).toBeVisible({ timeout: 300_000 });
  } finally { clearInterval(watch); }
  await expect(bob.getByText(/Another file operation/)).toHaveCount(0);
  console.log('DOWNLOAD_PERCENTS', [...seen].sort((x, y) => x - y).join(','));
  expect([...seen].some((value) => value > 0 && value < 100)).toBe(true);
});
