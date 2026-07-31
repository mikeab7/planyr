/* notesImageDb — the raw IndexedDB tier under the notes image store. NOTHING outside
 * lib/notesStore.js may import this file.
 *
 * ⛔ WHY IMAGES CANNOT LIVE WHERE NOTES LIVE. A note's document model persists in
 * localStorage, which is a few megabytes for the WHOLE origin — shared with every other
 * Planyr workspace. Base64 costs a third more than the bytes it carries, so ONE phone
 * photo pasted into a page would consume the entire notes store and every save after it,
 * in every notebook, would fail. That is not a theoretical ceiling: it is two photos.
 *
 * So the DOCUMENT keeps only an image ID and the BYTES live here, in IndexedDB — a real
 * in-browser database measured in hundreds of megabytes rather than a handful. The split
 * is the same one the tree/body split already makes for the same reason (see notesStore).
 *
 * WHAT IS STORED IS A DATA URL, NOT A BLOB, and that is deliberate:
 *   • a data URL is JSON-able, so the cloud-sync item can lift it through the same seam
 *     as everything else rather than needing a second, binary transport;
 *   • it is what the Markdown export has to inline anyway, so an export never re-encodes;
 *   • it renders straight into an <img src>, with no object-URL lifetime to leak.
 * The ~33% base64 overhead is real and is accounted for in the ceilings the store enforces.
 *
 * EVERY function here RESOLVES — never rejects — and reports `{ ok:false, error }` when the
 * database is unavailable or refuses a write, because the caller has to turn that into a
 * named banner (LOUD-FAILURE). It must never look like a clean save.
 */
const DB_NAME = "planyr-notes";
const DB_VERSION = 1;
const STORE = "images";

const idb = (typeof indexedDB !== "undefined" && indexedDB) ? indexedDB : null;

export const notesIdbAvailable = () => !!idb;

let dbPromise = null;

/* Self-heal on every non-success path (the B474 lesson): a cached rejected/null promise
 * would poison image storage for the whole session, so one transient failure must not
 * outlive itself — the next call simply reopens. */
function openDb() {
  if (!idb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (_) { dbPromise = null; resolve(null); return; }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "key" });
          os.createIndex("scope", "scope", { unique: false });
        }
      } catch (_) { /* the open itself still reports through onerror */ }
    };
    req.onsuccess = () => {
      const db = req.result || null;
      if (db) {
        db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
      } else { dbPromise = null; }
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; resolve(null); };
    req.onblocked = () => { dbPromise = null; resolve(null); };
  });
  return dbPromise;
}

const UNAVAILABLE = "This browser will not let Planyr store images (private browsing, or storage is switched off).";

function tx(db, mode) {
  try { return db.transaction(STORE, mode); } catch (_) { return null; }
}

/** Write one image record. `{ ok:true }` only when the bytes actually landed. */
export async function idbPutImage(record) {
  const db = await openDb();
  if (!db) return { ok: false, error: UNAVAILABLE };
  return new Promise((resolve) => {
    const t = tx(db, "readwrite");
    if (!t) { resolve({ ok: false, error: UNAVAILABLE }); return; }
    let req;
    try { req = t.objectStore(STORE).put(record); } catch (e) { resolve({ ok: false, error: String(e?.message || e) }); return; }
    req.onerror = () => resolve({ ok: false, error: String(req.error?.message || req.error?.name || "the write was refused") });
    // The TRANSACTION is what proves durability — a successful put inside a transaction
    // that later aborts (quota) has not stored anything.
    t.oncomplete = () => resolve({ ok: true });
    t.onabort = () => resolve({ ok: false, error: String(t.error?.message || t.error?.name || "the write was rolled back (the database may be full)") });
    t.onerror = () => resolve({ ok: false, error: String(t.error?.message || t.error?.name || "the write failed") });
  });
}

/** Read one record, or null on a miss / any failure. */
export async function idbGetImage(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = tx(db, "readonly");
    if (!t) { resolve(null); return; }
    let req;
    try { req = t.objectStore(STORE).get(key); } catch (_) { resolve(null); return; }
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

/** Delete a set of keys. Returns how many delete requests were issued successfully. */
export async function idbDeleteImages(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!list.length) return { ok: true, removed: 0 };
  const db = await openDb();
  if (!db) return { ok: false, removed: 0, error: UNAVAILABLE };
  return new Promise((resolve) => {
    const t = tx(db, "readwrite");
    if (!t) { resolve({ ok: false, removed: 0, error: UNAVAILABLE }); return; }
    const os = t.objectStore(STORE);
    let removed = 0;
    for (const k of list) {
      try { const r = os.delete(k); r.onsuccess = () => { removed += 1; }; } catch (_) { /* counted by the transaction outcome */ }
    }
    t.oncomplete = () => resolve({ ok: true, removed });
    t.onabort = () => resolve({ ok: false, removed: 0, error: String(t.error?.message || "the delete was rolled back") });
    t.onerror = () => resolve({ ok: false, removed: 0, error: String(t.error?.message || "the delete failed") });
  });
}

/** Every record in a scope, WITHOUT its bytes — the accounting read. Pulling data URLs
 *  here would mean holding an entire notebook's images in memory to answer "how big is
 *  this notebook?", which is exactly the question being asked to avoid doing that. */
export async function idbListImageMeta(scope) {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const t = tx(db, "readonly");
    if (!t) { resolve([]); return; }
    const out = [];
    let req;
    try { req = t.objectStore(STORE).index("scope").openCursor(IDBKeyRange.only(scope)); }
    catch (_) { resolve([]); return; }
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out); return; }
      const v = cur.value || {};
      out.push({ key: v.key, id: v.id, pageId: v.pageId || null, bytes: Number(v.bytes) || 0, mime: v.mime || "", w: v.w || 0, h: v.h || 0, createdAt: v.createdAt || 0 });
      cur.continue();
    };
    req.onerror = () => resolve(out);
  });
}
