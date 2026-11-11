// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Tiny promise wrapper around IndexedDB (offline queue, cached sessions, small key-value data). */

const DB_NAME = 'vocabbuilder';
const VERSION = 1;
export type StoreName = 'outbox' | 'sessions' | 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const idb = {
  get: <T>(store: StoreName, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  getAll: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  put: <T>(store: StoreName, value: T) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value)),
  delete: (store: StoreName, key: IDBValidKey) => run<undefined>(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>),
  clear: (store: StoreName) => run<undefined>(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>),
};

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await idb.get<{ key: string; value: T }>('kv', key))?.value;
  } catch {
    return undefined;
  }
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    await idb.put('kv', { key, value });
  } catch {
    /* storage unavailable (private mode) — non-critical */
  }
}
