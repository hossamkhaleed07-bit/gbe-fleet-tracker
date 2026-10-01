// Tiny IndexedDB key/value cache for the Fuel & Invoice module — lets the
// Entries/Data Base pages paint the last-known rows instantly while the real
// data reloads in the background (stale-while-revalidate). IndexedDB rather
// than localStorage because the record set outgrows localStorage's ~5MB.
// Every call swallows its own errors: a blocked/cleared/private-mode store
// just means "no cache", never a broken page.
const DB_NAME = "gbe-fuel-invoice-cache";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function cacheGet(key) {
  try { return (await withStore("readonly", s => s.get(key))) ?? null; } catch { return null; }
}
export async function cacheSet(key, value) {
  try { await withStore("readwrite", s => s.put(value, key)); } catch { /* no cache is fine */ }
}
// Called on logout so a shared PC doesn't keep the previous user's records.
export async function cacheClearAll() {
  try { await withStore("readwrite", s => s.clear()); } catch { /* ignore */ }
}
