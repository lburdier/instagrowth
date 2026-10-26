// Mini-wrapper IndexedDB utilisable dans le service worker et les pages.

const DB_NAME = 'instagrowth';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('leads')) {
        const s = db.createObjectStore('leads', { keyPath: 'pk' });
        s.createIndex('status', 'status');
        s.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('posts')) {
        const s = db.createObjectStore('posts', { keyPath: 'id' });
        s.createIndex('scheduledAt', 'scheduledAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  put: (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value))),
  putMany: (store, values) => tx(store, 'readwrite', (s) => Promise.all(values.map((v) => wrap(s.put(v))))),
  delete: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  count: (store) => tx(store, 'readonly', (s) => wrap(s.count())),
  /** Lecture + écriture atomique d'un enregistrement. */
  async update(store, key, fn) {
    const cur = await this.get(store, key);
    const next = fn(cur);
    if (next) await this.put(store, next);
    return next;
  },
};
