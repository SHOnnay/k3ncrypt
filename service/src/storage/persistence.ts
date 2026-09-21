export interface VaultPersistence {
    compareAndSwapRecords?(updates: readonly { key: string; expected: string | undefined; next: string }[]): Promise<boolean>;
    loadMetadata(): Promise<string | undefined>;
    saveMetadata(value: string): Promise<void>;
    readRecord(key: string): Promise<string | undefined>;
    writeRecord(key: string, value: string): Promise<void>;
    deleteRecord(key: string): Promise<void>;
}

/** Deterministic adapter for unit tests; it performs the same copy boundaries as IndexedDB. */
export class MemoryVaultPersistence implements VaultPersistence {
    public async compareAndSwapRecords(updates: readonly { key: string; expected: string | undefined; next: string }[]): Promise<boolean> {
        if (new Set(updates.map((item) => item.key)).size !== updates.length) throw new Error('Duplicate transaction key.');
        if (updates.some((item) => this.records.get(item.key) !== item.expected)) return false;
        for (const item of updates) this.records.set(item.key, item.next);
        return true;
    }
    private metadata?: string;
    private readonly records = new Map<string, string>();

    public async loadMetadata(): Promise<string | undefined> {
        return this.metadata;
    }

    public async saveMetadata(value: string): Promise<void> {
        this.metadata = `${value}`;
    }

    public async readRecord(key: string): Promise<string | undefined> {
        const value = this.records.get(key);
        return value === undefined ? undefined : `${value}`;
    }

    public async writeRecord(key: string, value: string): Promise<void> {
        this.records.set(key, `${value}`);
    }

    public async deleteRecord(key: string): Promise<void> {
        this.records.delete(key);
    }

    /** Test inspection only: persisted values must remain ciphertext envelopes. */
    public inspectRecord(key: string): string | undefined {
        return this.records.get(key);
    }

    /** Test corruption hook. */
    public corruptMetadata(value: string): void {
        this.metadata = value;
    }

    /** Test corruption hook. */
    public corruptRecord(key: string, value: string): void {
        this.records.set(key, value);
    }
}

const DATABASE_NAME = 'k3ncrypt-local-vault';
const DATABASE_VERSION = 1;
const METADATA_STORE = 'vault_metadata';
const RECORD_STORE = 'secure_records';

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
});
const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
});

/**
 * Browser persistence for opaque encrypted records. Neither this adapter nor
 * IndexedDB ever receives plaintext secret values.
 */
export class IndexedDbVaultPersistence implements VaultPersistence {
    public async compareAndSwapRecords(updates: readonly { key: string; expected: string | undefined; next: string }[]): Promise<boolean> {
        if (updates.length === 0 || new Set(updates.map((item) => item.key)).size !== updates.length) throw new Error('Invalid transaction.');
        const database = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(RECORD_STORE, 'readwrite');
            const store = transaction.objectStore(RECORD_STORE);
            let remaining = updates.length;
            let mismatch = false;
            transaction.oncomplete = () => resolve(true);
            transaction.onabort = () => mismatch ? resolve(false) : reject(transaction.error ?? new Error('Security transaction aborted.'));
            // Deliberate CAS abort also emits request errors. Settle only on
            // abort/complete so a stale writer returns false, never early success.
            for (const item of updates) {
                const request = store.get(item.key);
                request.onsuccess = () => {
                    if (mismatch) return;
                    if (request.result !== item.expected) { mismatch = true; transaction.abort(); return; }
                    if (--remaining === 0) for (const update of updates) store.put(update.next, update.key);
                };
            }
        });
    }
    private database?: Promise<IDBDatabase>;

    public async loadMetadata(): Promise<string | undefined> {
        return this.read(METADATA_STORE, 'active');
    }

    public async saveMetadata(value: string): Promise<void> {
        await this.write(METADATA_STORE, 'active', value);
    }

    public async readRecord(key: string): Promise<string | undefined> {
        return this.read(RECORD_STORE, key);
    }

    public async writeRecord(key: string, value: string): Promise<void> {
        await this.write(RECORD_STORE, key, value);
    }

    public async deleteRecord(key: string): Promise<void> {
        const database = await this.open();
        const transaction = database.transaction(RECORD_STORE, 'readwrite');
        const completed = transactionComplete(transaction);
        await Promise.all([requestResult(transaction.objectStore(RECORD_STORE).delete(key)), completed]);
    }

    private open(): Promise<IDBDatabase> {
        if (!this.database) {
            this.database = new Promise((resolve, reject) => {
                const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(METADATA_STORE)) {
                        database.createObjectStore(METADATA_STORE);
                    }
                    if (!database.objectStoreNames.contains(RECORD_STORE)) {
                        database.createObjectStore(RECORD_STORE);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB vault'));
            });
        }
        return this.database;
    }

    private async read(store: string, key: string): Promise<string | undefined> {
        const database = await this.open();
        const transaction = database.transaction(store, 'readonly');
        return requestResult(transaction.objectStore(store).get(key)) as Promise<string | undefined>;
    }

    private async write(store: string, key: string, value: string): Promise<void> {
        const database = await this.open();
        const transaction = database.transaction(store, 'readwrite');
        const completed = transactionComplete(transaction);
        await Promise.all([requestResult(transaction.objectStore(store).put(value, key)), completed]);
    }
}
