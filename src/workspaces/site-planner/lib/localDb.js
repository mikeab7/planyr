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
  // SELF-HEAL (B474 review): null `dbPromise` on EVERY non-success path before resolving null, so one
  // transient open failure (a momentary onblocked from another tab, a thrown open) can't POISON IndexedDB
  // for the whole session — the next idbGet/idbPut just reopens. Pre-fix, a cached null promise made every
  // later op silently no-op while idbAvailable() still said true → a raster whose src had been dropped
  // (idbKey set) was then unrecoverable. (#1)
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (_) { dbPromise = null; resolve(null); return; }
    req.onupgradeneeded = () => { try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); } catch (_) {} };
    req.onsuccess = () => {
      const db = req.result || null;
      if (db) {
        // A future schema bump in another tab, or indexedDB.deleteDatabase("planyr"), must not hang
        // forever on this pinned connection — close + drop the cache so the next call reopens fresh. (#3)
        db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
        // The browser force-closed us (storage eviction / "clear site data" / disk error): drop the
        // cached handle so the NEXT op reopens instead of failing every transaction for the session. (#3)
        db.onclose = () => { dbPromise = null; };
      } else { dbPromise = null; }
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; resolve(null); };
    req.onblocked = () => { dbPromise = null; resolve(null); };
  });
  return dbPromise;
}

export const idbAvailable = () => !!idb;

// Ask the browser to keep this origin's IndexedDB DURABLE rather than best-effort (which can be evicted
// under disk pressure / long inactivity). One-shot, idempotent; resolves false + no-ops when unsupported
// (node tests, old browsers). Chromium grants this heuristically for engaged/installed sites. Matters
// because IndexedDB is now the durable home for the version-history ring and (today) the only on-device
// home for the aerial underlay raster. Never throws. (B474 review #9)
export async function idbPersist() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return false;
    if (navigator.storage.persisted) { try { if (await navigator.storage.persisted()) return true; } catch (_) {} }
    return await navigator.storage.persist();
  } catch (_) { return false; }
}

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

// Remove every key with the given prefix (one cursor pass). Used to evict all of a deleted site's
// cached rasters (`raster:<siteId>:*`) so IndexedDB doesn't accumulate orphans forever. Resolves
// true/false; never throws. (B474 review — idbDelete was dead code; deletes leaked their rasters. #13/#24)
export async function idbDeleteByPrefix(prefix) {
  const db = await openDb();
  if (!db || !prefix) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try {
      // Half-open string range [prefix, prefix+￿): catches every key that begins with `prefix`.
      const range = IDBKeyRange.bound(prefix, prefix + "￿", false, true);
      const cur = tx.objectStore(STORE).openCursor(range);
      cur.onsuccess = () => { const c = cur.result; if (c) { try { c.delete(); } catch (_) {} c.continue(); } };
      cur.onerror = () => {}; // tx.onerror/onabort settles the promise
    } catch (_) { try { tx.abort(); } catch (_2) {} resolve(false); }
  });
}
