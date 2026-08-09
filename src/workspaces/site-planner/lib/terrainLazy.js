/* THE ONE on-demand loader for the terrain pipeline (B1095).
 *
 * Why: `terrainLayers.js` pulls in `demGrid.js`, `contours.js` and the Web-Worker glue,
 * and it rode the Site route's BOOT bundle even though nothing it does is needed until
 * the user either switches a terrain layer on or moves the cursor over the map. The
 * B1042 precedent (`exportSheet.js`, `lercGrid.js`) is the same shape: keep the heavy
 * module off the critical path and import it at the first moment it is actually used.
 *
 * Two accessors, and the split matters:
 *  - `terrainNow()` is SYNCHRONOUS and returns null until the chunk has landed. The
 *    cursor readout samples through this, so once loaded it stays a plain synchronous
 *    call on every mousemove — no promise, no frame of latency, no behaviour change.
 *  - `loadTerrain()` returns the cached module promise (one import, ever). A failed load
 *    clears the cache so the next attempt retries rather than wedging on a dead promise.
 *
 * ⛔ AND THE RETRY IS BACKED OFF, WHICH IT WAS NOT (B287060). "A failed load clears the cache so
 * the next attempt retries" is correct and was unbounded, and the caller is `useGroundElevation`'s
 * per-POINTER-MOVE cursor sample. So a chunk that is genuinely gone — the stale-after-deploy case
 * — turned every mouse movement into another failed `import()`. MEASURED IN PRODUCTION, not
 * theorised: build `53d1bac`, chunk `terrainLayers-aE2wQGtV.js`, 2026-08-06, ONE tab hammering ONE
 * dead import for **2 hours 20 minutes**, arriving in `client_errors` as 81 rows spaced exactly
 * 10 s apart — which is `DUP_MS`, the telemetry DEDUPE window, so even the row count was a
 * property of the instrument rather than of the failure. Twenty-two percent of every
 * `vite:preloadError` row this app has ever written is that single wedged tab.
 *
 * The backoff is a DELAY, never a cap: a cap would cost terrain for the rest of the session over
 * one blip, and a blip is the common case. `terrainNow()` keeps returning null in the gap, which
 * every caller already treats as "not yet" — so nothing new has to handle a new state. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

let mod = null, loading = null, fails = 0, nextTryAt = 0;

/** Pure: how long to wait before attempting import number `n + 1`. Exponential, bounded, and
 *  zero for the first attempt so a healthy page pays nothing at all for this. */
export function retryDelayMs(n, base = RETRY_BASE_MS, max = RETRY_MAX_MS) {
  const k = Number(n) || 0;
  if (k <= 0) return 0;
  return Math.min(max, base * 2 ** (k - 1));
}

export function loadTerrain(now = Date.now()) {
  if (mod) return Promise.resolve(mod);
  if (loading) return loading;
  /* Inside the backoff window: reject WITHOUT touching the network. The rejection is preserved
   * rather than swallowed (LOUD-FAILURE) — callers already surface or ignore it exactly as they
   * did for a real import failure, so their handling is unchanged. */
  if (now < nextTryAt) return Promise.reject(new Error("terrain chunk load backing off"));
  loading = import("./terrainLayers.js").then(
    (m) => { mod = m; loading = null; fails = 0; nextTryAt = 0; return m; },
    (e) => {
      loading = null;                      // a network blip must not wedge every later call
      fails += 1;
      nextTryAt = now + retryDelayMs(fails);
      throw e;
    },
  );
  return loading;
}

/** Test-only: forget the module, the in-flight promise and the backoff state. */
export function __resetTerrainLazy() { mod = null; loading = null; fails = 0; nextTryAt = 0; }

/* The loaded module, or null. Callers on a hot path (the per-move cursor sample) use this
 * and treat null as "not yet" — never as an answer. */
export const terrainNow = () => mod;

/* NEW-1's hover, routed so it costs nothing before the pipeline exists. It deliberately
 * does NOT trigger the load itself: the cursor readout on the same move already does, and
 * two independent triggers for one chunk is how a double-fetch gets introduced. Until the
 * chunk lands this is a no-op, which is correct — there are no contours painted yet. */
export function contourHover(map, ll) {
  const m = mod;
  if (m && m.setContourHover) m.setContourHover(map, ll);
}
