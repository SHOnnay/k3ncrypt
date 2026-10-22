const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, 'web-contact-metadata-readonly.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(run, entries = [], version = 1, origin = 'https://k3ncrypt.onrender.com') {
  const context = await browser.newContext();
  // All URLs are fulfilled from memory; the test never contacts Render.
  await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><title>Disposable metadata fixture</title></html>' }));
  const page = await context.newPage();
  try {
    await page.goto(origin);
    if (entries !== null) await page.evaluate(async ({ entries, version }) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('k3ncrypt-local-vault', version);
        request.onupgradeneeded = () => { request.result.createObjectStore('secure_records'); request.result.createObjectStore('vault_metadata'); };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result; const tx = db.transaction(['secure_records', 'vault_metadata'], 'readwrite');
          for (const key of entries) tx.objectStore('secure_records').put('synthetic-encrypted-value', key);
          tx.objectStore('vault_metadata').put('synthetic-wrapped-key', 'active');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
    }, { entries, version });
    return await run(page);
  } finally { await context.close(); }
}
async function snapshot(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'k3ncrypt-local-vault')) return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('k3ncrypt-local-vault');
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['secure_records', 'vault_metadata'], 'readonly'); const result = {};
        for (const name of ['secure_records', 'vault_metadata']) {
          const keys = tx.objectStore(name).getAllKeys(); const values = tx.objectStore(name).getAll();
          values.onsuccess = () => { result[name] = [keys.result, values.result]; };
        }
        tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => reject(tx.error);
      };
    });
  });
}
test('counts namespaces without reading values, writing, networking or exposing record identifiers', async () => {
  await fixture(async page => {
    const before = await snapshot(page);
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      const decrypt = SubtleCrypto.prototype.decrypt;
      SubtleCrypto.prototype.decrypt = () => { throw new Error('Test disallows decryption'); };
      const exportUrl = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error('Test disallows file exports'); };
      globalThis.restoreDiagnosticGuards = () => {
        IDBDatabase.prototype.transaction = transaction; IDBObjectStore.prototype.get = get;
        SubtleCrypto.prototype.decrypt = decrypt; URL.createObjectURL = exportUrl;
      };
      IDBDatabase.prototype.transaction = function(stores, mode, ...args) {
        if (mode !== 'readonly') throw new Error('Test disallows writes');
        return transaction.call(this, stores, mode, ...args);
      };
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = () => { throw new Error('Test disallows value reads'); };
      globalThis.fetch = () => { throw new Error('Test disallows network'); };
      globalThis.XMLHttpRequest = () => { throw new Error('Test disallows network'); };
    });
    const result = await page.evaluate(source);
    assert.equal(result.status, 'OK'); assert.equal(result.contactIdentityRecords, 1);
    assert.equal(result.conversationProtocolRecords, 1); assert.equal(result.olmSessionRecords, 1);
    assert.equal(result.hasVaultMetadata, true); assert.equal(result.hasConversationIndex, true);
    assert.equal(result.hasTrustResetMarker, true); assert.equal(result.hasRemovalIndex, true);
    assert.equal(result.truncated, false);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-encrypted-value|peer-secret-id|room-secret-id|synthetic-wrapped-key/);
    await page.evaluate(() => globalThis.restoreDiagnosticGuards());
    assert.deepEqual(await snapshot(page), before);
  }, ['contact-identity:peer-secret-id', 'conversation-protocol:room-secret-id', 'vodozemac-session:room-secret-id',
    'product-session:conversations', 'product-session:conversation-removals', 'contact-trust-reset:local']);
});
test('shows globally absent contact keys with preserved protocol and session keys', async () => {
  await fixture(async page => {
    const before = await snapshot(page); const result = await page.evaluate(source);
    assert.equal(result.contactIdentityRecords, 0); assert.equal(result.conversationProtocolRecords, 1);
    assert.equal(result.olmSessionRecords, 1); assert.deepEqual(await snapshot(page), before);
  }, ['conversation-protocol:room', 'vodozemac-session:room', 'product-session:conversations']);
});
test('does not create a missing database', async () => {
  await fixture(async page => {
    assert.equal((await page.evaluate(source)).category, 'VAULT_DATABASE_ABSENT');
    assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []);
  }, null);
});
test('refuses an unexpected origin without opening a database', async () => {
  await fixture(async page => {
    assert.equal((await page.evaluate(source)).category, 'WRONG_ORIGIN');
    assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []);
  }, null, 1, 'https://disposable.invalid');
});
test('does not migrate an unexpected schema', async () => {
  await fixture(async page => {
    const before = await snapshot(page);
    assert.equal((await page.evaluate(source)).category, 'UNEXPECTED_SCHEMA');
    assert.deepEqual(await snapshot(page), before);
    assert.equal((await page.evaluate(() => indexedDB.databases()))[0].version, 2);
  }, ['contact-identity:synthetic'], 2);
});
test('aborts attempted database creation when enumeration races with removal', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      globalThis.originalDatabaseList = indexedDB.databases.bind(indexedDB);
      indexedDB.databases = async () => [{ name: 'k3ncrypt-local-vault', version: 1 }];
    });
    assert.equal((await page.evaluate(source)).category, 'SCHEMA_CHANGE_REFUSED');
    assert.deepEqual(await page.evaluate(() => globalThis.originalDatabaseList()), []);
  }, null);
});
test('limits inspection to 10000 keys and reports truncation', async () => {
  await fixture(async page => {
    const before = await snapshot(page); const result = await page.evaluate(source);
    assert.equal(result.status, 'OK'); assert.equal(result.contactIdentityRecords, 10000);
    assert.equal(result.truncated, true); assert.deepEqual(await snapshot(page), before);
  }, Array.from({ length: 10001 }, (_, i) => 'contact-identity:synthetic-' + i));
});
