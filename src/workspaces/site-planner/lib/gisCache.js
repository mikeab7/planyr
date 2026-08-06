/* Browser-local stale-while-revalidate cache for GIS layer responses (B75).
 *
 * Plain-English: a "cache" = a stored copy of the last good answer, reused instead
 * of re-asking the server every time. This one is *stale-while-revalidate*: paint
 * the last-known-good copy instantly from browser storage, fire a refresh in the
 * background, swap in fresh data when it returns — and ALWAYS expose the data's
 * AGE so a stale boundary is never mistaken for current (screening-only framing).
 *
 * It is the shared substrate the jurisdiction (B72) and road-authority (B73)
 * identify layers ride on, and — unlike the prior in-memory evidence memoization —
 * it persists across reloads. No server, no credentials; this stays in the
 * browser-only tranche, and per-user privacy is covered by the existing model
 * (it's the user's own browser).
 *
 * ⛔ STORAGE TIER — READ THIS BEFORE MOVING ANYTHING BACK (NEW-1/B1427, 2026-08-06).
 * The persistent tier lives in **IndexedDB**, not localStorage. It used to live in
 * localStorage with a 3 MB budget, and that was a PRIORITY INVERSION: localStorage has a
 * hard ~5 MB per-origin cap that saved plans, the cloud index, the version-history mirror
 * and the autosave all share, so 3 MB of *disposable, re-fetchable* terrain tiles could —
 * and did — leave under 2 MB for irreplaceable user work. A big plan's setItem then threw
 * QuotaExceededError, the device save failed, and the owner got the B473 "your work is safe
 * in the cloud but there's no offline copy" banner WHILE map tiles kept their space.
 *
 * Measured on the owner's own Chrome, 2026-08-06 (navigator.storage.estimate + a key census):
 *     IndexedDB    35.9 MB / 10,275.9 MB quota  (0.3%)   ← the store that was empty
 *     localStorage  3.88 MB / ~5 MB hard cap    (~78%)   ← the store that was full
 *     top keys: sites:cloud 523 KB · sites:history 416 KB · then THREE terrain DEM tiles
 *               (400/283/280 KB) belonging to this cache
 * The two stores were the wrong way round. The rule that now governs this is
 * /CLAUDE.md → TIER-BY-REBUILDABILITY.
 *
 * The budget did NOT change and must not: `maxEntryBytes` (512 KB) and `maxTotalBytes`
 * (3 MB) are exactly what B1162 set. Bounding this cache was always right; it was
 * bounded against the WRONG ceiling. Nothing here gets bigger — it just stops competing.
 *
 * WHAT THAT COSTS, stated plainly: IndexedDB is asynchronous, so a *cold* lookup (nothing
 * in the in-memory L1 yet, e.g. right after a reload) can no longer answer synchronously.
 * `swr()` therefore returns `cached: null` on a cold L1 miss and delivers the stored copy
 * through the `fresh` promise instead — a few milliseconds later, and still with NO network
 * request. Every consumer already handles that path (it is the same path a genuinely empty
 * cache takes); `fetchCached`, the terrain layer and the vector overlays all await `fresh`.
 * The one caller that read the store synchronously — the PDF/PNG export — now warms the
 * keys it needs first (`exportSheet.js`, `warmTerrainForFrame`).
 *
 * WHEN THERE IS NO IndexedDB (private mode, old browser, the node test env) there is NO
 * persistent tier at all — the in-session L1 memo still serves, and a miss is a live fetch.
 * That is deliberate and it is the tiering rule again: with only one store left, that store
 * belongs to the user's work, not to data we can ask a server for again.
 *
 * The legacy `planyr:giscache:v1:` localStorage namespace is PURGED on first run (the
 * entries are re-fetchable, so migrating them buys nothing and delays the space we're
 * trying to free). `purgeLegacyLocalStorage()` is also exported for the reclaim path.
 *
 * The pure logic (staleness, age, SWR orchestration) takes an injectable disk + clock so it
 * unit-tests in Node with no DOM, no IndexedDB and no network.
 *
 * This EXTENDS the existing honest per-layer status + ~45s self-heal re-probe; it
 * does not replace them. Age is surfaced through the same `onStatus` channel.
 */
import { idbGet, idbPut, idbDelete, idbAvailable } from "./localDb.js";

export const NS = "planyr:giscache:v1:";        // LEGACY localStorage namespace — purged, never written
export const IDB_NS = "giscache:v1:";           // IndexedDB key prefix (the persistent home)
export const IDB_INDEX_KEY = "giscache:v1:__index"; // key → { ts, bytes }, so size/eviction stay synchronous

// ---- pure helpers (no storage; unit-tested directly) ----

/* Human age label from a millisecond age, for the screening UI next to a layer.
 * Deliberately coarse — this is "how old is this answer," not a precise clock. */
export function formatAge(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* A cache entry is stale when it's missing, has no ttl horizon (ttl 0 ⇒ always
 * revalidate), or is older than ttl. Pure; `now` is passed in. */
export function isStale(entry, ttl, now) {
  if (!entry || typeof entry.ts !== "number") return true;
  if (!ttl) return true; // ttl 0/undefined ⇒ always refresh in the background
  return now - entry.ts > ttl;
}

// Real localStorage when present; null in Node/SSR or when access throws. Used ONLY to purge
// the legacy namespace — this cache never writes to localStorage again.
function defaultStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; }
  catch (_) { return null; }
}

/* The default persistent backend: the app's IndexedDB kv store. `null` when IndexedDB is
 * unavailable, which switches the cache to L1-only (see the header). Every method resolves
 * and never rejects — that contract comes from localDb.js and this layer preserves it. */
function defaultDisk() {
  if (!idbAvailable()) return null;
  return {
    get: (k) => idbGet(k),
    put: (k, v) => idbPut(k, v),
    delete: (k) => idbDelete(k),
  };
}

/* Remove every legacy `planyr:giscache:v1:` key from localStorage. Returns the bytes freed.
 * Safe to call repeatedly; safe with no localStorage. Exported so the storage-reclaim path
 * (NEW-2) can free this space on demand without constructing a cache. */
export function purgeLegacyLocalStorage(store = defaultStore(), ns = NS) {
  if (!store) return 0;
  const doomed = [];
  let freed = 0;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.indexOf(ns) === 0) doomed.push(k);
    }
  } catch (_) { return 0; }
  for (const k of doomed) {
    try { freed += (store.getItem(k) || "").length + k.length; store.removeItem(k); } catch (_) {}
  }
  return freed;
}

/* Make a cache bound to a persistent backend + clock. The app uses the IndexedDB-backed
 * singleton below; tests inject a fake async disk + a controllable `now`. */
export function createGisCache(opts = {}) {
  const disk = opts.disk !== undefined ? opts.disk : defaultDisk();
  const legacyStore = opts.store !== undefined ? opts.store : defaultStore(); // purge target only
  const now = opts.now || (() => Date.now());
  const ns = opts.namespace || NS;                             // legacy localStorage namespace to purge
  const idbNs = opts.idbNamespace || IDB_NS;
  const indexKey = opts.indexKey || IDB_INDEX_KEY;
  const maxEntryBytes = opts.maxEntryBytes ?? 512 * 1024;      // skip a single oversize response (keep L1 only)
  const maxTotalBytes = opts.maxTotalBytes ?? 3 * 1024 * 1024; // B1162's budget, unchanged — see the header
  const warmEntries = opts.warmEntries ?? 8;                   // newest N pulled back into L1 at hydration
  const warmBytes = opts.warmBytes ?? 768 * 1024;              // …under this many bytes, so boot stays cheap

  const dk = (key) => idbNs + key;         // disk key
  const mem = new Map();                   // L1: key -> { data, ts } (per-session, instant, synchronous)
  /* NEW-7(b) — a size bound on L1. The persistent tier below is bounded twice over
   * (maxEntryBytes per entry, maxTotalBytes overall, evictOldest to enforce both); L1 had no
   * bound at all, and worse, the two interact badly: a payload over `maxEntryBytes` returns
   * early from `write` WITHOUT ever entering the store, so it never appears in the index, so
   * `evictOldest` can never reach it. The >512 KB GeoJSON responses — precisely the biggest
   * objects in the app — were the ones that lived forever. Keys are per-source-per-bbox rounded
   * to three decimals, so every meaningful pan mints a new one.
   *
   * Same recency-touch idiom as pondGeom's _detMemo: a read re-inserts, so `mem`'s insertion
   * order IS the LRU order and the front is the least recently used. A miss simply re-fetches
   * through the existing stale-while-revalidate path, so this costs a request at worst and can
   * never change an answer. */
  const maxMemEntries = opts.maxMemEntries ?? 48;

  /* The disk INDEX: key → { ts, bytes }. Held in memory so size accounting, staleness screening
   * and oldest-first eviction all stay synchronous even though the store itself is async. It is
   * persisted as one small record beside the entries. A row whose entry has gone missing is
   * self-healed away on the read that notices (see readAsync) — this is a cache, so an index that
   * over-reports simply evicts a little early, and one that under-reports simply re-fetches. */
  const idx = new Map();
  let readyP = null;
  let indexDirty = false;

  /* Free the legacy localStorage namespace THE MOMENT THIS MODULE LOADS, not on first cache use.
   * That distinction is the whole point of NEW-1: on a device already at the cap, the very next
   * SAVE must find the room, and nothing guarantees a GIS layer gets touched before it. It is a
   * loop over the key list plus a few removeItem calls — cheap enough for module scope, and the
   * entries are re-fetchable, so there is nothing to weigh against it. `ensureReady` calls it
   * again; it is idempotent. */
  try { purgeLegacyLocalStorage(legacyStore, ns); } catch (_) {}

  function touchMem(key, entry) {
    mem.delete(key);                       // re-insert at the back = most recently used
    mem.set(key, entry);
    while (mem.size > maxMemEntries) { const lru = mem.keys().next(); if (lru.done) break; mem.delete(lru.value); }
  }

  async function saveIndex() {
    if (!disk || !indexDirty) return;
    indexDirty = false;
    const obj = {};
    for (const [k, m] of idx) obj[k] = { ts: m.ts, bytes: m.bytes };
    try { await disk.put(indexKey, JSON.stringify(obj)); } catch (_) { /* cache metadata — never loud */ }
  }

  /* One-time hydration: load the index, purge the legacy localStorage namespace (freeing the
   * space this whole change exists to free), then pull the newest few entries back into L1 so a
   * reload still paints from cache almost immediately. Bounded by BOTH a count and a byte budget
   * so boot cost is fixed. Resolves even with no disk. */
  function ensureReady() {
    if (readyP) return readyP;
    readyP = (async () => {
      // Free the legacy namespace first — it is the localStorage pressure, and it is re-fetchable.
      try { purgeLegacyLocalStorage(legacyStore, ns); } catch (_) {}
      if (!disk) return;
      let raw = null;
      try { raw = await disk.get(indexKey); } catch (_) { raw = null; }
      const stored = [];   // ONLY the rows that came off disk — see the warm loop below
      if (raw) {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
        if (parsed && typeof parsed === "object") {
          for (const [k, m] of Object.entries(parsed)) {
            if (!m || typeof m.ts !== "number") continue;
            const row = { ts: m.ts, bytes: Number(m.bytes) || 0 };
            stored.push([k, row]);
            if (!idx.has(k)) idx.set(k, row);   // a live write that beat hydration is NEWER — keep it
          }
        }
      }
      /* Warm the newest STORED entries into L1 (bounded by count AND bytes). Deliberately iterate
       * `stored`, never `idx`: `idx` can already hold a write issued this tick whose disk record has
       * not landed yet, and treating that as a phantom would delete the row out from under the write
       * that is about to complete. */
      const newest = stored.sort((a, b) => b[1].ts - a[1].ts);
      let budget = warmBytes, n = 0;
      for (const [k, m] of newest) {
        if (n >= warmEntries || m.bytes > budget) break;
        budget -= m.bytes; n++;
        try {
          const rec = await disk.get(dk(k));
          if (!rec) { idx.delete(k); indexDirty = true; continue; }
          const e = JSON.parse(rec);
          if (e && typeof e.ts === "number") touchMem(k, { data: e.data, ts: e.ts });
        } catch (_) { /* a bad record just isn't warmed */ }
      }
      trim();          // a write that raced hydration must not leave the union over budget
      await saveIndex();
    })().catch(() => {});
    return readyP;
  }

  /* SYNCHRONOUS read — the in-memory L1 only. Returns { data, ts, ageMs } | null.
   * A cold miss is NOT "no stored copy"; it is "not resident yet" — use readAsync/warm.
   * Kicks hydration so the first sync miss starts the async path that will serve the next one. */
  function read(key) {
    const m = mem.get(key);
    if (m) { touchMem(key, m); return { data: m.data, ts: m.ts, ageMs: now() - m.ts }; }
    ensureReady();
    return null;
  }

  /* L1, else the persistent tier. Resolves { data, ts, ageMs } | null; never rejects. */
  async function readAsync(key) {
    const hit = read(key);
    if (hit) return hit;
    await ensureReady();
    if (!disk || !idx.has(key)) return null;
    let raw = null;
    try { raw = await disk.get(dk(key)); } catch (_) { raw = null; }
    if (!raw) { idx.delete(key); indexDirty = true; void saveIndex(); return null; } // phantom row → self-heal
    let e = null;
    try { e = JSON.parse(raw); } catch (_) { e = null; }
    if (!e || typeof e.ts !== "number") { idx.delete(key); indexDirty = true; void saveIndex(); return null; }
    touchMem(key, { data: e.data, ts: e.ts });
    return { data: e.data, ts: e.ts, ageMs: now() - e.ts };
  }
  // Pull one key into L1 so a later SYNCHRONOUS read() can see it (the export path's need).
  const warm = (key) => readAsync(key);

  // All namespace keys currently held on disk (namespaced, matching the old contract).
  function ourKeys() { return [...idx.keys()].map((k) => dk(k)); }

  // Total bytes currently held in our namespace (synchronous, from the index).
  function totalBytes() { let n = 0; for (const m of idx.values()) n += m.bytes; return n; }

  /* Drop the single oldest namespace entry to make room. Synchronous bookkeeping (so the byte
   * budget is enforced immediately and the return value is honest); the disk delete is
   * fire-and-forget, exactly like the write path. */
  function evictOldest() {
    let victim = null, oldest = Infinity;
    for (const [k, m] of idx) { if (m.ts < oldest) { oldest = m.ts; victim = k; } }
    if (victim == null) return false;
    idx.delete(victim); mem.delete(victim); indexDirty = true;
    if (disk) { try { void disk.delete(dk(victim)); } catch (_) {} }
    return true;
  }

  function trim() {
    let guard = 256;
    while (totalBytes() > maxTotalBytes && guard-- > 0) { if (!evictOldest()) break; }
  }

  /* Persist (and update L1). Best-effort: an oversize payload is kept in L1 only; the disk
   * write is fire-and-forget and the total is trimmed oldest-first. Stays SYNCHRONOUS and
   * returns { ts } so callers can stamp the age exactly as before. */
  function write(key, data) {
    const ts = now();
    touchMem(key, { data, ts });
    if (!disk) return { ts };
    let payload;
    try { payload = JSON.stringify({ data, ts }); } catch (_) { return { ts }; }
    if (payload.length > maxEntryBytes) return { ts }; // too big for the budget — L1 only
    idx.set(key, { ts, bytes: payload.length });
    indexDirty = true;
    trim();
    void (async () => {
      await ensureReady();
      if (!idx.has(key)) return;                        // trimmed away before it landed
      let ok = false;
      try { ok = await disk.put(dk(key), payload); } catch (_) { ok = false; }
      if (!ok) { idx.delete(key); indexDirty = true; }  // the index must not claim what isn't stored
      await saveIndex();
    })();
    return { ts };
  }

  function remove(key) {
    mem.delete(key);
    if (idx.delete(key)) indexDirty = true;
    if (disk) { try { void disk.delete(dk(key)); } catch (_) {} void saveIndex(); }
  }

  /* Drop the whole namespace: L1, the index, and every stored entry. Returns the bytes the
   * index said were held (what the reclaim path reports as freed). */
  function clear() {
    const freed = totalBytes();
    const keys = [...idx.keys()];
    idx.clear(); mem.clear(); indexDirty = true;
    if (disk) {
      for (const k of keys) { try { void disk.delete(dk(k)); } catch (_) {} }
      void saveIndex();
    }
    return freed;
  }

  /* What this cache is holding, for the storage census (NEW-3). Synchronous; index-derived. */
  function stats() {
    let oldest = null, newest = null;
    for (const m of idx.values()) {
      if (oldest == null || m.ts < oldest) oldest = m.ts;
      if (newest == null || m.ts > newest) newest = m.ts;
    }
    return { entries: idx.size, bytes: totalBytes(), budgetBytes: maxTotalBytes, memEntries: mem.size, oldest, newest };
  }

  /* Stale-while-revalidate. Synchronous-first so the caller can PAINT immediately:
   *   - cached: { data, ts, ageMs } | null   → render this NOW (may be stale; age shown)
   *   - stale:  boolean                        → whether a refresh was kicked off
   *   - fresh:  Promise<{ data, ts, ageMs, updated, error? }> → swap in on resolve
   * Only fetches when there is no usable stored copy or it is older than ttl. A failed refresh
   * KEEPS the stored copy (error surfaced on the result, never thrown). `onFresh`, if given, is
   * also called with the resolved result (handy for view-driven layers).
   *
   * NEW-1: on a cold L1 miss `cached` is null and the PERSISTENT copy is consulted inside
   * `fresh` — so a stored answer still costs no network, it just arrives a few ms later than it
   * did when this tier was synchronous localStorage. */
  function swr(key, fetcher, { ttl = 0, onFresh } = {}) {
    const cached = read(key);
    if (cached) {
      const stale = isStale(cached, ttl, now());
      if (!stale) {
        return { cached, stale, fresh: Promise.resolve({ data: cached.data, ts: cached.ts, ageMs: now() - cached.ts, updated: false }) };
      }
      return { cached, stale, fresh: refresh(key, fetcher, cached, onFresh) };
    }
    // Cold L1: resolve against the persistent tier first, and only then the network.
    const fresh = (async () => {
      const stored = await readAsync(key);
      if (stored && !isStale(stored, ttl, now())) {
        const r = { data: stored.data, ts: stored.ts, ageMs: now() - stored.ts, updated: false };
        if (onFresh) { try { onFresh(r); } catch (_) {} }
        return r;
      }
      return refresh(key, fetcher, stored, onFresh);
    })();
    return { cached: null, stale: true, fresh };
  }

  // The fetch half of swr: run the fetcher, store on success, fall back to `prior` on failure.
  function refresh(key, fetcher, prior, onFresh) {
    return Promise.resolve()
      .then(fetcher)
      .then((data) => {
        const w = write(key, data);
        const r = { data, ts: w.ts, ageMs: 0, updated: true };
        if (onFresh) { try { onFresh(r); } catch (_) {} }
        return r;
      })
      .catch((error) => {
        const r = prior
          ? { data: prior.data, ts: prior.ts, ageMs: now() - prior.ts, updated: false, error }
          : { data: null, ts: null, ageMs: null, updated: false, error };
        if (onFresh) { try { onFresh(r); } catch (_) {} }
        return r;
      });
  }

  return { read, readAsync, warm, write, remove, clear, swr, evictOldest, ourKeys, totalBytes, stats, ready: ensureReady };
}

// App-wide singleton bound to the real IndexedDB store.
export const gisCache = createGisCache();

/* The shared storage panel (chrome on every route) clears this cache's IndexedDB namespace by
 * PREFIX rather than through this object — it cannot import this module without hoisting the whole
 * cache into a chunk every route downloads. So it announces the clear and we drop our in-memory
 * bookkeeping here. Without this the index keeps claiming bytes that are no longer stored: it
 * self-heals per key on the next read either way, but only after over-reporting the total and
 * evicting a few phantoms first. Listener, not a shared registry module, for the same bundling
 * reason — even a 100-byte shim shows up as an unexpected Site-route chunk. */
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("planyr:refetchable-cache-cleared", () => { try { gisCache.clear(); } catch (_) {} });
  }
} catch (_) { /* no window (node/tests/worker) — nothing to listen with */ }
