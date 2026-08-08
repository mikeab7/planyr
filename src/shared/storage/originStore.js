/* Read-and-reclaim access to this origin's IndexedDB kv store, with NO workspace dependency (NEW-3).
 *
 * ⛔ WHY THIS EXISTS RATHER THAN JUST IMPORTING localDb.js. The storage panel is shared chrome — it
 * mounts from the account Settings tab AND the signed-out ⚙ popover, on every route. `localDb.js`
 * and `gisCache.js` live in the Site Planner workspace and are statically imported by the planner,
 * so a module reachable from BOTH the boot path and this lazy panel gets hoisted into their common
 * ancestor: the first attempt at this shipped an 11.3 KB `gisCache` chunk onto a plain Site load and
 * broke three bundle budgets (the site-route allowlist, the route chunk count, and the Notes route).
 * Split by tier, don't hope for tree-shaking — the same rule the export-path split records.
 *
 * So this is a deliberately tiny, dependency-free accessor for the same store (`planyr` / `kv`).
 * It opens WITHOUT a version, so it can never trigger a schema upgrade or fight localDb's own
 * connection, and it does nothing at all if the store isn't there. Every method resolves and never
 * throws — a census that crashes is worse than a census that says "unknown".
 */
const DB_NAME = "planyr";
const STORE = "kv";
const idb = (typeof indexedDB !== "undefined" && indexedDB) ? indexedDB : null;

export const originStoreAvailable = () => !!idb;

// Open read-only. Resolves null when IndexedDB is missing, the open fails, or the store isn't there.
function openDb() {
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req;
    // No version argument: attach to whatever exists. localDb.js owns the schema.
    try { req = idb.open(DB_NAME); } catch (_) { resolve(null); return; }
    req.onsuccess = () => {
      const db = req.result || null;
      if (!db) { resolve(null); return; }
      let has = false;
      try { has = db.objectStoreNames.contains(STORE); } catch (_) { has = false; }
      if (!has) { try { db.close(); } catch (_) {} resolve(null); return; }
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onupgradeneeded = () => { /* a brand-new empty DB; the store check above rejects it */ };
  });
}

/* Walk every record whose key begins with `prefix`, calling fn(key, value). One cursor pass, one
 * record resident at a time. Resolves the number of records visited (0 on any failure). */
export async function walkOriginStore(prefix, fn) {
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

/* Write one record. ⛔ CALLERS: this store is the LARGE tier (TIER-BY-REBUILDABILITY) and it is
 * PERSISTENT for this origin — the browser will never evict for us — so anything written here
 * must carry its own bound. The one writer today is the performance recorder's bounded capture
 * ring (perfCaptureStore.js), which prunes to a fixed count on every write and is surfaced in the
 * storage panel so it can never grow without being visible. Resolves true/false; never throws.
 *
 * If the `kv` store does not exist yet (a route that has never opened the planner), this resolves
 * FALSE rather than creating it: `localDb.js` owns that schema, and a second creator racing it is
 * how an IndexedDB version conflict starts. A false is reported by the caller, not swallowed. */
export async function putOriginRecord(key, value) {
  const db = await openDb();
  if (!db || !key) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try { tx.objectStore(STORE).put(value, key); } catch (_) { try { tx.abort(); } catch (_2) {} resolve(false); }
  });
}

/* Delete one record by exact key. Resolves true/false; never throws. */
export async function deleteOriginKey(key) {
  const db = await openDb();
  if (!db || !key) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try { tx.objectStore(STORE).delete(key); } catch (_) { try { tx.abort(); } catch (_2) {} resolve(false); }
  });
}

/* Delete every record under `prefix`, measuring what went. ⛔ CALLERS: this is a raw deleter with
 * no idea what it is deleting — the rehydration proof lives in storageReclaim.js and must be made
 * BEFORE a prefix reaches here. Resolves { bytes, keys }; never throws. */
export async function deleteOriginPrefix(prefix) {
  const out = { bytes: 0, keys: 0 };
  const db = await openDb();
  if (!db || !prefix) return out;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readwrite"); } catch (_) { resolve(out); return; }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => resolve(out);
    tx.onabort = () => resolve(out);
    try {
      const range = IDBKeyRange.bound(prefix, prefix + "￿", false, true);
      const cur = tx.objectStore(STORE).openCursor(range);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const v = c.value;
        out.bytes += (typeof v === "string" ? v.length : 0) + String(c.key).length;
        out.keys += 1;
        try { c.delete(); } catch (_) {}
        c.continue();
      };
      cur.onerror = () => {};
    } catch (_) { try { tx.abort(); } catch (_2) {} resolve(out); }
  });
}
