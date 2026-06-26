/* IndexedDB-backed durable key/value store (B474).
 *
 * WHY: localStorage's hard ~5 MB per-origin cap is what let a full device store drop edits (B473).
 * IndexedDB gives gigabytes. Stage A moves the version-history ring here: storage.js keeps a synchronous
 * in-memory ring as the source of truth and writes through to here (durable, uncapped), so undo history is
 * no longer byte-throttled and survives reloads in a store that can't fill.
 *
 * SAFETY: a thin async kv layer that DEGRADES TO A NO-OP whenever IndexedDB is unavailable (private mode,
 * old browser, the node test env). storage.js then stays on its localStorage fallback exactly as before —
 * never worse than today. Every method resolves (never rejects) and swallows its own errors.
 */
const DB_NAME = "planyr";
const DB_VERSION = 1;
const STORE = "kv";
const idb = (typeof indexedDB !== "undefined" && indexedDB) ? indexedDB : null;

let dbPromise = null;
function openDb() {
  if (!idb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => { try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); } catch (_) {} };
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export const idbAvailable = () => !!idb;

// Read one key. Resolves the stored value, or null on miss / any failure. Never throws.
export async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readonly"); } catch (_) { resolve(null); return; }
    let req;
    try { req = tx.objectStore(STORE).get(key); } catch (_) { resolve(null); return; }
    req.onsuccess = () => resolve(req.result == null ? null : req.result);
    req.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

// Write one key (fire-and-forget durability). Resolves true on commit, false on any failure. Never throws.
export async function idbPut(key, value) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try { tx.objectStore(STORE).put(value, key); } catch (_) { try { tx.abort(); } catch (_2) {} resolve(false); }
  });
}

// Remove one key. Resolves true/false; never throws.
export async function idbDelete(key) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try { tx.objectStore(STORE).delete(key); } catch (_) { resolve(false); }
  });
}
