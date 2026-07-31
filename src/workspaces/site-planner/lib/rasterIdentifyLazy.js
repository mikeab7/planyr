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

/* Attach the map finder's hover/click identify on the FIRST POINTER CONTACT with the map.
 * Returns a detach function immediately so it can be returned straight from a `useEffect`.
 *
 * ⚠ B1349 — THE IMPORT USED TO FIRE AT MOUNT, WHICH UNDID THE SPLIT THIS FILE EXISTS FOR.
 * This function was called from MapFinder's map-setup effect and kicked off `loadRasterIdentify()`
 * immediately, so `rasterIdentifyMap`, `rasterIdentify` AND their shared `featureHover` dependency
 * were all in flight during boot — on an idle page, with no gesture, and even when the planner
 * (not the finder) was the visible workspace, because the finder's map is built either way. The
 * runtime half of the perf harness reported all three by name; the static bundle audit could not
 * see it, because a runtime `import()` leaves no static edge.
 *
 * The trigger is now the first `pointermove` / `pointerdown` / `wheel` on the map container — the
 * `ensureRasterHover` pattern the planner side of this feature already used correctly. There is no
 * behavioural gap: the identify only ever answers after the cursor RESTS (attachRasterIdentify
 * debounces), and the chunk lands within the first move of a hover long before a rest completes.
 * A pointer that never touches the map never pays for it. */
const WAKE_EVENTS = ["pointermove", "pointerdown", "wheel"];
export function attachRasterIdentifyLazy(map, opts = {}) {
  if (!map) return () => {};
  let detach = null, cancelled = false, container = null;
  const arm = () => {
    disarm();
    if (cancelled) return;
    loadRasterIdentify().then(
      (m) => { if (!cancelled) detach = m.attachRasterIdentify(map, opts); },
      () => { /* the layer still paints; only the identify is unavailable, and it says so on use */ },
    );
  };
  function disarm() {
    if (!container) return;
    for (const t of WAKE_EVENTS) container.removeEventListener(t, arm);
    container = null;
  }
  try { container = map.getContainer ? map.getContainer() : null; } catch (_) { container = null; }
  if (container) for (const t of WAKE_EVENTS) container.addEventListener(t, arm, { passive: true });
  else arm();   // no container to watch — never silently drop the feature
  return () => {
    cancelled = true;
    disarm();
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
