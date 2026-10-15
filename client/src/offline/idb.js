// Tiny promise-based IndexedDB helper. No dependencies — just enough for the
// offline scanner (scan packs, the pending-scan queue, and local state).

const DB_NAME = 'attendx-offline';
const DB_VERSION = 1;
const STORES = {
  packs: { keyPath: 'eventId' },
  queue: { keyPath: 'clientScanId' },
  local: { keyPath: 'key' },
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore(name, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(store, value) {
  await withStore(store, 'readwrite', (s) => {
    s.put(value);
  });
  return value;
}

export async function idbDelete(store, key) {
  await withStore(store, 'readwrite', (s) => {
    s.delete(key);
  });
}

export async function idbCount(store) {
  const db = await open();
  const req = db.transaction(store, 'readonly').objectStore(store).count();
  return reqToPromise(req).catch(() => 0);
}
