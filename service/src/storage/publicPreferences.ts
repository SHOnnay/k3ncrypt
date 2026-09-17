import type { PublicPreferences } from '../core/contracts';

/** Plaintext storage intentionally limited to non-secret application preferences. */
export class IndexedDbPublicPreferences implements PublicPreferences {
    private readonly database: Promise<IDBDatabase>;

    constructor(databaseName = 'k3ncrypt-public-preferences') {
        this.database = new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('preferences');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Unable to open public preferences'));
        });
    }

    public async read(key: string): Promise<string | undefined> {
        return this.request('readonly', (store) => store.get(key)) as Promise<string | undefined>;
    }

    public async write(key: string, value: string): Promise<void> {
        await this.request('readwrite', (store) => store.put(value, key));
    }

    public async delete(key: string): Promise<void> {
        await this.request('readwrite', (store) => store.delete(key));
    }

    private async request(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
        const database = await this.database;
        return new Promise((resolve, reject) => {
            const request = action(database.transaction('preferences', mode).objectStore('preferences'));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Public preference operation failed'));
        });
    }
}
