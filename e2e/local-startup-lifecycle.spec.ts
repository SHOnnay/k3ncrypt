import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { connectedPair, invite } from './usabilityHelpers';

test('unlocked saved contacts appear while legacy invitation expiry enrichment is stalled', async ({ browser }) => {
  test.setTimeout(60000);
  const {a,b,alice}=await connectedPair(browser);
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
  try {
    await invite(alice);
    // Model an old saved descriptor, retaining its real generated capability and all encrypted identity records.
    await alice.evaluate(async ({storageModule,persistenceModule})=>{
      const {BrowserSecureStorage}=await import(/* @vite-ignore */ storageModule);
      const {IndexedDbVaultPersistence}=await import(/* @vite-ignore */ persistenceModule);
      const vault=new BrowserSecureStorage(new IndexedDbVaultPersistence());
      await vault.unlock('alpha-family-existing-account-2026');
      const records=JSON.parse(new TextDecoder().decode(await vault.read('product-session','conversations')));
      for(const item of records) if(item.relationship==='invitation'&&!item.remoteAddress){delete item.pendingInvitationExpiresAt;delete item.signedInvitation;}
      await vault.write('product-session','conversations',new TextEncoder().encode(JSON.stringify(records)).buffer);vault.lock();
    },{storageModule:`/@fs${resolve('service/src/storage/secureVault.ts')}`,persistenceModule:`/@fs${resolve('service/src/storage/persistence.ts')}`});
    let probes=0;
    await alice.route('**/api/chat-link/status/*',async route=>{probes++;await gate;await route.continue().catch(()=>undefined);});
    await alice.reload();
    await alice.getByRole('button',{name:'Unlock this device',exact:true}).click();
    await alice.locator('input[type=password]').fill('alpha-family-existing-account-2026');
    const started=Date.now();await alice.getByRole('button',{name:'Unlock account',exact:true}).click();
    await expect(alice.locator('.conversation-row').filter({hasText:'Bob'})).toBeVisible({timeout:5000});
    expect(probes).toBeGreaterThan(0);
    console.log('LOCAL_STARTUP_SAFE',JSON.stringify({unlockToSavedContactMs:Date.now()-started,unresolvedExpiryRequests:probes}));
  }finally{release();await a.close();await b.close();}
});
