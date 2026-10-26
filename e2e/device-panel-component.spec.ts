import { test, expect } from '@playwright/test';
// Explicit component fixture, not a real enrollment or an authorization test.
// Actual authenticated device-list and failed enrollment checks live in security-panels.spec.ts.
test('device component states, overlap, confirmation cancellation and duplicate-action guard', async ({ browser, baseURL }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.route('**/src/context/ChatContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const useChat = () => globalThis.panelFixture;' }));
    await page.route('**/device-panel-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="paper"><head><style>body{margin:0}</style></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {ThemeProvider} from '/src/theme/ThemeContext.tsx';
      import '/src/theme/tokens.css';
      import '/src/styles/global.css';
      import '/src/components/common/Button.css';
      import {SettingsPanel} from '/src/components/Settings/SettingsPanel.tsx';
      window.actions = 0;
      window.panelFixture = { channelHash:'fixture-room', profileDisplayName:'Component fixture', ownFingerprint:'local-fixture', userId:'routing-fixture', protocolMode:'modern', accountState:'ready', syncStatus:'ready', sessionHealth:'healthy', conversations:[], permissionStatus:{microphone:'unknown',camera:'unknown'}, contactIdentity:{verification:'verified',changeStatus:'unchanged'},privacyPreferences:{mutedConversations:[]}, deviceLifecycleState:{list:{devices:[
        {deviceId:'local-device',publicIdentityReference:'local-fixture',state:'active'},
        {deviceId:'other-device-123456',label:'Disposable component fixture with a long device label',publicIdentityReference:'fixture-peer-reference',state:'active'},
        {deviceId:'pending-device-123456',publicIdentityReference:'pending-fixture',state:'approved_pending_confirmation'},
        {deviceId:'revoked-device-123456',publicIdentityReference:'revoked-fixture',state:'revoked'}]}}, revokeDevice: async () => { window.actions++; await new Promise(resolve => {window.finishAction=resolve}); } };
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ThemeProvider,null,React.createElement(SettingsPanel,{isOpen:true,initialView:'devices',onClose:()=>{}})));
    </script></body></html>` }));
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/device-panel-fixture`);
    const dialog = page.getByRole('dialog', { name: 'Devices', exact: true });
    await expect(dialog).toBeVisible(); expect(errors).toEqual([]);
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('article', { name: 'This device', exact: true }).locator('summary')).toBeFocused();
    const target = dialog.locator('.device-card').filter({ hasText: 'Disposable component fixture' });
    const revoke = target.getByRole('button', { name: 'Revoke', exact: true });
    await expect(dialog.getByRole('article', { name: 'This device', exact: true }).getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
    await expect(dialog.locator('.device-card').filter({ hasText: 'Revoked' }).getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('Approved · confirmation needed');
    for (const width of [320, 360, 393]) {
      await page.setViewportSize({ width, height: 740 });
      const boxes = await target.evaluate(card => {
        const copy = card.querySelector('.device-card__copy')!.getBoundingClientRect(); const button = card.querySelector('button')!.getBoundingClientRect();
        return { overlap: Math.min(copy.right, button.right) > Math.max(copy.left, button.left) && Math.min(copy.bottom, button.bottom) > Math.max(copy.top, button.top), overflow: card.scrollWidth > card.clientWidth + 1 };
      });
      expect(boxes).toEqual({ overlap: false, overflow: false });
    }
    page.once('dialog', prompt => { expect(prompt.message()).toContain('does not erase'); return prompt.dismiss(); });
    await revoke.click(); expect(await page.evaluate(() => (window as any).actions)).toBe(0);
    page.once('dialog', prompt => prompt.accept()); await revoke.click();
    await expect(revoke).toBeDisabled(); expect(await page.evaluate(() => (window as any).actions)).toBe(1);
    await page.evaluate(() => (window as any).finishAction()); await expect(revoke).toBeEnabled();
    for (const mode of ['paper', 'slate']) {
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, mode);
      const ratio = await revoke.evaluate(button => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        const lum = (color: string) => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const c = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
        };
        const css = getComputedStyle(button); const [a, b] = [lum(css.color), lum(css.backgroundColor)].sort((a, b) => b - a);
        return (a + .05) / (b + .05);
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'paper'; });
    await page.screenshot({ path: '/private/tmp/k3ncrypt-security-panels-evidence/after-device-layout-component-fixture-393.png' });
  } finally { await context.close(); }
});
