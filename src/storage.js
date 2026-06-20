// Zero — IndexedDB wrapper. Lightweight key/value + collections.
const DB_NAME = "zero";
const DB_VERSION = 2;
const STORES = ["kv", "messages", "memory", "files", "wiki"];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          if (s === "kv") db.createObjectStore(s);
          else db.createObjectStore(s, { keyPath: "id", autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = "readonly") {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}

export const kv = {
  async get(key) {
    const s = await tx("kv");
    return new Promise((res, rej) => {
      const r = s.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async set(key, value) {
    const s = await tx("kv", "readwrite");
    return new Promise((res, rej) => {
      const r = s.put(value, key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
  async del(key) {
    const s = await tx("kv", "readwrite");
    return new Promise((res, rej) => {
      const r = s.delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
};

export const collection = (name) => ({
  async add(item) {
    const s = await tx(name, "readwrite");
    return new Promise((res, rej) => {
      const r = s.add({ ...item, ts: item.ts ?? Date.now() });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(item) {
    const s = await tx(name, "readwrite");
    return new Promise((res, rej) => {
      const r = s.put(item);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async del(id) {
    const s = await tx(name, "readwrite");
    return new Promise((res, rej) => {
      const r = s.delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
  async all() {
    const s = await tx(name);
    return new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async clear() {
    const s = await tx(name, "readwrite");
    return new Promise((res, rej) => {
      const r = s.clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
});

export async function init() {
  await open();
}
