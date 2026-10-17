import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({page}) => { const errors: string[]=[]; pageErrors.set(page,errors); page.on('pageerror', error => errors.push(error.name)); });
test.afterEach(({page}) => { expect(pageErrors.get(page)).toEqual([]); });

// Only real components are rendered. The deferred fake transports below let us
// deterministically exercise callbacks after room switches, lock and teardown.
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    w.__urls = {created: [] as string[], revoked: [] as string[]};
    URL.createObjectURL = blob => { const url = create(blob); w.__urls.created.push(url); return url; };
    URL.revokeObjectURL = url => { w.__urls.revoked.push(url); revoke(url); };
    const listeners = new Set<() => void>();
    const pending: any[] = []; const sends: any[] = [];
    const state: any = { channelHash:'a', plaintextSession:{isCurrent:()=>true}, accountState:'ready', sessionHealth:'healthy',
      contactIdentity:{verification:'verified',changeStatus:'unchanged'}, conversations:[], messages:[], protocolMode:'modern',
      profileDisplayName:'Tester', privacyPreferences:{}, permissionStatus:{microphone:'prompt', camera:'prompt'},
      retryMessage:async () => undefined, refreshPermissionStatus:async () => undefined };
    let snapshot = state;
    const update = (next: any) => {
      if(next.plaintextSession) next.plaintextSession={isCurrent:()=>true};
      if(next.messages) next.messages=next.messages.map((message: any)=>({...message,timestamp:new Date(message.timestamp)}));
      snapshot = {...snapshot,...next};
      const room = snapshot.channelHash;
      snapshot.sendMessage = (text: string) => { sends.push({room,text}); return new Promise((resolve,reject) => pending.push({resolve,reject})); };
      listeners.forEach(fn => fn());
    };
    w.__ui = {snapshot: () => snapshot, subscribe:(fn: () => void) => {listeners.add(fn);return () => listeners.delete(fn);},
      update,sends,pending,downloads:[], disposed:0}; update({});
  });
  await page.route('**/src/context/ChatContext.tsx*', route => route.fulfill({contentType:'text/javascript',body:`
    export const useChat=()=>window.__ui.snapshot();
  `}));
  await page.route('**/src/context/FileContext.tsx*', route => route.fulfill({contentType:'text/javascript',body:`
    import {PreviewResources,FileOperationGate,FileOperationBusyError} from '/src/product/previewResources.ts';
    const previews=new PreviewResources(),gate=new FileOperationGate();
    const files={previews,transfer:{phase:'Idle',bytes:0,total:0},sendFile:async()=>{},retry:async()=>{},cancel:()=>{},
      receive:async reference=>{
        const ticket=gate.acquire();if(!ticket)throw new FileOperationBusyError('busy');
        return new Promise(resolve=>window.__ui.downloads.push(()=>resolve({file:new File(['test'],'test.bin'),filename:'test.bin',
          dispose:async()=>{window.__ui.disposed++;gate.release(ticket);}})));
      }};
    export const useFiles=()=>files;
  `}));
  await page.route('**/src/context/MediaContext.tsx*', route => route.fulfill({contentType:'text/javascript',body:'export const useMedia=()=>({receive:async()=>undefined});'}));
  const path = resolve('e2e/fixtures/web-improvements-harness.tsx');
  await page.route('**/__web-improvements', route => route.fulfill({contentType:'text/html',body:`<html><body><div id="app"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/@vite/client"></script><script type="module" src="/@fs${path}"></script></body></html>`}));
  await page.goto('/__web-improvements');
  await expect(page.locator('#msg-input')).toBeVisible();
}
const update = async (page: Page, state: any) => {
  await page.evaluate(state => (window as any).__ui.update(state), state);
  if(state.channelHash) await expect(page.locator('#room-marker')).toHaveText(state.channelHash);
};
const message = (id: string) => ({id,text:'Protected file',timestamp:new Date().toISOString(),type:'received',media:{kind:'file',reference:`k3ncrypt-file-v2:${id}`,size:4}});

test('drafts, delayed send results, double activation, focus, failure and lock are room/session fenced', async ({page}) => {
  await fixture(page);
  const input=page.locator('#msg-input');
  await input.fill('draft for A'); await input.press('Enter'); await input.press('Enter');
  expect(await page.evaluate(() => (window as any).__ui.sends)).toEqual([{room:'a',text:'draft for A'}]);
  await update(page,{channelHash:'b'}); await expect(input).toHaveValue(''); await input.fill('draft for B');
  await page.evaluate(() => (window as any).__ui.pending.shift().resolve());
  await expect(input).toHaveValue('draft for B'); await expect(input).toBeFocused();
  await update(page,{channelHash:'a'}); await expect(input).toHaveValue('');
  await update(page,{channelHash:'b'}); await input.press('Enter');
  await page.evaluate(() => (window as any).__ui.pending.shift().reject(new Error('synthetic unavailable')));
  await expect(input).toBeFocused(); await expect(input).toHaveValue('draft for B');
  await expect(page.getByRole('status').filter({hasText:'Your draft is retained'})).toBeVisible();
  await page.evaluate(() => (window as any).__ui.update({plaintextSession:undefined,accountState:'locked'}));
  await expect(input).toHaveValue('');
  await page.evaluate(() => (window as any).__ui.update({plaintextSession:{},accountState:'ready'}));
  await expect(input).toHaveValue('');
});

test('late downloads cannot attach to another room/message; previews survive Save cancellation and release on Close, lock and teardown', async ({page}) => {
  await fixture(page);
  await update(page,{messages:[message('same')]});
  await page.getByRole('button',{name:'Download protected file',exact:true}).click();
  await update(page,{channelHash:'b',messages:[message('same')]});
  await page.evaluate(() => (window as any).__ui.downloads.shift()());
  await expect(page.getByRole('link',{name:'Save test.bin'})).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__ui.disposed)).toBe(1);
  await page.getByRole('button',{name:'Download protected file',exact:true}).click();
  await page.evaluate(() => (window as any).__ui.downloads.shift()());
  const save=page.getByRole('link',{name:'Save test.bin'}); await expect(save).toBeVisible();
  const event=page.waitForEvent('download'); await save.click(); await (await event).cancel();
  await expect(save).toBeVisible();
  await update(page,{messages:[message('same'),message('second')]});
  await page.getByRole('button',{name:'Download protected file',exact:true}).click();
  await page.evaluate(() => (window as any).__ui.downloads.shift()());
  await expect(save).toHaveCount(2);
  await page.getByRole('button',{name:'Close',exact:true}).first().click(); await expect(save).toHaveCount(1);
  await page.evaluate(() => (window as any).__ui.update({plaintextSession:undefined,accountState:'locked'}));
  await expect(save).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__urls.created.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__urls.revoked.length)).toBe(2);
  await page.evaluate(() => (window as any).__ui.update({plaintextSession:{},accountState:'ready',messages:[{id:'last',text:'last',type:'received',timestamp:new Date().toISOString(),media:{kind:'file',reference:'k3ncrypt-file-v2:last'}}]}));
  await page.getByRole('button',{name:'Download protected file',exact:true}).click();
  await page.evaluate(() => (window as any).__ui.downloads.shift()()); await expect(save).toHaveCount(1);
  await update(page,{messages:[]}); await expect(save).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__urls.revoked.length)).toBe(3);
});

test('settings traps keyboard focus and returns it to its opener', async ({page}) => {
  await fixture(page); await page.locator('#settings-opener').click();
  const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for(const key of ['Tab','Shift+Tab']) for(let i=0;i<30;i++) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.locator('#settings-opener')).toBeFocused();
});

test('concurrent file clicks cannot acquire a second operation while the first is active', async ({page}) => {
  await fixture(page); await update(page,{messages:[message('first'),message('second')]});
  const buttons=page.getByRole('button',{name:'Download protected file',exact:true});
  await buttons.first().click(); await buttons.last().click();
  await expect(page.getByRole('status').filter({hasText:'Another file operation is still active'})).toBeVisible();
  expect(await page.evaluate(() => (window as any).__ui.downloads.length)).toBe(1);
  await page.evaluate(() => (window as any).__ui.downloads.shift()());
  await expect(page.getByRole('link',{name:'Save test.bin'})).toHaveCount(1);
  await page.getByRole('button',{name:'Download protected file',exact:true}).click();
  await page.evaluate(() => (window as any).__ui.downloads.shift()());
  await expect(page.getByRole('link',{name:'Save test.bin'})).toHaveCount(2);
});

test('history and status updates do not fight readers; reduced-motion following stays instant', async ({page}) => {
  await fixture(page); await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => {
    const w=window as any; w.__scrolls=[]; const scroll=Element.prototype.scrollTo;
    Element.prototype.scrollTo=function(options: any){w.__scrolls.push(options);return scroll.call(this,options);};
  });
  const messages=Array.from({length:80},(_,i)=>({id:String(i),text:`History ${i}`,type:'received',timestamp:new Date().toISOString()}));
  await update(page,{messages}); await expect(page.locator('.message')).toHaveCount(80);
  const area=page.locator('#messages-area');
  await expect.poll(()=>area.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(4);
  await area.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await update(page,{messages:[...messages,{id:'new',text:'incoming',type:'received',timestamp:new Date().toISOString()}]});
  await expect(page.locator('.message')).toHaveCount(81);expect(await area.evaluate(el=>el.scrollTop)).toBe(0);
  await update(page,{messages:[...messages,{id:'own',text:'outgoing',type:'sent',timestamp:new Date().toISOString(),delivery:'pending'}]});
  await expect.poll(()=>area.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(4);
  expect(await page.evaluate(()=>(window as any).__scrolls.every((item: any)=>item.behavior==='auto'))).toBe(true);
});

test('late failure and completion cannot change a new room or a newly unlocked identity draft', async ({page}) => {
  await fixture(page); const input=page.locator('#msg-input');
  await input.fill('old A'); await input.press('Enter');
  await update(page,{channelHash:'b'}); await input.fill('B only');
  await page.evaluate(()=>(window as any).__ui.pending.shift().reject(new Error('synthetic failure')));
  await expect(input).toHaveValue('B only');
  await expect(page.getByRole('status').filter({hasText:'confirm this message'})).toHaveCount(0);
  await input.press('Enter');
  await page.evaluate(()=>(window as any).__ui.update({plaintextSession:undefined,accountState:'locked'}));
  await expect(input).toHaveValue('');
  await page.evaluate(()=>(window as any).__ui.update({plaintextSession:{},accountState:'ready'}));
  await input.fill('new identity draft');
  await page.evaluate(()=>(window as any).__ui.pending.shift().resolve());
  await expect(input).toHaveValue('new identity draft');
});
