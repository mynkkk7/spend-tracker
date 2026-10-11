// Thin IndexedDB wrapper. Everything lives on this device only.
const DB_NAME = 'spend-tracker';
const DB_VERSION = 1;
export const STORES = ['accounts', 'kinds', 'categories', 'txns', 'commitments', 'planned', 'meta'];

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export const put = (store, obj) => tx(store, 'readwrite', (t) => { t.objectStore(store).put(obj); });
export const putMany = (store, objs) => tx(store, 'readwrite', (t) => { const s = t.objectStore(store); objs.forEach((o) => s.put(o)); });
export const del = (store, id) => tx(store, 'readwrite', (t) => { t.objectStore(store).delete(id); });

/** Replace the whole database (used by restore). */
export async function replaceAll(data) {
  await tx(STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      (data[s] || []).forEach((o) => os.put(o));
    }
  });
}

export async function loadAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* best effort */ }
}
