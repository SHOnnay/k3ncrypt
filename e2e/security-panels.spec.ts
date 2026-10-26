import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { connectedPair, create } from './usabilityHelpers';
const evidence = '/private/tmp/k3ncrypt-security-panels-evidence';
async function panel(page: Page, label: string) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${label} `) }).click();
  return page.getByRole('dialog', { name: label, exact: true });
}
async function theme(page: Page, name: 'slate' | 'paper') {
  await panel(page, 'Appearance');
  await page.getByRole('radio', { name: name === 'slate' ? /Slate Dusk/ : /Paper & Ink/ }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', name);
}
async function bounds(page: Page) {
  const failures = await page.locator('.settings-panel').evaluate(panel => {
    const boundary = panel.getBoundingClientRect();
    return Array.from(panel.querySelectorAll('button, input, textarea, summary, .status-pill, .device-card__copy')).filter(node => {
      if (!(node instanceof HTMLElement) || !node.getClientRects().length) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && (box.left < boundary.left - 1 || box.right > boundary.right + 1 || node.scrollWidth > node.clientWidth + 2);
    }).map(node => node.tagName + '.' + node.className);
  });
  expect(failures).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width);
}

test('authenticated four-panel light/dark, narrow layouts, keyboard and restart evidence', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    for (const appearance of ['slate', 'paper'] as const) {
      await theme(alice, appearance);
      for (const name of ['Security', 'Devices', 'Privacy', 'Connection']) {
        const dialog = await panel(alice, name);
        await expect(dialog).toBeVisible();
        await alice.emulateMedia({ reducedMotion: 'reduce' });
        expect(await dialog.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
        if (name === 'Security') await expect(dialog.locator('.verification-summary')).toContainText('Verified');
        if (name === 'Devices') {
          await expect(dialog.getByRole('article', { name: 'This device', exact: true })).toHaveCount(1);
          await expect(dialog.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
          await dialog.getByRole('button', { name: 'Close settings', exact: true }).focus();
          await alice.keyboard.press('Tab');
          await expect(dialog.getByRole('article', { name: 'This device', exact: true }).locator('summary')).toBeFocused();
          await alice.keyboard.press('Tab');
          await expect(dialog.locator('.device-advanced-details summary')).toBeFocused();
          await alice.keyboard.press('Tab');
          await expect(dialog.getByRole('button', { name: 'Back to settings', exact: true })).toBeFocused();
          await alice.keyboard.press('Shift+Tab');
          await expect(dialog.locator('.device-advanced-details summary')).toBeFocused();
          await expect(dialog).toContainText('Guided device setup is not available');
        }
        if (name === 'Connection') await expect(dialog).toContainText('Reachable');
        const contrast = await dialog.evaluate(root => {
          const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
          const context = canvas.getContext('2d')!;
          const lum = (value: string) => {
            context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
            const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          const ratio = (foreground: string, background: string) => { const values = [lum(foreground), lum(background)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); };
          const style = getComputedStyle(root);
          const ordinary = ['--surface', '--surface-raised', '--surface-muted', '--surface-tint'].map(token => ratio(style.getPropertyValue('--muted'), style.getPropertyValue(token)));
          const positive = Array.from(root.querySelectorAll('.status-pill--positive')).map(pill => ratio(getComputedStyle(pill).color, getComputedStyle(pill).backgroundColor));
          const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('.btn:not(:disabled)')).flatMap(button => {
            const css = getComputedStyle(button);
            const backgrounds = css.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [css.backgroundColor];
            return backgrounds.map(background => ratio(css.color, background));
          });
          return { ordinary, positive, controls };
        });
        expect(Math.min(...contrast.ordinary)).toBeGreaterThanOrEqual(4.5);
        if (contrast.positive.length) expect(Math.min(...contrast.positive)).toBeGreaterThanOrEqual(4.5);
        if (contrast.controls.length) expect(Math.min(...contrast.controls)).toBeGreaterThanOrEqual(4.5);
        await alice.screenshot({ path: `${evidence}/after-${appearance}-${name.toLowerCase()}.png` });
        for (const width of [320, 360, 393]) {
          await alice.setViewportSize({ width, height: 740 });
          await bounds(alice);
          await alice.keyboard.press('Tab');
          expect(await alice.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
          if (name === 'Privacy') {
            await dialog.getByRole('heading', { name: 'Data and external connections', exact: true }).scrollIntoViewIfNeeded();
            await expect(dialog.getByRole('heading', { name: 'Data and external connections' })).toBeVisible();
          }
          if (width === 393) await alice.screenshot({ path: `${evidence}/after-${appearance}-${name.toLowerCase()}-393.png` });
        }
        await alice.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await bounds(alice);
        await alice.screenshot({ path: `${evidence}/after-${appearance}-${name.toLowerCase()}-large-font.png` });
        await alice.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await alice.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
        await alice.setViewportSize({ width: 1280, height: 720 });
      }
    }
    const privacy = await panel(alice, 'Privacy');
    await privacy.getByRole('checkbox', { name: /^Blur sensitive content/ }).check();
    await privacy.getByRole('checkbox', { name: /^Notification previews/ }).check();
    await privacy.getByRole('checkbox', { name: /^Notifications Allow/ }).uncheck();
    await expect(privacy.getByRole('checkbox', { name: /^Notification previews/ })).toBeDisabled();
    await privacy.getByRole('button', { name: 'Refresh permissions' }).click();
    await expect(privacy).toContainText('Allowed');
    await alice.getByRole('button', { name: 'Close settings' }).click();
    await alice.locator('#msg-input').fill('Panel correction preserves messaging'); await alice.locator('#send-btn').click();
    await expect(bob.locator('#messages-area')).toContainText('Panel correction preserves messaging');
    // Page teardown/reload. Actual normal browser-process restart is also
    // checked by call-history.spec.ts using on-disk disposable persistent profiles.
    await alice.reload();
    const restarted = alice;
    await restarted.getByRole('button', { name: 'Unlock this device', exact: true }).click();
    await restarted.locator('input[type=password]').fill('alpha-family-existing-account-2026');
    await restarted.getByRole('button', { name: 'Unlock account', exact: true }).click();
    await restarted.getByRole('button', { name: 'Chats', exact: true }).click();
    await restarted.locator('.conversation-row').filter({ hasText: 'Bob' }).click();
    await expect(restarted.locator('.chat-header')).toContainText('Bob');
    await expect(restarted.locator('#messages-area')).toContainText('Panel correction preserves messaging');
    await panel(restarted, 'Security'); await expect(restarted.locator('.verification-summary')).toContainText('Verified');
    await restarted.getByRole('button', { name: 'Close settings' }).click();
    const restored = await panel(restarted, 'Privacy');
    await expect(restored.getByRole('checkbox', { name: /^Blur sensitive content/ })).toBeChecked();
    await expect(restored.getByRole('checkbox', { name: /^Notifications Allow/ })).not.toBeChecked();
  } finally { await a.close(); await b.close(); }
});

test('read-only service checks distinguish HTTP readiness, failure, offline and bounded retry', async ({ browser }) => {
  test.setTimeout(75_000);
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await create(page, 'Disposable reachability tester');
    let checks = 0;
    await page.route('**/api/ready', route => { checks++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"not_ready"}' }); });
    let dialog = await panel(page, 'Connection');
    await expect(dialog).toContainText('Not ready'); expect(checks).toBe(1);
    await page.unroute('**/api/ready');
    await page.route('**/api/ready', route => { checks++; return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Not the service</html>' }); });
    await dialog.getByRole('button', { name: 'Check service again' }).click(); await expect(dialog).toContainText('Not ready');
    await page.unroute('**/api/ready');
    await page.route('**/api/ready', route => { checks++; return route.abort(); });
    await dialog.getByRole('button', { name: 'Check service again' }).click(); await expect(dialog).toContainText('Unreachable');
    await context.setOffline(true); await expect(dialog).toContainText('Browser offline');
    await context.setOffline(false); await expect(dialog).toContainText('Unreachable');
    await page.unroute('**/api/ready');
    await dialog.getByRole('button', { name: 'Check service again' }).click(); await expect(dialog).toContainText('Reachable');
    // Delayed response after close must not update a reopened panel. No secret or room parameters in the request.
    await page.getByRole('button', { name: 'Close settings' }).click();
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/ready', async route => { await held; await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ready"}' }).catch(() => undefined); });
    dialog = await panel(page, 'Connection');
    await expect(dialog.getByText('Checking…', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Unreachable', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(dialog.getByRole('button', { name: 'Check service again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Close settings' }).click();
    release(); await page.unroute('**/api/ready');
    dialog = await panel(page, 'Connection'); await expect(dialog).toContainText('Reachable');
  } finally { await context.close(); }
});

test('waiting identity cannot be confirmed, real unverify stays explicit', async ({ browser }) => {
  test.setTimeout(75_000);
  const fresh = await browser.newContext(); const page = await fresh.newPage();
  try {
    await create(page, 'Disposable invitation owner');
    const waiting = await panel(page, 'Security');
    await expect(waiting).toContainText('Waiting for authenticated identity');
    await expect(waiting.getByRole('button', { name: 'Mark as verified' })).toHaveCount(0);
    await expect(waiting.getByRole('heading', { name: 'Contact verification' })).toBeVisible();
    await page.screenshot({ path: `${evidence}/after-waiting-identity.png` });
  } finally { await fresh.close(); }
  const { a, b, alice } = await connectedPair(browser);
  try {
    const dialog = await panel(alice, 'Security');
    await dialog.locator('.verification-security-details summary').click();
    await dialog.getByRole('button', { name: 'Mark unverified', exact: true }).click();
    await expect(dialog.locator('.verification-summary')).toContainText('Not yet verified');
    await expect(dialog.getByRole('button', { name: 'Mark as verified', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Compare security code', exact: true }).click();
    await dialog.getByRole('button', { name: "They don't match", exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Mark as verified', exact: true })).toBeDisabled();
    await alice.screenshot({ path: `${evidence}/after-unverified.png` });
  } finally { await a.close(); await b.close(); }
});

test('real independent-account enrollment fails closed and cancellation makes no device change', async ({ browser }) => {
  test.setTimeout(60_000);
  const { a, b, alice, bob } = await connectedPair(browser);
  try {
    const bobDevices = await panel(bob, 'Devices');
    const bobCard = bobDevices.getByRole('article', { name: 'This device', exact: true });
    await bobCard.getByText('Device details', { exact: true }).click();
    const id = await bobCard.locator('dd').nth(0).innerText(); const identity = await bobCard.locator('dd').nth(1).innerText();
    const devices = await panel(alice, 'Devices');
    await devices.locator('.device-advanced-details summary').click();
    await devices.locator('#device-id-input').fill(id); await devices.locator('#device-identity-input').fill(identity);
    alice.once('dialog', dialog => dialog.dismiss());
    await devices.getByRole('button', { name: 'Request device approval', exact: true }).click();
    await expect(devices.locator('.device-card')).toHaveCount(1);
    alice.once('dialog', dialog => dialog.accept());
    await devices.getByRole('button', { name: 'Request device approval', exact: true }).click();
    await expect(devices.getByRole('alert')).toContainText('Could not confirm the device approval request');
    await expect(devices.locator('.device-card')).toHaveCount(1);
    await expect(devices.getByRole('button', { name: 'Request device approval', exact: true })).toBeEnabled();
    await expect(devices).not.toContainText('This independent device is now active');
    await alice.screenshot({ path: `${evidence}/after-device-existing-account-rejected.png` });
    await alice.getByRole('button', { name: 'Close settings', exact: true }).click();
    const reopened = await panel(alice, 'Devices');
    await reopened.locator('.device-advanced-details summary').click();
    await expect(reopened.locator('#device-id-input')).toHaveValue('');
    await expect(reopened.locator('#device-identity-input')).toHaveValue('');
  } finally { await a.close(); await b.close(); }
});

test('original HTML reference rendered locally for comparison', async ({ page, baseURL }) => {
  const referencePath = process.env.K3NCRYPT_SLATE_REFERENCE_HTML;
  test.skip(!referencePath, 'Owner HTML reference is optional and must be explicitly supplied locally.');
  const html = await readFile(referencePath!, 'utf8');
  await page.route('https://fonts.**/*', route => route.abort());
  await page.setContent(html.replace(/<link[^>]+(?:googleapis|gstatic)[^>]*>/g, ''));
  await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(${baseURL}/fonts/inter-latin-variable.woff2)}@font-face{font-family:Fraunces;src:url(${baseURL}/fonts/fraunces-latin-variable.woff2)}` });
  await page.evaluate(() => { document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('on', screen.id === 's2')); });
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => document.querySelectorAll('.app').forEach(app => app.setAttribute('data-m', mode)), mode);
    await page.screenshot({ path: `${evidence}/reference-${mode}-settings.png` });
  }
});
