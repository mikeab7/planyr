/* Browser-local stale-while-revalidate cache for GIS layer IMAGERY (B96, imagery tranche).
 *
 * Plain-English: the county/agency map layers (FEMA flood, wetlands, utilities) are drawn on
 * the server and streamed back as a PICTURE for the current map view. This stores the last
 * good picture per view so that — when you reopen a site you've looked at before — its layers
 * paint INSTANTLY from the saved copy and keep showing even if the county server is down, with
 * a visible "as of Xm ago" age so a stale picture is never mistaken for live (screening-only).
 *
 * Why a separate module from gisCache.js: that one is localStorage + JSON (small, for vector/
 * status data). Pictures are far bigger, so this rides on IndexedDB (a roomy in-browser store
 * that holds binary Blobs natively), with a byte budget + oldest-first eviction. Same SWR shape
 * and the same `formatAge`/`isStale` helpers as gisCache, so the UI age/stale path is identical.
 *
 * The pure SWR + eviction logic takes an INJECTABLE async store (an async key→{blob,ts,bytes}
 * map) so it unit-tests in Node with no IndexedDB and no network. The real IndexedDB adapter
 * (indexedDbBlobStore) is a thin, guarded wrapper; if IndexedDB is unavailable the cache
 * degrades to live-only (never worse than today).
 */

import { formatAge, isStale } from "./gisCache.js";

export { formatAge, isStale };

export const IMG_DB = "planyr-gis-img";
export const IMG_STORE = "tiles";
export const IMG_NS = "v1:";

/* ---- pure size helper ---- */
export function blobBytes(blob) {
  if (!blob) return 0;
  if (typeof blob.size === "number") return blob.size;       // Blob
  if (typeof blob.byteLength === "number") return blob.byteLength; // ArrayBuffer
  return 0;
}

/* Decide which keys to evict so total bytes fit the budget. Pure: takes the current
 * entry list ([{key, ts, bytes}]) + budget, returns the keys to drop (oldest first).
 * Exposed for unit tests and reused by the cache. */
export function planEviction(entries, maxTotalBytes) {
  let total = 0;
  for (const e of entries) total += e.bytes || 0;
  if (total <= maxTotalBytes) return [];
  const byOldest = [...entries].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const drop = [];
  for (const e of byOldest) {
    if (total <= maxTotalBytes) break;
    drop.push(e.key);
    total -= e.bytes || 0;
  }
  return drop;
}

/* Build an image cache bound to an async blob store + clock. The app passes the IndexedDB
 * adapter below; tests inject an in-memory async store + a controllable `now`. */
export function createImageCache(opts = {}) {
  const store = opts.store || null;                 // async: get/set/delete/entries
  const now = opts.now || (() => Date.now());
  const maxTotalBytes = opts.maxTotalBytes ?? 50 * 1024 * 1024; // ~50 MB budget
  const maxEntryBytes = opts.maxEntryBytes ?? 8 * 1024 * 1024;  // skip a single absurd image

  async function read(key) {
    if (!store) return null;
    let e; try { e = await store.get(key); } catch (_) { return null; }
    if (!e || typeof e.ts !== "number" || !e.blob) return null;
    return { blob: e.blob, ts: e.ts, ageMs: now() - e.ts };
  }

  async function write(key, blob) {
    const ts = now();
    const bytes = blobBytes(blob);
    if (!store || bytes > maxEntryBytes) return { ts, stored: false };
    try { await store.set(key, { blob, ts, bytes }); } catch (_) { return { ts, stored: false }; }
    await enforceBudget();
    return { ts, stored: true };
  }

  async function enforceBudget() {
    if (!store) return;
    let entries; try { entries = await store.entries(); } catch (_) { return; }
    const drop = planEviction(entries || [], maxTotalBytes);
    for (const k of drop) { try { await store.delete(k); } catch (_) {} }
  }

  async function remove(key) {
    if (store) { try { await store.delete(key); } catch (_) {} }
  }

  async function clear() {
    if (!store) return;
    let entries; try { entries = await store.entries(); } catch (_) { return; }
    for (const e of entries || []) { try { await store.delete(e.key); } catch (_) {} }
  }

  async function totalBytes() {
    if (!store) return 0;
    let entries; try { entries = await store.entries(); } catch (_) { return 0; }
    return (entries || []).reduce((n, e) => n + (e.bytes || 0), 0);
  }

  /* Stale-while-revalidate for a view's image. Unlike the JSON cache this is fully async
   * (IndexedDB reads are async), so the caller awaits `cached` then PAINTS it, and awaits
   * `fresh` to swap in the refreshed image:
   *   { cached: {blob, ts, ageMs} | null, stale: boolean, fresh: Promise<{blob, ts, ageMs, updated, error?}> }
   * A failed refresh KEEPS the cached copy (error surfaced, never thrown). */
  async function swr(key, fetcher, { ttl = 0, onFresh } = {}) {
    const cached = await read(key);
    const stale = isStale(cached, ttl, now());
    let fresh;
    if (!stale) {
      fresh = Promise.resolve({ blob: cached.blob, ts: cached.ts, ageMs: now() - cached.ts, updated: false });
    } else {
      fresh = Promise.resolve()
        .then(fetcher)
        .then(async (blob) => {
          const w = await write(key, blob);
          const r = { blob, ts: w.ts, ageMs: 0, updated: true };
          if (onFresh) { try { onFresh(r); } catch (_) {} }
          return r;
        })
        .catch((error) => {
          const r = cached
            ? { blob: cached.blob, ts: cached.ts, ageMs: now() - cached.ts, updated: false, error }
            : { blob: null, ts: null, ageMs: null, updated: false, error };
          if (onFresh) { try { onFresh(r); } catch (_) {} }
          return r;
        });
    }
    return { cached, stale, fresh };
  }

  return { read, write, remove, clear, swr, totalBytes, enforceBudget };
}

/* ---- IndexedDB adapter (thin, guarded) ----
 * An async key→{blob,ts,bytes} store. Every op is promise-wrapped and fails soft to null so a
 * private-mode / disabled-IDB browser just gets live-only behavior. Not exercised in unit tests
 * (those inject an in-memory store); covered by the headless harness instead. */
export function indexedDbBlobStore(dbName = IMG_DB, storeName = IMG_STORE, ns = IMG_NS) {
  const idb = typeof indexedDB !== "undefined" ? indexedDB : null;
  let dbp = null;
  function open() {
    if (!idb) return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try { req = idb.open(dbName, 1); } catch (_) { resolve(null); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(storeName); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbp;
  }
  const k = (key) => ns + key;
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      let t; try { t = db.transaction(storeName, mode); } catch (_) { resolve(null); return; }
      const s = t.objectStore(storeName);
      let out = null;
      try { fn(s, (v) => { out = v; }); } catch (_) {}
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    }));
  }
  return {
    get: (key) => tx("readonly", (s, set) => { const r = s.get(k(key)); r.onsuccess = () => set(r.result || null); }),
    set: (key, val) => tx("readwrite", (s) => { s.put(val, k(key)); }),
    delete: (key) => tx("readwrite", (s) => { s.delete(k(key)); }),
    entries: () => tx("readonly", (s, set) => {
      const out = [];
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (c) {
          const key = typeof c.key === "string" && c.key.indexOf(ns) === 0 ? c.key.slice(ns.length) : c.key;
          const v = c.value || {};
          out.push({ key, ts: v.ts, bytes: v.bytes });
          c.continue();
        } else { set(out); }
      };
    }),
  };
}

// App-wide singleton bound to real IndexedDB (null store in Node/SSR → live-only).
export const gisImageCache = createImageCache({
  store: (typeof indexedDB !== "undefined") ? indexedDbBlobStore() : null,
});
