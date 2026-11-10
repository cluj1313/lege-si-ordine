// IndexedDB separat de Notis: baza „lso_db”, magazine cu prefix propriu.
const DB_NAME = 'lso_db';
const DB_VER = 1;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['lso_kv', 'lso_tabs', 'lso_items', 'lso_media', 'lso_backups']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('abort'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const S = { kv: 'lso_kv', tabs: 'lso_tabs', items: 'lso_items', media: 'lso_media', backups: 'lso_backups' };

export const db = {
  get: (store, id) => tx(store, 'readonly', s => req(s.get(id))),
  all: (store) => tx(store, 'readonly', s => req(s.getAll())),
  put: (store, val) => tx(store, 'readwrite', s => { s.put(val); }),
  putMany: (store, vals) => tx(store, 'readwrite', s => { for (const v of vals) s.put(v); }),
  del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  clear: (store) => tx(store, 'readwrite', s => { s.clear(); }),
  async kvGet(id, def) { const r = await this.get(S.kv, id); return r ? r.v : def; },
  kvSet(id, v) { return this.put(S.kv, { id, v }); },
};
