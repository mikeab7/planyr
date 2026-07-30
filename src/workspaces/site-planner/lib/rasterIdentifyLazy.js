/* THE ONE on-demand loader for the raster hover/identify glue (NEW-2).
 *
 * Why: `rasterIdentifyMap.js` pulls in leaflet tooltip/popup wiring, the readout DOM builder and
 * the cache-proxy transport, and `rasterIdentify.js` carries the whole state machine — none of
 * which is needed until the user actually rests the cursor over a RASTER-painted layer. Left as
 * static imports they rode the Site route's boot bundle and breached two of the bundle budgets in
 * `ui-audit/perf-bundle-audit.mjs` (site route +20 KB, largest chunk +13 KB). The gate's own rule
 * is that a feature breaching a budget ships with a matching optimization, so this is that
 * optimization; the shape is exactly the `terrainLazy.js` (B1095) / `exportSheet` (B1042) precedent.
 *
 * Two accessors, and the split matters:
 *  - `attachRasterIdentifyLazy(map, opts)` returns a detach function SYNCHRONOUSLY, so the caller's
 *    effect cleanup contract is unchanged. It kicks off the import and attaches when the chunk
 *    lands; detaching before then cancels the pending attach rather than leaving a listener bound
 *    to a dead map.
 *  - `hoverIdentifyNow()` is the synchronous handle the planner's per-move path uses — null until
 *    the chunk has landed, which the caller must read as "not yet", never as an answer.
 *
 * A failed load clears the cache so the next attempt retries instead of wedging on a dead promise.
 */
let mod = null, loading = null;

export function loadRasterIdentify() {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    loading = Promise.all([import("./rasterIdentifyMap.js"), import("./rasterIdentify.js")]).then(
      ([map, core]) => { mod = { ...map, ...core }; return mod; },
      (e) => { loading = null; throw e; }, // a network blip must not wedge every later call
    );
  }
  return loading;
}

/* The loaded module, or null. */
export const rasterIdentifyNow = () => mod;

/* Attach the map finder's hover/click identify as soon as the chunk lands. Returns a detach
 * function immediately so it can be returned straight from a `useEffect`. */
export function attachRasterIdentifyLazy(map, opts = {}) {
  if (!map) return () => {};
  let detach = null, cancelled = false;
  loadRasterIdentify().then(
    (m) => { if (!cancelled) detach = m.attachRasterIdentify(map, opts); },
    () => { /* the layer still paints; only the identify is unavailable, and it says so on use */ },
  );
  return () => {
    cancelled = true;
    if (detach) { detach(); detach = null; }
  };
}

/* The planner's controller, built once the chunk is available. Returns null until then — the
 * caller triggers `loadRasterIdentify()` on the first hover that would need it and simply shows
 * nothing on that first rest, which is the same "not yet" the contour readout already does. */
export function makeHoverIdentify(opts) {
  const m = mod;
  if (!m) return null;
  return m.createHoverIdentify({ fetchJson: m.makeIdentifyFetch(), ...opts });
}
