import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { connectedPair, create } from './usabilityHelpers';

// UX audit (opt-in: UX_AUDIT=true): every main web screen at phone and desktop size, light and dark. Screenshots go to
// AUDIT_DIR; findings (technical words, horizontal overflow, overlapping controls, unnamed buttons) to findings.json.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const dir = process.env.AUDIT_DIR ?? 'test-results/ux-audit';
mkdirSync(dir, { recursive: true });
const findings: Record<string, string[]> = {};
const TECH = /\b(vault|identit(y|ies)|authori[sz]ation|authenticated|relay|routing|epoch|enrol(l)?ment|fingerprint|protocol|session|payload|null|undefined|NaN|\[object|CONVERSATION_[A-Z_]+|[A-Z]{3,}_[A-Z_]{3,})\b/gi;
const sizes = [['phone', 390, 844], ['desktop', 1440, 900]] as const;
const themes = ['paper', 'slate'] as const;

async function inspect(page: Page, name: string) {
  const issues = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal overflow: page is ${document.documentElement.scrollWidth}px wide`);
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    // Only controls a person can actually reach: rendered, and on top at their centre (not behind a dialog or inside a closed menu).
    const onTop = (el: Element) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true; const hit = document.elementFromPoint(x, y); return !!hit && (el === hit || el.contains(hit) || hit.contains(el)); };
    const controls = [...document.querySelectorAll('button, a[href], input, textarea, select')].filter((el) => visible(el) && !el.closest('details:not([open]) > :not(summary)') && onTop(el));
    for (const el of controls) {
      const name = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? el.getAttribute('title') ?? '').trim();
      if (el.tagName === 'BUTTON' && !name) out.push(`unnamed button: ${el.className || el.outerHTML.slice(0, 60)}`);
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1) out.push(`control off-screen right: "${name.slice(0, 30)}"`);
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (overlap > 40) out.push(`overlapping controls: "${((controls[i] as HTMLElement).innerText || controls[i].getAttribute('aria-label') || '').slice(0, 25)}" / "${((controls[j] as HTMLElement).innerText || controls[j].getAttribute('aria-label') || '').slice(0, 25)}"`);
    }
    return { out, text: document.body.innerText };
  });
  const words = [...new Set((issues.text.match(TECH) ?? []).map((w) => w.toLowerCase()))];
  const lines = issues.text.split('\n').filter((line) => TECH.test(line)).map((line) => line.trim().slice(0, 140));
  TECH.lastIndex = 0;
  findings[name] = [...issues.out, ...(words.length ? [`technical words: ${words.join(', ')}`] : []), ...lines.slice(0, 6).map((l) => `  text: ${l}`)];
}

async function shoot(page: Page, name: string, setup?: () => Promise<void>) {
  for (const theme of themes) for (const [label, width, height] of sizes) {
    await page.evaluate((t) => { localStorage.setItem('k3ncrypt-ui-theme', t); document.documentElement.dataset.theme = t; document.documentElement.style.colorScheme = t === 'slate' ? 'dark' : 'light'; }, theme);
    await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
    if (setup) await setup();
    const key = `${name}--${theme}-${label}`;
    await page.screenshot({ path: `${dir}/${key}.png`, fullPage: true });
    await inspect(page, key);
  }
}

test('UX audit of every main screen', async ({ browser }) => {
  test.skip(process.env.UX_AUDIT !== 'true', 'Opt-in screenshot audit: UX_AUDIT=true');
  test.setTimeout(900_000);
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto('/'); await expect(fresh.locator('#show-create-account')).toBeVisible({ timeout: 30_000 });
  await shoot(fresh, '01-welcome');
  await fresh.locator('#show-create-account').click(); await shoot(fresh, '02-create-account');

  const { alice, bob } = await connectedPair(browser);
  await alice.locator('input[type=file]').setInputFiles({ name: 'Family plan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(80 * 1024, 3) });
  await alice.getByRole('button', { name: 'Send file', exact: true }).click();
  await expect(alice.locator('.media-transfer-status')).toContainText('Sent', { timeout: 60_000 });
  await alice.getByRole('button', { name: 'Calls', exact: true }).click();
  await alice.getByRole('button', { name: 'Start audio call', exact: true }).click();
  await bob.getByRole('button', { name: 'Accept call', exact: true }).click({ timeout: 30_000 });
  await expect(alice.locator('#call-status')).toHaveText('Connected', { timeout: 30_000 });
  await shoot(alice, '03-call-in-progress');
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
  await alice.getByRole('button', { name: 'Chats', exact: true }).click();
  await shoot(alice, '04-chat-file-and-call');
  await shoot(bob, '05-chat-received-file');
  await alice.getByRole('button', { name: 'Calls', exact: true }).click(); await shoot(alice, '06-calls-page');
  await alice.getByRole('button', { name: 'Contacts', exact: true }).click(); await shoot(alice, '07-contacts');
  await alice.getByRole('button', { name: 'Chats', exact: true }).click();
  await alice.locator('.new-conversation').click(); await shoot(alice, '08-invite');
  await alice.keyboard.press('Escape').catch(() => undefined);
  await alice.reload(); await expect(alice.getByRole('button', { name: 'Unlock this device', exact: true })).toBeVisible({ timeout: 30_000 });
  await shoot(alice, '09-locked');
  await alice.getByRole('button', { name: 'Unlock this device', exact: true }).click(); await shoot(alice, '10-unlock-form');
  await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
  await alice.getByRole('button', { name: 'Unlock account', exact: true }).click();
  await expect(alice.locator('.chat-header')).toBeVisible({ timeout: 30_000 });
  for (const view of ['Profile', 'Appearance', 'Security', 'Devices', 'Privacy', 'Connection', 'Notifications', 'Calls', 'About security', 'Advanced']) {
    await alice.getByRole('button', { name: 'Open settings', exact: true }).click();
    if (view !== 'Settings') await alice.locator('.settings-panel').getByRole('button', { name: new RegExp(`^${view}`) }).first().click();
    await shoot(alice, `11-settings-${view.toLowerCase().replace(/\s+/g, '-')}`);
    await alice.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  const fresh2 = await (await browser.newContext()).newPage();
  await create(fresh2, 'Solo'); await shoot(fresh2, '12-new-account-empty');
  writeFileSync(`${dir}/findings.json`, JSON.stringify(findings, null, 1));
});
