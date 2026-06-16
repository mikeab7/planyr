/* Browser-local stale-while-revalidate cache for GIS layer responses (B75).
 *
 * Plain-English: a "cache" = a stored copy of the last good answer, reused instead
 * of re-asking the server every time. This one is *stale-while-revalidate*: paint
 * the last-known-good copy instantly from browser storage, fire a refresh in the
 * background, swap in fresh data when it returns — and ALWAYS expose the data's
 * AGE so a stale boundary is never mistaken for current (screening-only framing).
 *
 * It is the shared substrate the jurisdiction (B72) and road-authority (B73)
 * identify layers will ride on, and — unlike the prior in-memory evidence
 * memoization — it persists across reloads. No server, no credentials; this stays
 * in the browser-only tranche, and per-user privacy is covered by the existing
 * model (it's the user's own browser).
 *
 * Storage: localStorage, namespaced + byte-capped, oldest-evicted on quota. Every
 * storage touch is guarded, so a storage failure degrades to a plain live fetch
 * (never worse than today) — the in-process L1 memo still serves the session. The
 * pure logic (staleness, age, SWR orchestration) takes an injectable store + clock
 * so it unit-tests in Node with no DOM and no network.
 *
 * This EXTENDS the existing honest per-layer status + ~45s self-heal re-probe; it
 * does not replace them. Age is surfaced through the same `onStatus` channel.
 */

export const NS = "planyr:giscache:v1:";

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

// Real localStorage when present; null in Node/SSR or when access throws.
function defaultStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; }
  catch (_) { return null; }
}

/* Make a cache bound to a storage backend + clock. The app uses the localStorage
 * singleton below; tests inject a fake store + a controllable `now`. */
export function createGisCache(opts = {}) {
  const store = opts.store !== undefined ? opts.store : defaultStore();
  const now = opts.now || (() => Date.now());
  const ns = opts.namespace || NS;
  const maxEntryBytes = opts.maxEntryBytes ?? 512 * 1024;     // skip a single oversize response (keep L1 only)
  const maxTotalBytes = opts.maxTotalBytes ?? 3 * 1024 * 1024; // keep our namespace from starving site data

  const sk = (key) => ns + key;            // storage key
  const mem = new Map();                   // L1: key -> { data, ts } (per-session, instant)

  // All namespace keys currently in the store.
  function ourKeys() {
    if (!store || !store.length) return [];
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.indexOf(ns) === 0) out.push(k);
    }
    return out;
  }

  // Read an entry (L1 first, then storage). Returns { data, ts, ageMs } | null.
  function read(key) {
    const m = mem.get(key);
    if (m) return { data: m.data, ts: m.ts, ageMs: now() - m.ts };
    if (!store) return null;
    let raw; try { raw = store.getItem(sk(key)); } catch (_) { return null; }
    if (!raw) return null;
    let e; try { e = JSON.parse(raw); } catch (_) { return null; }
    if (!e || typeof e.ts !== "number") return null;
    mem.set(key, { data: e.data, ts: e.ts });   // promote to L1
    return { data: e.data, ts: e.ts, ageMs: now() - e.ts };
  }

  // Drop the single oldest namespace entry to make room. Corrupt entries go first.
  function evictOldest() {
    const keys = ourKeys();
    if (!keys.length) return false;
    let victim = null, oldest = Infinity;
    for (const k of keys) {
      let ts;
      try { const e = JSON.parse(store.getItem(k)); ts = e && typeof e.ts === "number" ? e.ts : -1; }
      catch (_) { ts = -1; }
      if (ts < oldest) { oldest = ts; victim = k; }
    }
    if (!victim) return false;
    try { store.removeItem(victim); } catch (_) {}
    mem.delete(victim.slice(ns.length));
    return true;
  }

  // Total bytes currently held in our namespace.
  function totalBytes() {
    let n = 0;
    for (const k of ourKeys()) { try { n += (store.getItem(k) || "").length; } catch (_) {} }
    return n;
  }

  /* Persist (and update L1). Best-effort: an oversize payload is kept in L1 only;
   * a quota error evicts the oldest entry and retries; a total over budget trims
   * oldest-first. Returns { ts } so callers can stamp the age. */
  function write(key, data) {
    const ts = now();
    mem.set(key, { data, ts });
    if (!store) return { ts };
    let payload;
    try { payload = JSON.stringify({ data, ts }); } catch (_) { return { ts }; }
    if (payload.length > maxEntryBytes) return { ts }; // too big for localStorage — L1 only
    for (let i = 0; i < 8; i++) {
      try { store.setItem(sk(key), payload); break; }
      catch (_) { if (!evictOldest()) break; }        // quota → evict oldest, retry
    }
    let guard = 64;
    while (totalBytes() > maxTotalBytes && guard-- > 0) { if (!evictOldest()) break; }
    return { ts };
  }

  function remove(key) {
    mem.delete(key);
    if (store) { try { store.removeItem(sk(key)); } catch (_) {} }
  }

  function clear() {
    for (const k of ourKeys()) { try { store.removeItem(k); } catch (_) {} }
    mem.clear();
  }

  /* Stale-while-revalidate. Synchronous-first so the caller can PAINT immediately:
   *   - cached: { data, ts, ageMs } | null   → render this NOW (may be stale; age shown)
   *   - stale:  boolean                        → whether a refresh was kicked off
   *   - fresh:  Promise<{ data, ts, ageMs, updated, error? }> → swap in on resolve
   * Only fetches when the cache is missing or older than ttl. A failed refresh
   * KEEPS the cached copy (error surfaced on the result, never thrown). `onFresh`,
   * if given, is also called with the resolved result (handy for view-driven layers). */
  function swr(key, fetcher, { ttl = 0, onFresh } = {}) {
    const cached = read(key);
    const stale = isStale(cached, ttl, now());
    let fresh;
    if (!stale) {
      fresh = Promise.resolve({ data: cached.data, ts: cached.ts, ageMs: now() - cached.ts, updated: false });
    } else {
      fresh = Promise.resolve()
        .then(fetcher)
        .then((data) => {
          const w = write(key, data);
          const r = { data, ts: w.ts, ageMs: 0, updated: true };
          if (onFresh) { try { onFresh(r); } catch (_) {} }
          return r;
        })
        .catch((error) => {
          const r = cached
            ? { data: cached.data, ts: cached.ts, ageMs: now() - cached.ts, updated: false, error }
            : { data: null, ts: null, ageMs: null, updated: false, error };
          if (onFresh) { try { onFresh(r); } catch (_) {} }
          return r;
        });
    }
    return { cached, stale, fresh };
  }

  return { read, write, remove, clear, swr, evictOldest, ourKeys, totalBytes };
}

// App-wide singleton bound to the real localStorage.
export const gisCache = createGisCache();
