export type StoreSegmentedImportSession = {
    sessionKey: string;
    catalogItemId: string;
    bankId: string;
    variantId: string;
    mode: 'low_memory_segmented';
    fileName: string;
    fileSizeBytes: number | null;
    completedPartIndexes: number[];
    totalParts: number;
    sourceRevisionHash: string | null;
    createdAt: number;
    updatedAt: number;
};

type SessionPartRecord = {
    sessionKey: string;
    partIndex: number;
    blob: Blob;
    sha256: string | null;
    fileSizeBytes: number;
    savedAt: number;
};

const DB_NAME = 'vdjv-store-segmented-import-v1';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const PART_STORE = 'parts';

const hasIndexedDb = (): boolean =>
    typeof indexedDB !== 'undefined' && indexedDB !== null;

const openDb = async (): Promise<IDBDatabase | null> => {
    if (!hasIndexedDb()) return null;
    return await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SESSION_STORE)) {
                db.createObjectStore(SESSION_STORE, { keyPath: 'sessionKey' });
            }
            if (!db.objectStoreNames.contains(PART_STORE)) {
                const store = db.createObjectStore(PART_STORE, { keyPath: ['sessionKey', 'partIndex'] });
                store.createIndex('bySession', 'sessionKey', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });
};

const withStore = async <T,>(
    storeName: string,
    mode: IDBTransactionMode,
    task: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T,
): Promise<T | null> => {
    const db = await openDb();
    if (!db) return null;
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            Promise.resolve(task(store, tx)).then((value) => {
                tx.oncomplete = () => resolve(value);
                tx.onerror = () => reject(tx.error || new Error(`IndexedDB ${storeName} transaction failed`));
                tx.onabort = () => reject(tx.error || new Error(`IndexedDB ${storeName} transaction aborted`));
            }).catch(reject);
        });
    } finally {
        db.close();
    }
};

const idbGet = <T,>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error || new Error('IndexedDB get failed'));
    });

const idbPut = (store: IDBObjectStore, value: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
        const request = store.put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('IndexedDB put failed'));
    });

const idbDelete = (store: IDBObjectStore, key: IDBValidKey): Promise<void> =>
    new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('IndexedDB delete failed'));
    });

const idbGetAllBySession = async <T,>(store: IDBObjectStore, sessionKey: string): Promise<T[]> => {
    const index = store.index('bySession');
    return await new Promise((resolve, reject) => {
        const request = index.getAll(IDBKeyRange.only(sessionKey));
        request.onsuccess = () => resolve((request.result || []) as T[]);
        request.onerror = () => reject(request.error || new Error('IndexedDB getAll failed'));
    });
};

export const buildStoreSegmentedImportSessionKey = (catalogItemId: string, variantId: string): string =>
    `${catalogItemId}:${variantId}`;

export const loadStoreSegmentedImportSession = async (sessionKey: string): Promise<StoreSegmentedImportSession | null> => {
    const result = await withStore<StoreSegmentedImportSession | undefined>(SESSION_STORE, 'readonly', (store) =>
        idbGet<StoreSegmentedImportSession>(store, sessionKey),
    );
    return result || null;
};

export const saveStoreSegmentedImportSession = async (session: StoreSegmentedImportSession): Promise<void> => {
    await withStore(SESSION_STORE, 'readwrite', (store) => idbPut(store, session));
};

export const saveStoreSegmentedImportPart = async (part: SessionPartRecord): Promise<void> => {
    await withStore(PART_STORE, 'readwrite', (store) => idbPut(store, part));
};

export const loadStoreSegmentedImportPart = async (sessionKey: string, partIndex: number): Promise<SessionPartRecord | null> => {
    const result = await withStore<SessionPartRecord | undefined>(PART_STORE, 'readonly', (store) =>
        idbGet<SessionPartRecord>(store, [sessionKey, partIndex]),
    );
    return result || null;
};

export const listStoreSegmentedImportParts = async (sessionKey: string): Promise<SessionPartRecord[]> => {
    const result = await withStore<SessionPartRecord[]>(PART_STORE, 'readonly', (store) =>
        idbGetAllBySession<SessionPartRecord>(store, sessionKey),
    );
    return result || [];
};

export const deleteStoreSegmentedImportSession = async (sessionKey: string): Promise<void> => {
    await withStore(SESSION_STORE, 'readwrite', async (sessionStore) => {
        await idbDelete(sessionStore, sessionKey);
    });
    await withStore(PART_STORE, 'readwrite', async (partStore) => {
        const records = await idbGetAllBySession<SessionPartRecord>(partStore, sessionKey);
        for (const record of records) {
            await idbDelete(partStore, [record.sessionKey, record.partIndex]);
        }
    });
};
