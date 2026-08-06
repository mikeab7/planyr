/* IndexedDB-backed durable key/value store (B474; framing corrected by NEW-4/B1427).
 *
 * WHY: localStorage's hard ~5 MB per-origin cap is what let a full device store drop edits (B473).
 * IndexedDB gives gigabytes. Stage A moved the version-history ring here: storage.js keeps a synchronous
 * in-memory ring as the source of truth and writes through to here, so undo history is no longer
 * byte-throttled and survives reloads.
 *
 * ⛔ THIS STORE IS **LARGE**, NOT "UNCAPPED", AND IT CANNOT "NEVER FILL". The original header said both
 * of those things and that framing is what let a ~5 MB tier and a ~10 GB tier be reasoned about as one
 * thing for a year. Measured on the owner's own Chrome profile, 2026-08-06, via
 * navigator.storage.estimate() + a localStorage key census:
 *
 *     IndexedDB   35.9 MB used / 10,275.9 MB quota   (0.3%)   persisted: true
 *     localStorage 3.88 MB across 156 keys / ~5 MB hard cap   (~78%)
 *
 * Two facts follow, and both are load-bearing:
 *  1. The quota is a real number the browser derives from free disk. It is large; it is finite; on a
 *     nearly-full disk it can be small. Anything stored here still needs its own budget.
 *  2. `SitePlannerApp.jsx` calls idbPersist() at boot, so this origin is PERSISTENT — the browser will
 *     NEVER evict it for us under storage pressure. That is exactly right for data safety (a user's only
 *     copy of a raster is not the browser's to throw away) and it is precisely why a budget is not
 *     optional: nothing else is going to clean up after us.
 *
 * TIERING RULE (see /CLAUDE.md → TIER-BY-REBUILDABILITY): user work and re-fetchable cache never share a
 * storage tier, and anything re-fetchable belongs in the LARGE one. That is why gisCache's persistent tier
 * lives here now and no longer competes with saved plans for the ~5 MB localStorage ceiling.
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

/* Walk every record whose key begins with `prefix`, calling `fn(key, value)` per record (NEW-3/B1429).
 * One cursor pass, one record resident at a time — so measuring a 200 MB raster namespace costs one
 * raster of peak memory, not 200 MB. Pass `prefix: ""` to walk the whole store. Resolves the number of
 * records visited (0 on any failure); never throws. Read-only.
 *
 * This exists because navigator.storage.estimate() reports ONE number for the whole origin: it can say
 * "IndexedDB is using 35.9 MB" but not WHICH class of thing is using it, and a census that can't name a
 * class can't offer a safe clear-cache action for it. */
export async function idbForEachByPrefix(prefix, fn) {
  const db = await openDb();
  if (!db || typeof fn !== "function") return 0;
  return new Promise((resolve) => {
    let tx, n = 0;
    try { tx = db.transaction(STORE, "readonly"); } catch (_) { resolve(0); return; }
    tx.oncomplete = () => resolve(n);
    tx.onerror = () => resolve(n);
    tx.onabort = () => resolve(n);
    try {
      const range = prefix ? IDBKeyRange.bound(prefix, prefix + "￿", false, true) : undefined;
      const cur = tx.objectStore(STORE).openCursor(range);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        n++;
        try { fn(c.key, c.value); } catch (_) { /* a census callback may never break the walk */ }
        c.continue();
      };
      cur.onerror = () => {};
    } catch (_) { try { tx.abort(); } catch (_2) {} resolve(0); }
  });
}
