// =====================================================
// Page bitmap store — IndexedDB
// =====================================================
// The draft autosave stringifies the whole submission into localStorage. That
// works for text and a handful of per-question images; it does not survive a
// handwritten submission, where eight ingested pages are 3–5 MB of base64
// against a ~5–10 MB origin quota. The failure mode is a QuotaExceededError
// mid-autosave and a silently lost draft — which for handwritten work means
// re-photographing everything (HANDWRITTEN_REGIONS_SPEC.md §5.5).
//
// So the storage splits: page bitmaps live here as Blobs (no practical quota,
// and ~33% smaller than base64), everything else stays in localStorage exactly
// as before. Regions reference pages by id, so the two stores rejoin on a
// stable key.
//
// If IndexedDB is unavailable (Safari private browsing, storage disabled), the
// store degrades to an in-memory map: uploads still work for the session, and
// the caller finds the bitmaps missing on the next load and asks for them
// again — the same path as a cleared cache.
// =====================================================

const DB_NAME = 'gradebridge_pages';
const DB_VERSION = 1;
const STORE = 'pages';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallback = new Map<string, Blob>();

let usingMemoryFallback = false;

/** True once a real IndexedDB connection has failed and pages live in memory only. */
export const isUsingMemoryFallback = (): boolean => usingMemoryFallback;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        usingMemoryFallback = true;
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { usingMemoryFallback = true; resolve(null); };
      request.onblocked = () => { usingMemoryFallback = true; resolve(null); };
    } catch {
      usingMemoryFallback = true;
      resolve(null);
    }
  });
  return dbPromise;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const putPageBlob = async (id: string, blob: Blob): Promise<void> => {
  const db = await openDb();
  if (!db) { memoryFallback.set(id, blob); return; }
  const written = await withStore<IDBValidKey>('readwrite', (store) => store.put(blob, id));
  // A quota or serialisation failure must not lose the page the student just
  // took — keep it for the session at least.
  if (written === null) memoryFallback.set(id, blob);
};

export const getPageBlob = async (id: string): Promise<Blob | null> => {
  const stored = await withStore<Blob>('readonly', (store) => store.get(id));
  if (stored instanceof Blob) return stored;
  return memoryFallback.get(id) ?? null;
};

export const deletePageBlob = async (id: string): Promise<void> => {
  memoryFallback.delete(id);
  await withStore<undefined>('readwrite', (store) => store.delete(id));
};

export const listPageIds = async (): Promise<string[]> => {
  const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  const fromDb = Array.isArray(keys) ? keys.map(String) : [];
  return Array.from(new Set([...fromDb, ...memoryFallback.keys()]));
};

/** Drops bitmaps for pages the student has removed. */
export const pruneExcept = async (keepIds: string[]): Promise<void> => {
  const keep = new Set(keepIds);
  const existing = await listPageIds();
  await Promise.all(existing.filter((id) => !keep.has(id)).map(deletePageBlob));
};

export const clearPageBlobs = async (): Promise<void> => {
  memoryFallback.clear();
  await withStore<undefined>('readwrite', (store) => store.clear());
};
