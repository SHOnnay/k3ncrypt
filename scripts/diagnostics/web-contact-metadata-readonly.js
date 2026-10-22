/* Owner-run diagnostic for live 871fa99. Counts keys only: no vault values, decryption,
 * identifiers, network requests, exports, repair, writes, deletes or schema upgrades.
 * Run only after preserving a closed-browser local backup. Do not share browser profiles.
 */
(async () => {
  const report = { diagnostic: 'K3NCRYPT_CONTACT_METADATA_V1', status: 'BLOCKED' };
  const done = (category, fields = {}) => {
    const result = { ...report, category, ...fields };
    console.info('K3NCRYPT_CONTACT_METADATA_V1', result);
    return result;
  };
  if (location.origin !== 'https://k3ncrypt.onrender.com') return done('WRONG_ORIGIN');
  if (typeof indexedDB.databases !== 'function') return done('DATABASE_LIST_UNAVAILABLE');
  let databases;
  try { databases = await indexedDB.databases(); }
  catch { return done('DATABASE_LIST_FAILED'); }
  if (!databases.some(entry => entry.name === 'k3ncrypt-local-vault')) return done('VAULT_DATABASE_ABSENT');
  return new Promise(resolve => {
    let database; let settled = false;
    const finish = (category, fields = {}) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); database?.close();
      resolve(done(category, fields));
    };
    const timeout = setTimeout(() => finish('READ_TIMED_OUT'), 5000);
    let request;
    try { request = indexedDB.open('k3ncrypt-local-vault'); }
    catch { finish('DATABASE_OPEN_FAILED'); return; }
    request.onupgradeneeded = () => {
      request.transaction.abort(); // Never create or upgrade even if the database disappears in a race.
      finish('SCHEMA_CHANGE_REFUSED');
    };
    request.onblocked = () => finish('DATABASE_OPEN_BLOCKED');
    request.onerror = () => finish('DATABASE_OPEN_FAILED');
    request.onsuccess = () => {
      database = request.result;
      if (settled) { database.close(); return; }
      database.onversionchange = () => { database.close(); finish('SCHEMA_CHANGED_DURING_READ'); };
      if (database.version !== 1 || !database.objectStoreNames.contains('secure_records') || !database.objectStoreNames.contains('vault_metadata')) {
        finish('UNEXPECTED_SCHEMA'); return;
      }
      const counts = { contactIdentityRecords: 0, conversationProtocolRecords: 0,
        olmSessionRecords: 0, hasConversationIndex: false, hasRemovalIndex: false,
        hasTrustResetMarker: false, hasVaultMetadata: false, truncated: false };
      let transaction;
      try { transaction = database.transaction(['secure_records', 'vault_metadata'], 'readonly'); }
      catch { finish('READ_TRANSACTION_FAILED'); return; }
      transaction.onabort = () => finish('READ_TRANSACTION_ABORTED');
      transaction.onerror = () => finish('READ_TRANSACTION_FAILED');
      transaction.oncomplete = () => finish('COUNTS_ONLY', { status: 'OK', ...counts });
      const metadata = transaction.objectStore('vault_metadata').getKey('active');
      metadata.onsuccess = () => { counts.hasVaultMetadata = metadata.result !== undefined; };
      const cursor = transaction.objectStore('secure_records').openKeyCursor();
      let inspected = 0;
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (inspected++ === 10000) { counts.truncated = true; return; }
        // Do not print, retain or return full record keys.
        const key = entry.key;
        if (typeof key === 'string') {
          if (key.startsWith('contact-identity:')) counts.contactIdentityRecords++;
          else if (key.startsWith('conversation-protocol:')) counts.conversationProtocolRecords++;
          else if (key.startsWith('vodozemac-session:')) counts.olmSessionRecords++;
          else if (key === 'product-session:conversations') counts.hasConversationIndex = true;
          else if (key === 'product-session:conversation-removals') counts.hasRemovalIndex = true;
          else if (key === 'contact-trust-reset:local') counts.hasTrustResetMarker = true;
        }
        entry.continue();
      };
    };
  });
})();
